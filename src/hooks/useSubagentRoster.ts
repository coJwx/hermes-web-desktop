import { useEffect } from "react";
import type { WebChatController } from "@/lib/web-chat-controller";

export function useSubagentRoster(controller: WebChatController, sessionId: string | null, connected: boolean) {
  useEffect(() => {
    if (!sessionId || !connected) return;
    let cancelled = false;
    let pending = false;
    let failures = 0;
    const refresh = async () => {
      if (cancelled || pending || failures >= 3 || document.visibilityState === "hidden") return;
      pending = true;
      try { failures = await controller.refreshSubagents() ? 0 : failures + 1; }
      finally { pending = false; }
    };
    const visible = () => { failures = 0; void refresh(); };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [controller, sessionId, connected]);
}
