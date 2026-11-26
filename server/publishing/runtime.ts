import { emailTick } from "../email/runtime.ts";
import { recordGrowth, followerDaily, followerFacets } from "./growth.ts";
import { feedSource } from "./feed.ts";
import { connectionRuntime } from "../connections/runtime.ts";
import type { ConnectionEnvironment } from "../connections/runtime.ts";
import { RenewalError } from "../connections/lifecycle.ts";
import { linkedinClient, DeliveryError } from "./linkedin.ts";
import { deliverDue } from "./queue.ts";
import type { PostRow } from "./posts.ts";
export type PublishingEnvironment = ConnectionEnvironment & {
  MEDIA?: R2Bucket;
  EMAIL_SYNC_ENABLED?: string;
  EMAIL_DELIVERY_ENABLED?: string;
  LINKEDIN_API_VERSION?: string;
};
export async function publishingRuntime(e: PublishingEnvironment) {
  const db = e.DB;
  if (!db) throw new Error("Storage is unavailable");
  const connections = await connectionRuntime(e);
  async function page(post: PostRow) {
    const p = await db!
      .prepare(
        "SELECT p.* FROM hub_linkedin_pages p WHERE p.id=? AND p.workspace_id=? AND p.brand_id=? AND p.enabled=1",
      )
      .bind(post.page_id, post.workspace_id, post.brand_id)
      .first<{ connection_id: string; organization_urn: string }>();
    if (!p)
      throw new DeliveryError(
        "failed",
        "The LinkedIn page is no longer assigned to this brand.",
        "PAGE_ACCESS",
      );
    let access: string;
    try {
      access = await connections.service.accessToken(
        post.workspace_id,
        p.connection_id,
      );
    } catch (err) {
      throw new DeliveryError(
        err instanceof RenewalError && err.kind === "reauthorize"
          ? "failed"
          : "retry",
        "The LinkedIn connection needs attention.",
        "CONNECTION",
      );
    }
    return {
      client: linkedinClient(access, e.LINKEDIN_API_VERSION),
      organization: p.organization_urn,
    };
  }
  async function reshareParent(post: PostRow) {
    if (!post.reshare_post_id) return undefined;
    const member = await db!
      .prepare(
        "SELECT m.role,u.id FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND m.active=1",
      )
      .bind(post.workspace_id, post.created_by)
      .first<{ id: string; role: "admin" | "super_admin" }>();
    if (!member) throw new Error("Author access removed");
    return (
      await feedSource(
        db!,
        {
          ...member,
          name: "",
          email: "",
          workspaceId: post.workspace_id,
          workspaceName: "",
          sessionHash: "",
        },
        post.reshare_post_id,
      )
    ).provider_post_id;
  }
  return {
    async deliver() {
      return deliverDue(db!, {
        async prepare(post) {
          try {
            await reshareParent(post);
          } catch {
            throw new DeliveryError(
              "failed",
              "The original post is no longer available to this author.",
              "RESHARE_SOURCE",
            );
          }
          const { client, organization } = await page(post);
          if (!post.media_id) return null;
          if (post.provider_image_id) {
            if (
              !(await (post.provider_image_id.startsWith("urn:li:video:")
                ? client.videoReady(post.provider_image_id)
                : client.imageReady(post.provider_image_id)))
            )
              throw new DeliveryError(
                "retry",
                "LinkedIn is still processing the media.",
                "MEDIA_PROCESSING",
              );
            return post.provider_image_id;
          }
          const media = await db!
            .prepare(
              "SELECT object_key,mime FROM hub_media WHERE id=? AND workspace_id=? AND brand_id=?",
            )
            .bind(post.media_id, post.workspace_id, post.brand_id)
            .first<{ object_key: string; mime: string }>();
          if (!media || !e.MEDIA)
            throw new DeliveryError(
              "failed",
              "The media is unavailable. Replace it before publishing.",
              "MEDIA_MISSING",
            );
          if (media.mime === "video/mp4") {
            const object = await e.MEDIA.head(media.object_key);
            if (!object)
              throw new DeliveryError(
                "failed",
                "The saved video could not be found.",
                "MEDIA_MISSING",
              );
            const video = await client.uploadVideo(organization, {
              size: object.size,
              read: async (offset, length) => {
                const lease = await db!
                  .prepare(
                    "UPDATE hub_posts SET lease_until=? WHERE id=? AND lease_id=? AND status='processing'",
                  )
                  .bind(Date.now() + 600000, post.id, post.lease_id)
                  .run();
                if (!lease.meta.changes)
                  throw new DeliveryError(
                    "retry",
                    "Delivery preparation was reassigned.",
                    "LEASE_LOST",
                  );
                const chunk = await e.MEDIA!.get(media.object_key, {
                  range: { offset, length },
                });
                if (!chunk)
                  throw new DeliveryError(
                    "failed",
                    "The saved video is unavailable.",
                    "MEDIA_MISSING",
                  );
                return chunk.arrayBuffer();
              },
            });
            await db!
              .prepare(
                "UPDATE hub_posts SET provider_image_id=? WHERE id=? AND lease_id=?",
              )
              .bind(video, post.id, post.lease_id)
              .run();
            if (!(await client.videoReady(video)))
              throw new DeliveryError(
                "retry",
                "LinkedIn is still processing the video.",
                "MEDIA_PROCESSING",
              );
            return video;
          }
          const stored = await e.MEDIA.get(media.object_key);
          if (!stored)
            throw new DeliveryError(
              "failed",
              "The saved image could not be found.",
              "MEDIA_MISSING",
            );
          const upload = await client.initializeImage(organization);
          await client.uploadImage(
            upload.uploadUrl,
            await stored.arrayBuffer(),
            media.mime,
          );
          await db!
            .prepare(
              "UPDATE hub_posts SET provider_image_id=? WHERE id=? AND lease_id=?",
            )
            .bind(upload.image, post.id, post.lease_id)
            .run();
          if (!(await client.imageReady(upload.image)))
            throw new DeliveryError(
              "retry",
              "LinkedIn is still processing the media.",
              "MEDIA_PROCESSING",
            );
          return upload.image;
        },
        async publish(post, image) {
          const { client, organization } = await page(post);
          let parent: string | undefined;
          try {
            parent = await reshareParent(post);
          } catch {
            throw new DeliveryError(
              "failed",
              "The original post is no longer available to this author.",
              "RESHARE_SOURCE",
            );
          }
          return client.publish(
            organization,
            post.text,
            image || undefined,
            post.alt_text,
            parent,
          );
        },
      });
    },
    async growth() {
      const rows = (
        await db!
          .prepare(
            "SELECT p.id,p.workspace_id,p.brand_id,p.connection_id,p.organization_urn FROM hub_linkedin_pages p LEFT JOIN hub_page_growth_status s ON s.page_id=p.id AND s.brand_id=p.brand_id WHERE p.enabled=1 AND p.brand_id IS NOT NULL AND (s.checked_at IS NULL OR s.checked_at<?) ORDER BY COALESCE(s.checked_at,0) LIMIT 1",
          )
          .bind(Date.now() - 6 * 3600000)
          .all<{
            id: string;
            workspace_id: string;
            brand_id: string;
            connection_id: string;
            organization_urn: string;
          }>()
      ).results;
      for (const p of rows) {
        const report: Parameters<typeof recordGrowth>[2] = {},
          errors: string[] = [];
        try {
          const token = await connections.service.accessToken(
              p.workspace_id,
              p.connection_id,
            ),
            client = linkedinClient(token, e.LINKEDIN_API_VERSION),
            end = Math.floor(Date.now() / 86400000) * 86400000 - 86400000,
            start = end - 90 * 86400000;
          try {
            report.total = await client.followerTotal(p.organization_urn);
            if (report.total === null)
              errors.push("Follower total unavailable.");
          } catch {
            errors.push("Follower total could not be refreshed.");
          }
          try {
            report.gains = followerDaily(
              await client.followerGains(p.organization_urn, start, end),
              p.organization_urn,
              start,
              end,
            );
          } catch {
            errors.push("Daily follower gains could not be refreshed.");
          }
          try {
            const raw = await client.followerAudience(p.organization_urn);
            if (raw) {
              report.audience = followerFacets(raw);
              const cachedRows = (
                  await db!
                    .prepare(
                      "SELECT segment_key,label FROM hub_audience_labels ORDER BY updated_at DESC LIMIT 5000",
                    )
                    .all<{ segment_key: string; label: string }>()
                ).results,
                labels = new Map(
                  cachedRows.map((r) => [r.segment_key, r.label]),
                );
              for (const facet of report.audience) {
                const label = labels.get(facet.key);
                if (label) facet.label = label;
              }
              const groups = [
                ...new Set(report.audience.map((f) => f.dimension)),
              ].map((d) =>
                report
                  .audience!.filter(
                    (f) =>
                      f.dimension === d &&
                      !labels.has(f.key) &&
                      /^urn:li:(industry|function|geo|seniority):/.test(f.key),
                  )
                  .sort((a, b) => b.followers - a.followers),
              );
              let budget = 15;
              for (let i = 0; i < 100 && budget > 0; i++) {
                for (const group of groups) {
                  const facet = group[i];
                  if (!facet || budget <= 0) continue;
                  budget--;
                  try {
                    const label = await client.audienceLabel(facet.key);
                    if (label) {
                      for (const f of report.audience)
                        if (f.key === facet.key) f.label = label;
                      await db!
                        .prepare(
                          "INSERT OR REPLACE INTO hub_audience_labels VALUES(?,?,?)",
                        )
                        .bind(facet.key, label, Date.now())
                        .run();
                    }
                  } catch {}
                }
              }
            } else errors.push("Audience breakdown unavailable.");
          } catch {
            errors.push("Audience breakdown could not be refreshed.");
          }
        } catch {
          errors.push("The page connection needs attention.");
        }
        report.error = errors.join(" ");
        await recordGrowth(db!, p, report);
      }
    },
    async metrics() {
      const posts = (
        await db!
          .prepare(
            "SELECT p.* FROM hub_posts p LEFT JOIN hub_post_metrics m ON m.post_id=p.id WHERE p.status='published' AND p.published_at>? AND (m.checked_at IS NULL OR m.checked_at<?) ORDER BY COALESCE(m.checked_at,0) LIMIT 10",
          )
          .bind(Date.now() - 365 * 86400000, Date.now() - 3600000)
          .all<PostRow>()
      ).results;
      for (const post of posts) {
        try {
          const { client, organization } = await page(post),
            m = await client.metrics(organization, post.provider_post_id!);
          if (!m) throw new Error("Metrics not yet available");
          const n = (key: string) => (Number.isFinite(m[key]) ? m[key] : null);
          await db!
            .prepare(
              "INSERT INTO hub_post_metrics(post_id,impressions,unique_impressions,clicks,likes,comments,shares,synced_at,checked_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET impressions=excluded.impressions,unique_impressions=excluded.unique_impressions,clicks=excluded.clicks,likes=excluded.likes,comments=excluded.comments,shares=excluded.shares,synced_at=excluded.synced_at,checked_at=excluded.checked_at,error_message=NULL",
            )
            .bind(
              post.id,
              n("impressionCount"),
              n("uniqueImpressionsCount"),
              n("clickCount"),
              n("likeCount"),
              n("commentCount"),
              n("shareCount"),
              Date.now(),
              Date.now(),
            )
            .run();
        } catch {
          await db!
            .prepare(
              "INSERT INTO hub_post_metrics(post_id,checked_at,error_message) VALUES(?,?,?) ON CONFLICT(post_id) DO UPDATE SET checked_at=excluded.checked_at,error_message=excluded.error_message",
            )
            .bind(
              post.id,
              Date.now(),
              "Metrics could not be refreshed. Previous values are retained.",
            )
            .run();
        }
      }
    },
    maintain: connections.maintain,
  };
}
export async function tick(e: PublishingEnvironment) {
  if (!e.DB) throw new Error("Database unavailable");
  await e.DB.prepare(
    "INSERT INTO hub_scheduler(id,heartbeat_at) VALUES('publishing',?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at",
  )
    .bind(Date.now())
    .run();
  if (!e.TOKEN_VAULT_KEY) return;
  const runtime = await publishingRuntime(e);
  await runtime.deliver();
  await runtime.metrics();
  await runtime.growth();
  await runtime.maintain();
  await emailTick(e);
}
