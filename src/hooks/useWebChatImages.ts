import { useEffect, useState, useSyncExternalStore } from "react";
import { WebChatDrafts } from "@/lib/web-chat-drafts";
import type { WebChatCopy } from "@/lib/web-chat-copy";

/** A standalone caller owns its drafts; the chat composer borrows the workspace owner. */
export function useWebChatImages(scope: string, copy: WebChatCopy, owner?: WebChatDrafts) {
  const [local] = useState(() => new WebChatDrafts());
  const store = owner ?? local;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => owner ? undefined : local.dispose, [owner, local]);
  return {
    retainScopes: store.retainScopes, moveScope: store.moveScope,
    dirty: store.dirty,
    images: snapshot.drafts[scope] || [], error: snapshot.errors[scope] || null,
    add: (files: File[]) => store.add(scope, files, copy),
    remove: (ids: string[]) => store.remove(scope, ids),
    setError: (error: string | null) => store.setError(scope, error),
  };
}
