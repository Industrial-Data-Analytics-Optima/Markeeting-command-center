import { useEffect, useState } from "react";
export function AssetPreview({
  id,
  alt = "",
  className = "",
  controls = true,
}: {
  id: string;
  alt?: string;
  className?: string;
  controls?: boolean;
}) {
  const [video, setVideo] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/media/" + id, { method: "HEAD" })
      .then((r) => {
        if (active) setVideo(r.headers.get("Content-Type") === "video/mp4");
      })
      .catch(() => {
        if (active) setVideo(false);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return video === null ? (
    <span>Loading media…</span>
  ) : video ? (
    <video
      className={className}
      src={"/api/media/" + id}
      controls={controls}
      preload="metadata"
      playsInline
      aria-label={alt || "Video preview"}
    />
  ) : (
    <img className={className} src={"/api/media/" + id} alt={alt} />
  );
}
