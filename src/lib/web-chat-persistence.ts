import { HERMES_BASE_PATH } from "./api";
import { CHAT_LIMITS } from "./web-chat-cache";
import type { WebChatLayout, WebChatWorkspaceOptions } from "./web-chat-workspace";

/** Only stored identities enter storage. Live data, drafts and request responders stay in memory. */
export function webChatPersistence(profile: string): WebChatWorkspaceOptions {
  const key = "hermes-web-chat:" + window.location.origin + HERMES_BASE_PATH + ":" + profile;
  const layoutKey = key + ":tabs:v1";
  let previous: string | null = null;
  return {
    profile,
    restore: () => { try { return sessionStorage.getItem(key); } catch { return null; } },
    remember: id => { try { sessionStorage.setItem(key, id); } catch { /* Storage may be disabled. */ } },
    restoreLayout: () => {
      try {
        const value: unknown = JSON.parse(sessionStorage.getItem(layoutKey) || "null");
        if (!value || typeof value !== "object") return null;
        const layout = value as Partial<WebChatLayout> & { version?: number };
        if (layout.version !== 1 || !Array.isArray(layout.sessions) || !layout.sessions.length ||
          layout.sessions.length > CHAT_LIMITS.bindings || layout.sessions.some(id => typeof id !== "string" || !id.trim())) return null;
        const sessions = [...new Set(layout.sessions)];
        return { sessions, activeSessionId: sessions.includes(layout.activeSessionId || "") ? layout.activeSessionId! : sessions[0] };
      } catch { return null; }
    },
    rememberLayout: layout => {
      const value = JSON.stringify({ version: 1, ...layout });
      if (value === previous) return;
      try { sessionStorage.setItem(layoutKey, value); previous = value; } catch { /* In-memory navigation still works. */ }
    },
  };
}
