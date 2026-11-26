export async function uploadMedia(
  file: File,
  brandId: string,
  progress: (percent: number, message: string) => void = () => {},
  signal?: AbortSignal,
): Promise<{ id: string }> {
  if (!["video/mp4", "image/png", "image/jpeg"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or H.264 MP4 file.");
  if (file.size > (file.type === "video/mp4" ? 500000000 : 5 * 1024 * 1024))
    throw new Error("Videos can be up to 500 MB; images up to 5 MB.");
  async function result(r: Response) {
    const d = (await r.json()) as {
      id: string;
      partSize: number;
      message?: string;
    };
    if (!r.ok)
      throw Object.assign(
        new Error(d.message || "Upload failed. Please retry."),
        { status: r.status },
      );
    return d;
  }
  async function command(data: unknown) {
    return result(
      await fetch("/api/media/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal,
      }),
    );
  }
  async function retry<T>(action: () => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action();
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        if (
          signal?.aborted ||
          attempt >= 2 ||
          (status && status < 500 && status !== 429)
        )
          throw e;
        progress(-1, "Connection interrupted. Retrying this part…");
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  if (file.type !== "video/mp4") {
    progress(0, "Uploading image…");
    const saved = await result(
      await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": file.type, "x-brand-id": brandId },
        body: file,
        signal,
      }),
    );
    progress(100, "Uploaded");
    return saved;
  }
  progress(0, "Preparing video upload…");
  const session = await command({
    action: "start",
    brandId,
    size: file.size,
    name: file.name.slice(0, 180),
  });
  try {
    for (
      let offset = 0, part = 1;
      offset < file.size;
      offset += session.partSize, part++
    ) {
      const end = Math.min(file.size, offset + session.partSize);
      await retry(() =>
        fetch("/api/media/uploads/" + session.id + "?part=" + part, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(offset, end),
          signal,
        }).then(result),
      );
      progress(Math.floor((end / file.size) * 95), "Uploading video…");
    }
    progress(96, "Checking video format and duration…");
    const saved = await retry(() =>
      command({ action: "complete", id: session.id }),
    );
    progress(100, "Video ready");
    return saved;
  } catch (e) {
    fetch("/api/media/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort", id: session.id }),
    }).catch(() => {});
    throw e;
  }
}
