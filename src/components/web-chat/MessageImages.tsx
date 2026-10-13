import { useEffect, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { fetchJSON } from "@/lib/api";
import type { ChatImage } from "@/lib/web-chat-images";
import type { WebChatCopy } from "@/lib/web-chat-copy";
import { ImagePreview } from "./ImagePreview";

function MessageImage({ image, profile, copy }: { image: ChatImage; profile: string; copy: WebChatCopy }) {
  const [source, setSource] = useState(image.dataUrl || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setSource(image.dataUrl || "");
    setFailed(false);
    if (!image.dataUrl && image.path) {
      const query = new URLSearchParams({ path: image.path, profile });
      void fetchJSON<{ data_url: string }>("/api/media?" + query, { signal: abort.signal })
        .then((result) => { if (!abort.signal.aborted) setSource(result.data_url); })
        .catch(() => { if (!abort.signal.aborted) setFailed(true); });
    }
    return () => abort.abort();
  }, [image.dataUrl, image.path, profile]);

  return <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border border-current/10 bg-midground/5 sm:h-40 sm:w-40">
    {failed ? <span role="status" className="flex flex-col items-center gap-2 px-2 text-center text-xs text-text-secondary"><ImageOff aria-hidden className="h-5 w-5" />{copy.imagePreviewFailed}</span> : source ?
      <ImagePreview source={source} name={image.name} label={copy.previewImage} onError={() => setFailed(true)} /> :
      <LoaderCircle aria-label={copy.loading} className="h-5 w-5 animate-spin text-text-tertiary" />}
  </div>;
}

export function MessageImages({ images, profile, copy }: { images: ChatImage[]; profile: string; copy: WebChatCopy }) {
  return <div className="mb-2 flex flex-wrap gap-2">{images.map((image, i) =>
    <MessageImage key={image.path || i} image={image} profile={profile} copy={copy} />)}</div>;
}
