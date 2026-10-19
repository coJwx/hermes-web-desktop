import { useContext, useEffect, useMemo, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { WebChatWorkspaceContext } from "@/contexts/web-chat-workspace-context";
import { WebChatMediaCache } from "@/lib/web-chat-media";
import type { ChatImage } from "@/lib/web-chat-images";
import type { WebChatCopy } from "@/lib/web-chat-copy";
import { ImagePreview } from "./ImagePreview";

function MessageImage({ image, profile, copy, cache }: { image: ChatImage; profile: string; copy: WebChatCopy; cache: WebChatMediaCache }) {
  const [source, setSource] = useState(() => image.dataUrl || (image.path ? cache.get(profile, image.path) : "") || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(image.dataUrl || (image.path ? cache.get(profile, image.path) : "") || "");
    setFailed(false);
    if (!image.dataUrl && image.path) {
      const lease = cache.acquire(profile, image.path);
      void lease.promise.then((result) => { if (active) setSource(result); })
        .catch(() => { if (active) setFailed(true); });
      return () => { active = false; lease.release(); };
    }
    return () => { active = false; };
  }, [image.dataUrl, image.path, profile, cache]);

  return <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border border-current/10 bg-midground/5 sm:h-40 sm:w-40">
    {failed ? <span role="status" className="flex flex-col items-center gap-2 px-2 text-center text-xs text-text-secondary"><ImageOff aria-hidden className="h-5 w-5" />{copy.imagePreviewFailed}</span> : source ?
      <ImagePreview source={source} name={image.name} label={copy.previewImage} onError={() => setFailed(true)} /> :
      <LoaderCircle aria-label={copy.loading} className="h-5 w-5 animate-spin text-text-tertiary" />}
  </div>;
}

export function MessageImages({ images, profile, copy }: { images: ChatImage[]; profile: string; copy: WebChatCopy }) {
  const owner = useContext(WebChatWorkspaceContext);
  // Prefer the workspace cache shared across tabs/routes; the private fallback
  // exists only for rendering outside the workspace (standalone previews/tests).
  const cache = useMemo(() => owner?.media ?? new WebChatMediaCache(), [owner?.media]);
  useEffect(() => {
    if (owner?.media) return; // the workspace clears its own cache on disposal
    // No workspace yet: drop the private cache when this view unmounts or a
    // workspace cache arrives.
    return () => cache.clear();
  }, [cache, owner?.media]);
  return <div className="mb-2 flex flex-wrap gap-2">{images.map((image, i) =>
    <MessageImage key={image.path || i} image={image} profile={profile} copy={copy} cache={cache} />)}</div>;
}
