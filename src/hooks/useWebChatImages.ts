import { useEffect, useRef, useState } from "react";
import { imageValidationError, type DraftChatImage } from "@/lib/web-chat-images";
import type { WebChatCopy } from "@/lib/web-chat-copy";

/** Local image drafts are isolated by profile/conversation and never enter the server queue before Send. */
export function useWebChatImages(scope: string, copy: WebChatCopy) {
  const [drafts, setDrafts] = useState<Record<string, DraftChatImage[]>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const urls = useRef(new Set<string>());
  const nextId = useRef(0);

  useEffect(() => {
    const owned = urls.current;
    return () => { for (const url of owned) URL.revokeObjectURL(url); owned.clear(); };
  }, []);

  const add = (files: File[]) => {
    const added: DraftChatImage[] = [];
    const invalid: string[] = [];
    for (const file of files) {
      const error = imageValidationError(file);
      if (error) { invalid.push(file.name + ": " + copy[error]); continue; }
      const previewUrl = URL.createObjectURL(file);
      urls.current.add(previewUrl);
      added.push({ id: "image:" + ++nextId.current, file, previewUrl });
    }
    setDrafts((current) => ({ ...current, [scope]: [...(current[scope] || []), ...added] }));
    setErrors((current) => ({ ...current, [scope]: invalid.length ? invalid.join("\n") : null }));
  };

  const remove = (ids: string[]) => {
    const removed = new Set(ids);
    for (const image of drafts[scope] || []) {
      if (removed.has(image.id)) { URL.revokeObjectURL(image.previewUrl); urls.current.delete(image.previewUrl); }
    }
    setDrafts((current) => ({ ...current, [scope]: (current[scope] || []).filter((image) => !removed.has(image.id)) }));
  };

  return {
    images: drafts[scope] || [], error: errors[scope] || null, add, remove,
    setError: (error: string | null) => setErrors((current) => ({ ...current, [scope]: error })),
  };
}
