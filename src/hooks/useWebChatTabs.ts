import { useMemo, useSyncExternalStore } from "react";
import type { WebChatWorkspace, WorkspaceTab } from "@/lib/web-chat-workspace";
import type { WebChatState } from "@/lib/web-chat-state";

export type WebChatTab = WorkspaceTab;

export function useWebChatTabs(workspace: WebChatWorkspace, state: WebChatState) {
  const summary = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const occupied = useMemo(() => new Set(summary.tabs.map(tab => tab.storedSessionId)), [summary.tabs]);
  const availableSessions = useMemo(() => state.sessions.filter(row => !occupied.has(row.resolved_id || row.id)), [state.sessions, occupied]);
  const selectableSessions = useMemo(() => state.sessions.filter(row => row.id === state.storedSessionId || !occupied.has(row.resolved_id || row.id)), [state.sessions, occupied, state.storedSessionId]);
  return { ...summary, switching: summary.opening, blocked: summary.opening || state.connection !== "open",
    availableSessions, selectableSessions, openTab: workspace.open, switchTab: workspace.select,
    closeTab: workspace.close, switchSession: workspace.replace };
}
