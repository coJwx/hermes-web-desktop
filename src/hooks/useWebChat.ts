import { useEffect, useMemo, useSyncExternalStore } from "react";
import { HERMES_BASE_PATH } from "@/lib/api";
import { WebChatController } from "@/lib/web-chat-controller";

export function useWebChat(profile: string) {
  const controller = useMemo(() => {
    const key = "hermes-web-chat:" + window.location.origin + HERMES_BASE_PATH + ":" + profile;
    return new WebChatController({
      profile,
      restore: () => {
        try { return sessionStorage.getItem(key); }
        catch { return null; } // Storage can be disabled; server history still works.
      },
      remember: (id) => {
        try { sessionStorage.setItem(key, id); }
        catch { /* Private browsing may disallow persistence. */ }
      },
    });
  }, [profile]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.start();
    return controller.stop;
  }, [controller]);
  return { state, controller };
}
