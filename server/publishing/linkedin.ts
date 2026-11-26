export class DeliveryError extends Error {
  kind: "retry" | "failed" | "uncertain";
  code: string;
  retryMs: number;
  constructor(
    kind: "retry" | "failed" | "uncertain",
    message: string,
    code = "PROVIDER_ERROR",
    retryMs = 60000,
  ) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.retryMs = retryMs;
  }
}
export type LinkedInPage = { urn: string; name: string; person: string };
export function linkedinClient(
  accessToken: string,
  version = "202609",
  fetcher: typeof fetch = fetch,
) {
  if (!/^20\d{4}$/.test(version))
    throw new Error("Invalid LinkedIn API version");
  const headers = {
    Authorization: "Bearer " + accessToken,
    "Linkedin-Version": version,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
  async function call(
    path: string,
    options: RequestInit = {},
    publishing = false,
    api: "rest" | "v2" = "rest",
  ) {
    let response: Response;
    try {
      response = await fetcher("https://api.linkedin.com/" + api + "/" + path, {
        ...options,
        headers: { ...headers, ...options.headers },
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new DeliveryError(
        publishing ? "uncertain" : "retry",
        publishing
          ? "LinkedIn may have received this post. Check the page before taking further action."
          : "LinkedIn could not be reached. We will retry.",
        "NETWORK",
      );
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      if (response.status === 429)
        throw new DeliveryError(
          "retry",
          "LinkedIn rate limit reached. Delivery will retry.",
          "RATE_LIMIT",
          Number.isFinite(retryAfter)
            ? Math.max(60000, Math.min(3600000, retryAfter * 1000))
            : 60000,
        );
      if (response.status >= 500 || response.status === 408)
        throw new DeliveryError(
          publishing ? "uncertain" : "retry",
          publishing
            ? "LinkedIn returned an error after submission. Check the page before taking further action."
            : "LinkedIn is temporarily unavailable.",
          "PROVIDER_UNAVAILABLE",
        );
      throw new DeliveryError(
        "failed",
        response.status === 401 || response.status === 403
          ? "LinkedIn access needs attention. Ask your super admin to review the connection."
          : "LinkedIn rejected this request. Review the content and page access.",
        "HTTP_" + response.status,
      );
    }
    return response;
  }
  return {
    async followerTotal(organization: string) {
      const d = (await (
        await call(
          "networkSizes/" +
            encodeURIComponent(organization) +
            "?edgeType=CompanyFollowedByMember",
          {},
          false,
          "v2",
        )
      ).json()) as { firstDegreeSize?: number };
      return Number.isSafeInteger(d.firstDegreeSize) && d.firstDegreeSize! >= 0
        ? d.firstDegreeSize!
        : null;
    },
    async followerGains(organization: string, start: number, end: number) {
      const rows: Record<string, unknown>[] = [];
      for (
        let offset = 0, requestCount = 0;
        offset < 1000 && requestCount < 20;
        requestCount++
      ) {
        const q = new URLSearchParams({
          q: "organizationalEntity",
          organizationalEntity: organization,
          "timeIntervals.timeGranularityType": "DAY",
          "timeIntervals.timeRange.start": String(start),
          "timeIntervals.timeRange.end": String(end),
          start: String(offset),
          count: "100",
        });
        const d = (await (
          await call("organizationalEntityFollowerStatistics?" + q)
        ).json()) as {
          elements?: Record<string, unknown>[];
          paging?: { links?: { rel: string }[] };
        };
        rows.push(...(d.elements || []));
        if (
          (d.elements?.length || 0) < 100 &&
          !d.paging?.links?.some((l) => l.rel === "next")
        )
          return rows;
        offset += d.elements?.length || 100;
      }
      throw new DeliveryError(
        "failed",
        "Follower reporting exceeded the supported response range.",
        "FOLLOWER_LIMIT",
      );
    },
    async followerAudience(organization: string) {
      const q = new URLSearchParams({
        q: "organizationalEntity",
        organizationalEntity: organization,
      });
      const d = (await (
        await call("organizationalEntityFollowerStatistics?" + q)
      ).json()) as { elements?: Record<string, unknown>[] };
      return (
        d.elements?.find((r) => r.organizationalEntity === organization) || null
      );
    },
    async audienceLabel(key: string) {
      const match = /^urn:li:(industry|function|geo|seniority):(\d+)$/.exec(
        key,
      );
      if (!match) return null;
      const path = (
        {
          industry: "industries",
          function: "functions",
          geo: "geo",
          seniority: "seniorities",
        } as Record<string, string>
      )[match[1]];
      const d = (await (
        await call(path + "/" + match[2], {}, false, "v2")
      ).json()) as {
        defaultLocalizedName?: string;
        name?: { localized?: Record<string, string> };
      };
      return (
        d.defaultLocalizedName ||
        d.name?.localized?.en_US ||
        Object.values(d.name?.localized || {})[0] ||
        null
      );
    },
    async interact(
      kind: string,
      organization: string,
      post: string,
      text = "",
    ) {
      if (
        !/^urn:li:organization:\d+$/.test(organization) ||
        !/^urn:li:(share|ugcPost):\d+$/.test(post)
      )
        throw new DeliveryError(
          "failed",
          "Invalid page or post identity.",
          "IDENTITY",
        );
      let r: Response;
      if (kind === "like")
        r = await call(
          "reactions?actor=" + encodeURIComponent(organization),
          {
            method: "POST",
            body: JSON.stringify({ root: post, reactionType: "LIKE" }),
          },
          true,
        );
      else if (kind === "unlike")
        r = await call(
          "reactions/(actor:" +
            encodeURIComponent(organization) +
            ",entity:" +
            encodeURIComponent(post) +
            ")",
          { method: "DELETE" },
          true,
        );
      else if (kind === "comment")
        r = await call(
          "socialActions/" + encodeURIComponent(post) + "/comments",
          {
            method: "POST",
            body: JSON.stringify({
              actor: organization,
              object: post,
              message: { text },
            }),
          },
          true,
        );
      else
        throw new DeliveryError("failed", "Unsupported interaction.", "ACTION");
      const id = r.headers.get("x-restli-id");
      if (kind === "comment" && !id)
        throw new DeliveryError(
          "uncertain",
          "LinkedIn accepted the comment without a usable ID. Check the post before repeating it.",
          "MISSING_COMMENT_ID",
        );
      return id;
    },
    async uploadVideo(
      organization: string,
      source:
        | ArrayBuffer
        | {
            size: number;
            read: (offset: number, length: number) => Promise<ArrayBuffer>;
          },
    ) {
      const size =
        source instanceof ArrayBuffer ? source.byteLength : source.size;
      const read =
        source instanceof ArrayBuffer
          ? async (offset: number, length: number) =>
              source.slice(offset, offset + length)
          : source.read;
      const d = (await (
        await call("videos?action=initializeUpload", {
          method: "POST",
          body: JSON.stringify({
            initializeUploadRequest: {
              owner: organization,
              fileSizeBytes: size,
              uploadCaptions: false,
              uploadThumbnail: false,
            },
          }),
        })
      ).json()) as {
        value: {
          video: string;
          uploadToken: string;
          uploadInstructions: {
            firstByte: number;
            lastByte: number;
            uploadUrl: string;
          }[];
        };
      };
      const value = d.value,
        parts: string[] = [];
      let offset = 0;
      if (
        !value ||
        !/^urn:li:video:[\w-]+$/.test(value.video) ||
        !Array.isArray(value.uploadInstructions) ||
        !value.uploadInstructions.length
      )
        throw new DeliveryError(
          "failed",
          "LinkedIn returned invalid video upload instructions.",
          "VIDEO_UPLOAD",
        );
      for (const part of value.uploadInstructions) {
        const url = new URL(part.uploadUrl);
        if (
          url.protocol !== "https:" ||
          !(
            url.hostname === "www.linkedin.com" ||
            url.hostname.endsWith(".linkedin.com") ||
            url.hostname.endsWith(".licdn.com")
          ) ||
          part.firstByte !== offset ||
          !Number.isSafeInteger(part.lastByte) ||
          part.lastByte < offset ||
          part.lastByte >= size ||
          part.lastByte - part.firstByte + 1 > 8 * 1024 * 1024
        )
          throw new DeliveryError(
            "failed",
            "LinkedIn returned invalid video upload instructions.",
            "VIDEO_UPLOAD",
          );
        offset = part.lastByte + 1;
      }
      if (offset !== size)
        throw new DeliveryError(
          "failed",
          "LinkedIn returned incomplete video upload instructions.",
          "VIDEO_UPLOAD",
        );
      for (const part of value.uploadInstructions) {
        let r: Response;
        try {
          r = await fetcher(part.uploadUrl, {
            method: "PUT",
            headers: {
              Authorization: "Bearer " + accessToken,
              "Content-Type": "application/octet-stream",
            },
            body: await read(
              part.firstByte,
              part.lastByte - part.firstByte + 1,
            ),
            redirect: "error",
            signal: AbortSignal.timeout(25000),
          });
        } catch {
          throw new DeliveryError(
            "retry",
            "Video upload interrupted. We will retry.",
            "VIDEO_UPLOAD",
          );
        }
        const etag = r.headers.get("etag");
        if (!r.ok || !etag)
          throw new DeliveryError(
            "retry",
            "Video upload could not finish. We will retry.",
            "VIDEO_UPLOAD",
          );
        parts.push(etag.replace(/^"|"$/g, ""));
      }
      await call("videos?action=finalizeUpload", {
        method: "POST",
        body: JSON.stringify({
          finalizeUploadRequest: {
            video: value.video,
            uploadToken: value.uploadToken,
            uploadedPartIds: parts,
          },
        }),
      });
      return value.video;
    },
    async videoReady(id: string) {
      const d = (await (
        await call("videos/" + encodeURIComponent(id))
      ).json()) as { status: string };
      if (d.status === "PROCESSING_FAILED")
        throw new DeliveryError(
          "failed",
          "LinkedIn could not process this video. Replace it and try again.",
          "MEDIA_PROCESSING",
        );
      return d.status === "AVAILABLE";
    },
    async discover(): Promise<LinkedInPage[]> {
      const output: LinkedInPage[] = [];
      for (let start = 0; start < 10000; start += 100) {
        const data = (await (
          await call(
            "organizationAcls?q=roleAssignee&state=APPROVED&start=" +
              start +
              "&count=100",
          )
        ).json()) as {
          elements?: {
            organization: string;
            role: string;
            state: string;
            roleAssignee: string;
          }[];
          paging?: { links?: { rel: string }[] };
        };
        for (const acl of data.elements || []) {
          if (
            acl.state !== "APPROVED" ||
            ![
              "ADMINISTRATOR",
              "CONTENT_ADMINISTRATOR",
              "CONTENT_ADMIN",
            ].includes(acl.role) ||
            !/^urn:li:organization:\d+$/.test(acl.organization) ||
            output.some((p) => p.urn === acl.organization)
          )
            continue;
          const org = (await (
            await call("organizations/" + acl.organization.split(":").pop())
          ).json()) as {
            localizedName?: string;
            name?: { localized?: Record<string, string> };
          };
          output.push({
            urn: acl.organization,
            name:
              org.localizedName ||
              Object.values(org.name?.localized || {})[0] ||
              "LinkedIn page " + acl.organization.split(":").pop(),
            person: acl.roleAssignee,
          });
        }
        if (!data.paging?.links?.some((l) => l.rel === "next")) return output;
      }
      throw new DeliveryError(
        "failed",
        "Too many pages to load. Contact support.",
        "PAGE_LIMIT",
      );
    },
    async initializeImage(organization: string) {
      const d = (await (
        await call("images?action=initializeUpload", {
          method: "POST",
          body: JSON.stringify({
            initializeUploadRequest: { owner: organization },
          }),
        })
      ).json()) as { value: { image: string; uploadUrl: string } };
      const upload = new URL(d.value.uploadUrl);
      if (
        upload.protocol !== "https:" ||
        !(
          upload.hostname === "www.linkedin.com" ||
          upload.hostname.endsWith(".linkedin.com") ||
          upload.hostname.endsWith(".licdn.com")
        )
      )
        throw new DeliveryError(
          "failed",
          "LinkedIn returned an unsupported upload location.",
          "UPLOAD_HOST",
        );
      return d.value;
    },
    async uploadImage(url: string, bytes: ArrayBuffer, mime: string) {
      let r: Response;
      try {
        r = await fetcher(url, {
          method: "PUT",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": mime,
          },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(25000),
        });
      } catch {
        throw new DeliveryError(
          "retry",
          "Image upload interrupted. We will retry.",
          "MEDIA_UPLOAD",
        );
      }
      if (!r.ok)
        throw new DeliveryError(
          "retry",
          "Image upload could not finish. We will retry.",
          "MEDIA_UPLOAD",
        );
    },
    async imageReady(id: string) {
      const d = (await (
        await call("images/" + encodeURIComponent(id))
      ).json()) as { status: string };
      if (d.status === "PROCESSING_FAILED")
        throw new DeliveryError(
          "failed",
          "LinkedIn could not process this image. Replace it and try again.",
          "MEDIA_PROCESSING",
        );
      return d.status === "AVAILABLE";
    },
    async publish(
      organization: string,
      text: string,
      image?: string,
      altText = "",
      reshare?: string,
    ) {
      const r = await call(
        "posts",
        {
          method: "POST",
          body: JSON.stringify({
            author: organization,
            commentary: text,
            visibility: "PUBLIC",
            distribution: {
              feedDistribution: "MAIN_FEED",
              targetEntities: [],
              thirdPartyDistributionChannels: [],
            },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false,
            ...(reshare ? { reshareContext: { parent: reshare } } : {}),
            ...(image
              ? {
                  content: {
                    media: {
                      id: image,
                      ...(image.startsWith("urn:li:video:") ? {} : { altText }),
                    },
                  },
                }
              : {}),
          }),
        },
        true,
      );
      const id = r.headers.get("x-restli-id");
      if (!id || !/^urn:li:(share|ugcPost):\d+$/.test(id))
        throw new DeliveryError(
          "uncertain",
          "LinkedIn accepted the request without a usable post ID. Check the page before taking further action.",
          "MISSING_POST_ID",
        );
      return id;
    },
    async metrics(organization: string, postId: string) {
      const key = postId.includes(":ugcPost:") ? "ugcPosts[0]" : "shares[0]";
      const q = new URLSearchParams({
        q: "organizationalEntity",
        organizationalEntity: organization,
        [key]: postId,
      });
      const d = (await (
        await call("organizationalEntityShareStatistics?" + q)
      ).json()) as {
        elements?: { totalShareStatistics?: Record<string, number> }[];
      };
      return d.elements?.[0]?.totalShareStatistics || null;
    },
  };
}
