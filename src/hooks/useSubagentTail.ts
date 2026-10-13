import { useEffect, useState } from "react";
import { stripAnsi } from "@hermes/shared";
import { errorMessage } from "@/lib/api-error";
import type { WebChatController } from "@/lib/web-chat-controller";

export function useSubagentTail(controller: WebChatController, sessionId: string, id: string, connected: boolean, poll: boolean) {
  const [tail, setTail] = useState({ text: "", available: false, truncated: false, loading: true, error: null as string | null });
  useEffect(() => {
    if (!connected) return;
    const abort = new AbortController();
    let pending = false;
    let failures = 0;
    const refresh = async () => {
      if (abort.signal.aborted || pending || failures >= 3 || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await controller.getSubagentTail(id, abort.signal);
        if (!abort.signal.aborted) setTail((previous) => ({
          text: result.available ? stripAnsi(result.text || "").slice(-16_384) : previous.text,
          truncated: result.available ? !!result.truncated : previous.truncated,
          available: !!result.available, loading: false, error: null,
        }));
        failures = 0;
      } catch (error) {
        failures++;
        if (!abort.signal.aborted) setTail((previous) => ({ ...previous, loading: false, available: false, error: errorMessage(error) }));
      } finally { pending = false; }
    };
    const visible = () => { failures = 0; void refresh(); };
    void refresh();
    const timer = poll ? window.setInterval(() => void refresh(), 2_000) : undefined;
    document.addEventListener("visibilitychange", visible);
    return () => { abort.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [controller, sessionId, id, connected, poll]);
  return tail;
}
