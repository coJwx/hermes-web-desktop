import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebChatController } from "@/lib/web-chat-controller";
import type { WebChatState } from "@/lib/web-chat-state";

export interface WebChatTab {
  id: string;
  storedSessionId: string | null;
  title: string | null;
}

interface TabWorkspace {
  tabs: WebChatTab[];
  activeTabId: string;
}

function navigationBlocked(state: WebChatState): boolean {
  return state.connection !== "open" || state.loading || state.submitting || state.commandBusy || state.sendingImages ||
    state.switchingModel || !!state.requests.length || !!state.unsentTurn;
}

function sessionTitle(state: WebChatState): string | null {
  const session = state.sessions.find((row) => row.id === state.storedSessionId);
  const user = state.messages.find((message) => message.role === "user");
  // Empty sessions have a synthetic dropdown label, not a conversation title.
  const storedTitle = session?.message_count !== 0 && (user || session?.message_count)
    ? session?.title || session?.preview : null;
  return (state.info.title || storedTitle || user?.text || "").replace(/\s+/g, " ").trim() || null;
}

/** Commit the tab binding only after its transport has loaded the intended session. */
export function useWebChatTabs(controller: WebChatController, state: WebChatState) {
  const [workspace, setWorkspace] = useState<TabWorkspace>({
    tabs: [{ id: "tab-0", storedSessionId: null, title: null }], activeTabId: "tab-0",
  });
  const [switching, setSwitching] = useState(false);
  const transition = useRef(false);
  const nextId = useRef(0);
  const { tabs, activeTabId } = workspace;

  useEffect(() => {
    if (switching || state.loading || !state.sessionId || !state.storedSessionId) return;
    const title = sessionTitle(state);
    setWorkspace((current) => {
      const active = current.tabs.find((tab) => tab.id === current.activeTabId);
      if (!active || (active.storedSessionId && active.storedSessionId !== state.storedSessionId)) return current;
      if (active.storedSessionId === state.storedSessionId && active.title === title) return current;
      return { ...current, tabs: current.tabs.map((tab) => tab === active ? { ...tab, storedSessionId: state.storedSessionId, title } : tab) };
    });
  }, [state, switching]);

  const occupied = useMemo(() => new Set([
    ...tabs.flatMap((tab) => tab.storedSessionId ? [tab.storedSessionId] : []),
    ...(state.storedSessionId ? [state.storedSessionId] : []),
  ]), [tabs, state.storedSessionId]);
  const availableSessions = useMemo(() => state.sessions.filter((session) => !occupied.has(session.id)), [state.sessions, occupied]);
  const selectableSessions = useMemo(() => state.sessions.filter((session) =>
    session.id === state.storedSessionId || !occupied.has(session.id)), [state.sessions, occupied, state.storedSessionId]);

  const runTransition = useCallback(async (action: () => Promise<boolean>) => {
    if (transition.current || navigationBlocked(controller.getSnapshot())) return false;
    transition.current = true;
    setSwitching(true);
    try { return await action(); }
    finally { transition.current = false; setSwitching(false); }
  }, [controller]);

  const openTab = useCallback((selectedId?: string) => runTransition(async () => {
    if (selectedId && (tabs.some((tab) => tab.storedSessionId === selectedId) || controller.getSnapshot().storedSessionId === selectedId)) return false;
    await controller.start(!selectedId, selectedId);
    const snapshot = controller.getSnapshot();
    if (!snapshot.sessionId || !snapshot.storedSessionId || snapshot.error || (selectedId && snapshot.storedSessionId !== selectedId)) return false;
    const tab: WebChatTab = { id: "tab-" + ++nextId.current, storedSessionId: snapshot.storedSessionId, title: sessionTitle(snapshot) };
    setWorkspace((current) => ({ tabs: [...current.tabs, tab], activeTabId: tab.id }));
    return true;
  }), [controller, runTransition, tabs]);

  const switchTab = useCallback((id: string) => runTransition(async () => {
    const target = tabs.find((tab) => tab.id === id);
    if (!target?.storedSessionId || id === activeTabId) return false;
    // The server keeps the previous turn alive (close_on_disconnect=false).
    await controller.start(false, target.storedSessionId);
    const snapshot = controller.getSnapshot();
    if (!snapshot.sessionId || snapshot.error || snapshot.storedSessionId !== target.storedSessionId) return false;
    setWorkspace((current) => ({ ...current, activeTabId: id }));
    return true;
  }), [activeTabId, controller, runTransition, tabs]);

  const closeTab = useCallback(async (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (transition.current || index < 0 || tabs.length <= 1) return false;
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (id !== activeTabId) {
      setWorkspace((current) => ({ ...current, tabs: current.tabs.filter((tab) => tab.id !== id) }));
      return true;
    }
    return runTransition(async () => {
      const target = remaining[Math.max(0, index - 1)];
      if (!target.storedSessionId) return false;
      await controller.start(false, target.storedSessionId);
      const snapshot = controller.getSnapshot();
      if (!snapshot.sessionId || snapshot.error || snapshot.storedSessionId !== target.storedSessionId) return false;
      setWorkspace({ tabs: remaining, activeTabId: target.id });
      return true;
    });
  }, [activeTabId, controller, runTransition, tabs]);

  const switchSession = useCallback((id: string) => runTransition(async () => {
    if (tabs.some((tab) => tab.id !== activeTabId && tab.storedSessionId === id)) return false;
    if (!await controller.switchSession(id)) return false;
    const snapshot = controller.getSnapshot();
    if (snapshot.storedSessionId !== id) return false;
    setWorkspace((current) => ({ ...current, tabs: current.tabs.map((tab) => tab.id === current.activeTabId
      ? { ...tab, storedSessionId: id, title: sessionTitle(snapshot) } : tab) }));
    return true;
  }), [activeTabId, controller, runTransition, tabs]);

  return { tabs, activeTabId, switching, blocked: switching || navigationBlocked(state),
    availableSessions, selectableSessions, openTab, switchTab, closeTab, switchSession };
}
