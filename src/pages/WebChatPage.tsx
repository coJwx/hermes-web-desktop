import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Bot, LoaderCircle, Plus, RotateCcw, Square } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useProfileScope } from "@/contexts/useProfileScope";
import { useWebChat } from "@/hooks/useWebChat";
import { webChatCopy } from "@/lib/web-chat-copy";
import { webChatSessionLabel } from "@/lib/web-chat-session-label";
import { cn } from "@/lib/utils";
import { MessageRow } from "@/components/web-chat/MessageRow";
import { RequestCard } from "@/components/web-chat/RequestCard";
import { ToolCallGroup } from "@/components/web-chat/ToolCallGroup";
import { groupChatTranscript } from "@/lib/web-chat-activity";

export default function WebChatPage() {
  const { locale } = useI18n();
  const copy = webChatCopy(locale);
  const { profile, currentProfile } = useProfileScope();
  const { setTitle } = usePageHeader();
  const { state, controller } = useWebChat(profile || currentProfile);
  const transcript = useMemo(() => groupChatTranscript(state.messages), [state.messages]);
  const [draft, setDraft] = useState("");
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollBox = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const drafts = useRef(new Map<string, string>());
  const connected = state.connection === "open";
  const canSend = connected && !state.loading && !state.busy && !!state.sessionId && !state.requests.length;
  const status = state.loading ? copy.loading : !connected ? copy.disconnected : state.requests.length ? copy.waiting : state.busy ? copy.thinking : copy.connected;

  useEffect(() => {
    setTitle(copy.title);
    return () => setTitle(null);
  }, [setTitle, copy.title]);

  useLayoutEffect(() => {
    if (follow.current && scrollBox.current) scrollBox.current.scrollTop = scrollBox.current.scrollHeight;
  }, [state.messages, state.requests, state.notice]);

  const jumpToLatest = () => {
    follow.current = true;
    setAwayFromBottom(false);
    if (scrollBox.current) scrollBox.current.scrollTop = scrollBox.current.scrollHeight;
  };

  const send = async () => {
    if (!canSend || !draft.trim()) return;
    const text = draft;
    jumpToLatest();
    const accepted = await controller.submit(text);
    if (accepted) {
      setDraft((current) => current === text ? "" : current);
      if (input.current) input.current.style.height = "auto";
      input.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter used by an IME to commit Chinese/Japanese must not submit a turn.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      void send();
    }
  };

  const switchSession = async (id: string) => {
    if (state.storedSessionId) drafts.current.set(state.storedSessionId, draft);
    if (await controller.switchSession(id)) {
      setDraft(drafts.current.get(id) ?? "");
      jumpToLatest();
    }
  };

  const newChat = async () => {
    if (state.storedSessionId) drafts.current.set(state.storedSessionId, draft);
    await controller.start(true);
    if (!controller.getSnapshot().error) { setDraft(""); jumpToLatest(); }
  };

  return <section className="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label={copy.title}>
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-current/10 px-2 py-1 sm:gap-3 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 text-xs text-text-secondary" title={status + " · /api/ws"}>
        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-warning")} />
        <span role="status" aria-live="polite" className="hidden sm:inline">{status}</span>
        <span className="hidden rounded border border-current/10 px-1.5 py-0.5 lg:inline">{profile || currentProfile}</span>
      </div>
      <div className="min-w-0 flex-1 sm:max-w-xs" role="group" aria-label={copy.switchSession}
        title={state.busy ? copy.switchBlocked : copy.switchSession}
        onFocusCapture={() => void controller.refreshSessions()}>
        <Select value={state.storedSessionId ?? ""}
          placeholder={state.sessionsLoading ? copy.loadingSessions : copy.switchSession}
          disabled={!connected || state.loading || state.busy || !!state.requests.length}
          className={cn(
            "min-w-0",
            "[&_button]:h-7 [&_button]:rounded-lg [&_button]:border-border [&_button]:bg-midground/5 [&_button]:px-2.5 [&_button]:text-xs",
            "[&_button]:font-sans [&_button]:normal-case [&_button]:tracking-normal",
            "[&_button>span]:line-clamp-1 [&_button>span]:whitespace-pre [&_button>span]:leading-5",
            "[&_[role=listbox]]:mt-2 [&_[role=listbox]]:max-h-[min(20rem,45dvh)] [&_[role=listbox]]:rounded-xl [&_[role=listbox]]:border-border [&_[role=listbox]]:p-1 [&_[role=listbox]]:shadow-lg",
            "[&_[role=option]]:rounded-lg [&_[role=option]]:px-3 [&_[role=option]]:py-2 [&_[role=option]]:font-sans [&_[role=option]]:text-xs",
            "[&_[role=option]]:normal-case [&_[role=option]]:tracking-normal [&_[role=option][aria-selected=true]]:bg-midground/10",
            "[&_[role=option]]:items-start [&_[role=option]>svg]:mt-1",
            "[&_[role=option]>span]:min-w-0 [&_[role=option]>span]:flex-1 [&_[role=option]>span]:whitespace-pre [&_[role=option]>span]:text-[11px] [&_[role=option]>span]:leading-5 [&_[role=option]>span]:text-text-secondary",
            "[&_[role=option]>span]:first-line:text-xs [&_[role=option]>span]:first-line:font-medium [&_[role=option]>span]:first-line:text-text-primary",
          )}
          onValueChange={(id) => void switchSession(id)}>
          {state.storedSessionId && !state.sessions.some((session) => session.id === state.storedSessionId) &&
            <SelectOption value={state.storedSessionId}>{state.info.title || copy.newChat}</SelectOption>}
          {state.sessions.map((session) => <SelectOption key={session.id} value={session.id}>
            {webChatSessionLabel(session, copy)}
          </SelectOption>)}
        </Select>
      </div>
      {state.storedSessionId && <span className="min-w-0 max-w-[24%] truncate font-mono text-[10px] text-text-tertiary sm:max-w-[18rem]"
        title={copy.sessionId + ": " + state.storedSessionId}>
        {copy.sessionId}: {state.storedSessionId}
      </span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button ghost size="sm" className="h-7 px-2" disabled={state.loading} onClick={() => void controller.start()} aria-label={copy.reconnect}>
          <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">{copy.reconnect}</span>
        </Button>
        <Button ghost size="sm" className="h-7 px-2" disabled={state.busy || state.loading} onClick={() => void newChat()} aria-label={copy.newChat}>
          <Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">{copy.newChat}</span>
        </Button>
      </div>
    </div>
    {state.sessionsError && <p role="status" className="shrink-0 px-2 py-1 text-xs text-warning sm:px-4">{copy.sessionsFailed}: {state.sessionsError}</p>}

    <div className="relative min-h-0 flex-1">
    <div ref={scrollBox} className="h-full min-h-0 overflow-y-auto overscroll-contain px-2 pr-14 sm:px-4 sm:pr-16" onScroll={(event) => {
      const node = event.currentTarget;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      setAwayFromBottom(!follow.current);
    }}>
      <div className="mx-auto w-full max-w-3xl py-6 sm:py-8">
        {state.loading && !state.messages.length ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-text-secondary" aria-busy="true"><LoaderCircle className="h-4 w-4 animate-spin" />{copy.loading}</div> :
          !state.messages.length && !state.error ? <div className="flex min-h-[min(45vh,24rem)] flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-midground/20 bg-midground/5 text-midground"><Bot className="h-6 w-6" /></div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{copy.emptyTitle}</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-text-secondary">{copy.emptyHint}</p>
            <div className="mt-7 flex max-w-xl flex-wrap justify-center gap-2">{copy.samples.map((sample) =>
              <Button key={sample} ghost size="sm" className="h-auto whitespace-normal rounded-lg border border-current/15 px-3 py-2 text-left text-xs" disabled={!canSend}
                onClick={() => { setDraft(sample); input.current?.focus(); }}>{sample}</Button>)}
            </div>
          </div> : <div role="log" aria-live="off" aria-label={copy.title} className="space-y-6">
            {transcript.map((block) => block.kind === "activity"
              ? <ToolCallGroup key={block.id} rows={block.rows} copy={copy} />
              : <MessageRow key={block.id} message={block.message} copy={copy} />)}
          </div>}
        {state.busy && !state.requests.length && <div className="mt-5 flex items-center gap-2 text-xs text-text-secondary"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{state.stopping ? copy.stopping : copy.thinking}</div>}
        {state.notice && <p role="status" className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-warning/20 p-3 text-xs text-text-secondary">{state.notice}</p>}
        {state.error && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="whitespace-pre-wrap break-words text-destructive">{state.error}</p><p className="mt-2 text-xs text-text-secondary">{copy.retryHint}</p>
        </div>}
      </div>
    </div>
    {awayFromBottom && <div className="pointer-events-none absolute bottom-3 left-2 right-14 z-10 sm:left-4 sm:right-16">
      <div className="relative mx-auto h-9 w-full max-w-3xl">
        <Button type="button" ghost size="icon" aria-label={copy.scroll}
          className="pointer-events-auto absolute -right-12 top-0 h-9 w-9 rounded-full border border-current/15 bg-background-base text-text-primary shadow-sm hover:bg-midground/5"
          onClick={jumpToLatest}>
          <ArrowDown aria-hidden className="h-5 w-5" />
        </Button>
      </div>
    </div>}
    </div>

    <div className="relative shrink-0 px-2 sm:px-4 sm:pb-2">
      <div className="mx-auto w-full max-w-3xl">
        {!!state.requests.length && <div className="mb-3 max-h-[35dvh] space-y-3 overflow-y-auto">{state.requests.map((request) =>
          <RequestCard key={request.id} request={request} copy={copy} respond={controller.respond} />)}
        </div>}
        <form className="rounded-2xl border border-midground/25 bg-midground/[0.035] p-3 transition-colors focus-within:border-midground/60" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label className="block"><span className="sr-only">{copy.placeholder}</span>
            <textarea ref={input} rows={2} value={draft} placeholder={copy.placeholder + copy.keyboard} onKeyDown={onKeyDown} disabled={state.loading}
              className="max-h-48 min-h-14 w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-text-tertiary focus-visible:outline-none"
              onChange={(event) => { setDraft(event.target.value); event.target.style.height = "auto"; event.target.style.height = Math.min(event.target.scrollHeight, 192) + "px"; }} />
          </label>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-[11px] text-text-tertiary" title={state.info.model}>{state.info.model || "Hermes"}</span>
            {state.busy ? <Button type="button" size="sm" disabled={!connected || state.stopping} onClick={() => void controller.interrupt()}><Square className="h-3 w-3" />{state.stopping ? copy.stopping : copy.stop}</Button> :
              <Button type="submit" size="sm" disabled={!canSend || !draft.trim()}><ArrowUp className="h-3.5 w-3.5" />{copy.send}</Button>}
          </div>
        </form>
      </div>
    </div>
  </section>;
}
