import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import type { SessionListRow } from "@hermes/shared";
import type { WebChatTab } from "@/hooks/useWebChatTabs";
import type { WebChatCopy } from "@/lib/web-chat-copy";
import { webChatSessionLabel } from "@/lib/web-chat-session-label";
import { cn } from "@/lib/utils";

interface ConversationTabsProps {
  tabs: WebChatTab[];
  activeTabId: string;
  tabIdPrefix: string;
  panelId: string;
  sessions: SessionListRow[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  blocked: boolean;
  switching: boolean;
  connected: boolean;
  busy: boolean;
  waiting: boolean;
  copy: WebChatCopy;
  onSelect: (id: string) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onOpen: (id?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function ConversationTabs({ tabs, activeTabId, tabIdPrefix, panelId, sessions, sessionsLoading, sessionsError,
  blocked, switching, connected, busy, waiting, copy, onSelect, onClose, onOpen, onRefresh }: ConversationTabsProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 56, width: 360, maxHeight: 400 });
  const list = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef(false);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) anchor.current?.querySelector("button")?.focus();
  }, []);

  useLayoutEffect(() => {
    const reveal = () => list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const active = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    reveal();
    if (!blocked && (focusAfterSwitch.current || list.current?.contains(document.activeElement))) {
      active?.focus();
      focusAfterSwitch.current = false;
    }
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [activeTabId, blocked]);

  useEffect(() => { if (blocked) close(); }, [blocked, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upward = below < 180 && above > below;
      const maxHeight = Math.max(80, Math.min(400, upward ? above : below));
      setPosition({ width, maxHeight,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: upward ? Math.max(12, rect.top - (panel.current?.offsetHeight || maxHeight) - 8) : rect.bottom + 8,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, sessions.length, sessionsLoading, sessionsError]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) close();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [open, close]);

  const showMenu = () => {
    if (blocked) return;
    setOpen(true);
    void onRefresh();
  };
  const choose = (id?: string) => { close(true); void onOpen(id); };
  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") { close(true); return; }
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])];
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -buttons.length, End: buttons.length };
    if (!(event.key in moves) || !buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + moves[event.key] + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  const tabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (blocked || event.nativeEvent.isComposing || (event.target as HTMLElement).getAttribute("role") !== "tab") return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -tabs.length, End: tabs.length };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + moves[event.key] + tabs.length) % tabs.length;
    focusAfterSwitch.current = true;
    void onSelect(tabs[next].id);
  };

  return <div className="flex min-w-0 items-center gap-1">
    <div ref={list} role="tablist" aria-label={copy.tabs} onKeyDown={tabKey} className="scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto py-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const title = tab.title || copy.unnamed;
        return <div key={tab.id} role="presentation" className={cn("group flex h-8 max-w-48 shrink-0 items-center rounded-lg transition-colors",
          active ? "bg-midground/15 font-medium text-text-primary" : "text-text-secondary hover:bg-midground/10")}>
          <button type="button" role="tab" id={tabIdPrefix + "-" + tab.id} aria-controls={panelId} aria-selected={active}
            tabIndex={active ? 0 : -1} data-session-id={tab.storedSessionId || undefined} disabled={blocked} title={title}
            className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-midground/60 disabled:cursor-wait"
            onClick={() => void onSelect(tab.id)}>
            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active
              ? !connected ? "bg-warning" : busy || waiting ? "animate-pulse bg-warning" : "bg-success"
              : "bg-midground/40")} />
            <span className="truncate">{title}</span>
          </button>
          {tabs.length > 1 && <button type="button" aria-label={copy.closeTab + ": " + title} title={copy.closeTab}
            disabled={switching || (active && blocked)}
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-100 hover:bg-midground/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-midground/60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 disabled:cursor-wait"
            onClick={() => void onClose(tab.id)}><X aria-hidden className="h-3 w-3" /></button>}
        </div>;
      })}
    </div>
    <div ref={anchor} className="shrink-0">
    <Button type="button" ghost size="icon" disabled={blocked} aria-label={copy.openTab} title={blocked ? copy.tabSwitchBlocked : copy.openTab}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      className="h-8 w-8 shrink-0 rounded-lg p-0"
      onClick={() => { if (open) close(); else showMenu(); }}
      onKeyDown={(event) => { if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) { event.preventDefault(); showMenu(); } }}>
      {switching ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
    </Button>
    </div>
    {open && createPortal(<div ref={panel} id={menuId} role="menu" aria-label={copy.openTab} aria-busy={sessionsLoading}
      onKeyDown={menuKey} style={{ ...position, position: "fixed", zIndex: 100 }}
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background-base p-1 font-sans text-text-primary shadow-lg">
      <button type="button" role="menuitem" className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-midground/10 focus-visible:outline-2 focus-visible:outline-midground/60"
        onClick={() => choose()}><Plus aria-hidden className="h-4 w-4" />{copy.newChat}</button>
      <div role="separator" className="my-1 border-t border-border" />
      <p className="shrink-0 px-3 py-1 text-[11px] text-text-tertiary">{copy.availableSessions}</p>
      {sessionsError && <div role="status" className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-warning">
        <span className="min-w-0 flex-1">{copy.sessionsFailed}: {sessionsError}</span>
        <Button type="button" ghost size="icon" className="h-6 w-6 shrink-0" aria-label={copy.reconnect} disabled={sessionsLoading} onClick={() => void onRefresh()}>
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>}
      {sessionsLoading && <div role="status" className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-text-secondary"><LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />{copy.loadingSessions}</div>}
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {!sessionsLoading && !sessionsError && !sessions.length && <p className="px-3 py-3 text-xs text-text-tertiary">{copy.noAvailableSessions}</p>}
        {sessions.map((session) => {
          const [title, metadata] = webChatSessionLabel(session, copy).split("\n");
          return <button key={session.id} type="button" role="menuitem" data-session-id={session.id} title={title}
            className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-midground/10 focus-visible:outline-2 focus-visible:outline-midground/60"
            onClick={() => choose(session.id)}>
            <span className="w-full truncate text-sm">{title}</span>
            {metadata && <span className="w-full truncate text-[11px] text-text-secondary">{metadata}</span>}
          </button>;
        })}
      </div>
    </div>, document.body)}
  </div>;
}
