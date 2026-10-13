import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Bot, ImagePlus, LoaderCircle, Plus, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { looksLikeSlashCommand } from "@hermes/shared";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useProfileScope } from "@/contexts/useProfileScope";
import { useWebChat } from "@/hooks/useWebChat";
import { useWebChatTabs } from "@/hooks/useWebChatTabs";
import { useSlashCompletion } from "@/hooks/useSlashCompletion";
import { webChatCopy } from "@/lib/web-chat-copy";
import { webChatSessionLabel } from "@/lib/web-chat-session-label";
import { cn } from "@/lib/utils";
import { MessageRow } from "@/components/web-chat/MessageRow";
import { RequestCard } from "@/components/web-chat/RequestCard";
import { ToolCallGroup } from "@/components/web-chat/ToolCallGroup";
import { groupChatTranscript } from "@/lib/web-chat-activity";
import { SlashCompletionMenu } from "@/components/web-chat/SlashCompletionMenu";
import type { SlashCompletionEdit } from "@/lib/web-chat-completion";
import { useWebChatImages } from "@/hooks/useWebChatImages";
import { imageFilesFromTransfer, transferMayContainImage } from "@/lib/chatImagePaste";
import { WEB_CHAT_IMAGE_ACCEPT } from "@/lib/web-chat-images";
import { ImagePreview } from "@/components/web-chat/ImagePreview";
import { ModelCascader } from "@/components/web-chat/ModelCascader";
import { SubagentPanel } from "@/components/web-chat/SubagentPanel";
import { WEB_CHAT_MAX_RECONNECT_ATTEMPTS } from "@/lib/web-chat-reconnect";
import { ConversationTabs } from "@/components/web-chat/ConversationTabs";

export default function WebChatPage() {
  const { locale } = useI18n();
  const copy = webChatCopy(locale);
  const { profile, currentProfile } = useProfileScope();
  const { setTitle, setAfterTitle } = usePageHeader();
  const { state, controller } = useWebChat(profile || currentProfile);
  const tabState = useWebChatTabs(controller, state);
  const { tabs, activeTabId, switching, blocked, availableSessions, selectableSessions,
    openTab: loadTab, switchTab: loadExistingTab, closeTab: removeTab, switchSession: loadSession } = tabState;
  const tabIdPrefix = useId();
  const panelId = tabIdPrefix + "-panel";
  const transcript = useMemo(() => groupChatTranscript(state.messages), [state.messages]);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollBox = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const images = useWebChatImages((profile || currentProfile) + ":" + (state.storedSessionId || "new"), copy);
  const follow = useRef(true);
  const drafts = useRef(new Map<string, string>());
  const connected = state.connection === "open";
  const canSend = connected && !switching && !state.loading && !state.busy && !state.submitting && !state.commandBusy && !state.sendingImages && !state.switchingModel && !!state.sessionId && !state.requests.length;
  const canAttach = !switching && !state.loading && !state.sendingImages;
  const hasContent = !!draft.trim() || !!images.images.length;
  const completion = useSlashCompletion({ value: draft, cursor, enabled: canSend && composerFocused, sessionId: state.sessionId, controller });
  const status = state.loading ? copy.loading : !connected ? copy.disconnected : state.requests.length ? copy.waiting : state.switchingModel ? copy.switchingModel : state.sendingImages ? copy.sendingImages : state.commandBusy ? copy.runningCommand : state.busy ? copy.thinking : copy.connected;

  useEffect(() => {
    setTitle(copy.title);
    return () => setTitle(null);
  }, [setTitle, copy.title]);

  useLayoutEffect(() => {
    if (follow.current && scrollBox.current) scrollBox.current.scrollTop = scrollBox.current.scrollHeight;
  }, [state.messages, state.requests, state.notice]);

  const jumpToLatest = useCallback(() => {
    follow.current = true;
    setAwayFromBottom(false);
    if (scrollBox.current) scrollBox.current.scrollTop = scrollBox.current.scrollHeight;
  }, []);

  const send = async () => {
    if (!canSend || !hasContent) return;
    const text = draft;
    const attachments = images.images;
    if (attachments.length && looksLikeSlashCommand(text.trim())) { images.setError(copy.imagesWithCommand); return; }
    images.setError(null);
    jumpToLatest();
    const result = looksLikeSlashCommand(text.trim())
      ? await controller.executeCommand(text.trim(), copy)
      : { accepted: await controller.submit(text, attachments.map((image) => image.file)) };
    if (result.accepted) {
      images.remove(attachments.map((image) => image.id));
      const replacement = result.prefill ?? "";
      completion.dismiss();
      setDraft((current) => current === text ? replacement : current);
      if (input.current) input.current.style.height = "auto";
      requestAnimationFrame(() => {
        if (input.current?.value === replacement) {
          input.current.focus();
          input.current.setSelectionRange(replacement.length, replacement.length);
          setCursor(replacement.length);
        }
      });
    }
  };

  const applyCompletion = (edit: SlashCompletionEdit) => {
    setDraft(edit.value);
    setCursor(edit.cursor);
    input.current?.focus();
    requestAnimationFrame(() => {
      if (input.current?.value === edit.value) input.current.setSelectionRange(edit.cursor, edit.cursor);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter used by an IME to commit Chinese/Japanese must not submit a turn.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (completion.handleKeyDown(event, applyCompletion)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const saveDraft = useCallback((id: string | null, text: string) => {
    if (!id) return;
    drafts.current.set(id, text);
  }, []);

  const restoreDraft = useCallback(() => {
    const id = controller.getSnapshot().storedSessionId;
    const text = id ? drafts.current.get(id) ?? "" : "";
    setDraft(text);
    setCursor(text.length);
    if (input.current) input.current.style.height = "auto";
    jumpToLatest();
  }, [controller, jumpToLatest]);

  const switchTab = useCallback(async (id: string) => {
    saveDraft(state.storedSessionId, draft);
    if (await loadExistingTab(id)) restoreDraft();
  }, [draft, loadExistingTab, restoreDraft, saveDraft, state.storedSessionId]);

  const openTab = useCallback(async (id?: string) => {
    saveDraft(state.storedSessionId, draft);
    if (await loadTab(id)) restoreDraft();
  }, [draft, loadTab, restoreDraft, saveDraft, state.storedSessionId]);

  const closeTab = useCallback(async (id: string) => {
    const active = id === activeTabId;
    if (active) saveDraft(state.storedSessionId, draft);
    if (await removeTab(id) && active) restoreDraft();
  }, [activeTabId, draft, removeTab, restoreDraft, saveDraft, state.storedSessionId]);

  const switchSession = async (id: string) => {
    saveDraft(state.storedSessionId, draft);
    if (await loadSession(id)) restoreDraft();
  };

  const headerTabs = useMemo(() => <ConversationTabs tabs={tabs} activeTabId={activeTabId} tabIdPrefix={tabIdPrefix} panelId={panelId}
    sessions={availableSessions} sessionsLoading={state.sessionsLoading} sessionsError={state.sessionsError} blocked={blocked} switching={switching}
    connected={connected} busy={state.busy} waiting={!!state.requests.length} copy={copy}
    onSelect={switchTab} onClose={closeTab} onOpen={openTab} onRefresh={controller.refreshSessions} />,
  [tabs, activeTabId, tabIdPrefix, panelId, availableSessions, state.sessionsLoading, state.sessionsError, blocked, switching,
    connected, state.busy, state.requests.length, copy, switchTab, closeTab, openTab, controller.refreshSessions]);

  useLayoutEffect(() => { setAfterTitle(headerTabs); }, [headerTabs, setAfterTitle]);
  useEffect(() => () => setAfterTitle(null), [setAfterTitle]);

  const reconnect = async () => {
    const pendingDraft = state.busy && state.error && !connected && !state.unsentTurn
      ? state.messages.findLast((message) => message.role === "user")?.text : null;
    await controller.start();
    const snap = controller.getSnapshot();
    if (!snap.error && pendingDraft === draft && snap.messages.findLast((message) => message.role === "user")?.text === draft) {
      setDraft("");
      if (snap.storedSessionId) drafts.current.delete(snap.storedSessionId);
    }
  };

  return <section id={panelId} role="tabpanel" aria-labelledby={tabIdPrefix + "-" + activeTabId}
    className="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label={copy.title}>
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-current/10 px-2 py-1 sm:gap-3 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 text-xs text-text-secondary" title={status + " · /api/ws"}>
        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-warning")} />
        <span role="status" aria-live="polite" className="hidden sm:inline">{status}</span>
        <span className="hidden rounded border border-current/10 px-1.5 py-0.5 lg:inline">{profile || currentProfile}</span>
      </div>
      <div className="min-w-0 flex-1 sm:max-w-xs" role="group" aria-label={copy.switchSession}
        title={state.busy || state.commandBusy || state.sendingImages || state.switchingModel ? copy.switchBlocked : copy.switchSession}
        onFocusCapture={() => void controller.refreshSessions()}>
        <Select value={state.storedSessionId ?? ""}
          placeholder={state.sessionsLoading ? copy.loadingSessions : copy.switchSession}
          disabled={blocked || state.busy}
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
          {selectableSessions.map((session) => <SelectOption key={session.id} value={session.id}>
            {webChatSessionLabel(session, copy)}
          </SelectOption>)}
        </Select>
      </div>
      {state.storedSessionId && <span className="min-w-0 max-w-[24%] truncate font-mono text-[10px] text-text-tertiary sm:max-w-[18rem]"
        title={copy.sessionId + ": " + state.storedSessionId}>
        {copy.sessionId}: {state.storedSessionId}
      </span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button ghost size="sm" className="h-7 px-2" disabled={switching || state.loading || state.submitting || state.sendingImages || state.switchingModel} onClick={() => void reconnect()} aria-label={copy.reconnect}>
          <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">{copy.reconnect}</span>
        </Button>
        <Button ghost size="sm" className="h-7 px-2" disabled={blocked} onClick={() => void openTab()} aria-label={copy.newChat}>
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
              : <MessageRow key={block.id} message={block.message} copy={copy} profile={profile || currentProfile} />)}
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
        <SubagentPanel key={state.sessionId || "new"} controller={controller} sessionId={state.sessionId} connected={connected && !state.loading}
          rows={state.subagents} error={state.subagentsError} unsupported={state.subagentsUnsupported} copy={copy} />
        {!!state.requests.length && <div className="mb-3 max-h-[35dvh] space-y-3 overflow-y-auto">{state.requests.map((request) =>
          <RequestCard key={request.id} request={request} copy={copy} respond={controller.respond} />)}
        </div>}
        {state.reconnectCountdown !== null && (
          <div role="status" className="mb-3 flex items-center justify-between rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text-primary">
            <div className="flex items-center gap-2">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-warning" />
              <span>{copy.reconnectingIn.replace("{seconds}", String(state.reconnectCountdown)).replace("{attempt}", String(state.reconnectAttempt))}</span>
            </div>
            <Button type="button" size="sm" className="h-6 px-2 text-xs" onClick={() => void controller.reconnectNow()}>
              {copy.reconnectNow}
            </Button>
          </div>
        )}
        {state.connection === "closed" && state.reconnectAttempt >= WEB_CHAT_MAX_RECONNECT_ATTEMPTS && (
          <div role="alert" className="mb-3 flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>{copy.reconnectExhausted}</span>
            <Button type="button" size="sm" className="h-6 px-2 text-xs" onClick={() => void controller.reconnectNow()}>
              {copy.reconnectNow}
            </Button>
          </div>
        )}
        {state.unsentTurn && (
          <div role="region" aria-label={copy.unsentNotice} className="mb-3 flex items-center justify-between rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
            <div className="min-w-0 flex-1 truncate pr-2">
              <span className="font-medium text-warning">{copy.unsentNotice}: </span>
              <span className="text-text-secondary truncate">{state.unsentTurn.text || "…"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" size="sm" className="h-6 px-2 text-xs" disabled={!canSend} onClick={() => void controller.retryUnsent()}>
                {copy.retrySend}
              </Button>
              <Button type="button" ghost size="sm" className="h-6 px-2 text-xs text-text-secondary" onClick={() => {
                const dismissed = controller.dismissUnsent();
                if (dismissed?.text) {
                  setDraft(dismissed.text);
                  input.current?.focus();
                }
              }}>
                {copy.restoreDraft}
              </Button>
            </div>
          </div>
        )}
        <form className="relative rounded-2xl border border-midground/25 bg-midground/[0.035] p-3 transition-colors focus-within:border-midground/60"
          onDragOver={(event) => { if (transferMayContainImage(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = canAttach ? "copy" : "none"; } }}
          onDrop={(event) => {
            const files = imageFilesFromTransfer(event.dataTransfer);
            if (!files.length) return;
            event.preventDefault();
            if (canAttach) images.add(files);
          }}
          onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {completion.visible && <SlashCompletionMenu id={completion.id} items={completion.items} selected={completion.index}
            replaceFrom={completion.replaceFrom} loading={completion.loading} error={completion.error} copy={copy}
            onHighlight={completion.highlight} onChoose={(index) => { const edit = completion.choose(index); if (edit) applyCompletion(edit); }} />}
          {!!images.images.length && <div className="mb-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto p-1">
            {images.images.map((image) => <div key={image.id} className="relative h-20 w-20 shrink-0 rounded-xl border border-current/10 bg-midground/5 sm:h-24 sm:w-24">
              <ImagePreview source={image.previewUrl} name={image.file.name} label={copy.previewImage} />
              <Button type="button" ghost size="icon" aria-label={copy.removeImage + ": " + image.file.name} disabled={state.sendingImages}
                className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/60 p-0 text-white hover:bg-black/80 [&>svg]:size-3.5"
                onClick={() => images.remove([image.id])}><X aria-hidden /></Button>
            </div>)}
          </div>}
          {images.error && <p role="alert" className="mb-2 whitespace-pre-wrap text-xs text-destructive">{images.error}</p>}
          <input ref={imageInput} type="file" accept={WEB_CHAT_IMAGE_ACCEPT} multiple hidden onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            if (canAttach) images.add(files);
          }} />
          <label className="block"><span className="sr-only">{copy.placeholder}</span>
            <textarea ref={input} rows={2} value={draft} placeholder={copy.placeholder + copy.keyboard} onKeyDown={onKeyDown} disabled={switching || state.loading || state.sendingImages}
              onPaste={(event) => {
                const files = imageFilesFromTransfer(event.clipboardData);
                if (!files.length) return;
                event.preventDefault();
                if (canAttach) images.add(files);
                const text = event.clipboardData.getData("text/plain");
                if (canAttach && text) {
                  const start = event.currentTarget.selectionStart;
                  const end = event.currentTarget.selectionEnd;
                  setDraft((current) => current.slice(0, start) + text + current.slice(end));
                  setCursor(start + text.length);
                }
              }}
              aria-autocomplete="list" aria-haspopup="listbox"
              aria-controls={completion.visible ? completion.id : undefined}
              aria-activedescendant={completion.visible && completion.items.length ? completion.id + "-" + completion.index : undefined}
              onFocus={(event) => { setComposerFocused(true); setCursor(event.target.selectionStart); completion.reopen(); }}
              onBlur={() => setComposerFocused(false)} onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
              className="max-h-48 min-h-14 w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-text-tertiary focus-visible:outline-none"
              onChange={(event) => { setDraft(event.target.value); setCursor(event.target.selectionStart); event.target.style.height = "auto"; event.target.style.height = Math.min(event.target.scrollHeight, 192) + "px"; }} />
          </label>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" ghost size="icon" className="h-8 w-8 shrink-0 rounded-full bg-midground/5 p-0 [&>svg]:size-5" aria-label={copy.addImages} title={copy.addImages} disabled={!canAttach}
                onClick={() => imageInput.current?.click()}><ImagePlus aria-hidden /></Button>
              <ModelCascader key={state.sessionId || "new"} controller={controller} info={state.info} sessionId={state.sessionId} copy={copy}
                switching={state.switchingModel} disabled={switching || !connected || state.loading || state.busy || state.submitting || state.commandBusy || state.sendingImages || !state.sessionId || !!state.requests.length} />
            </div>
            {state.commandBusy || state.sendingImages || state.switchingModel ? <Button type="button" size="icon" className="h-9 w-9 shrink-0 rounded-full p-0" aria-label={state.switchingModel ? copy.switchingModel : state.sendingImages ? copy.sendingImages : copy.runningCommand} disabled>
              <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" />
            </Button> : state.busy ? <Button type="button" size="icon" className="h-9 w-9 shrink-0 rounded-full p-0" aria-label={state.stopping ? copy.stopping : copy.stop} disabled={!connected || state.stopping} onClick={() => void controller.interrupt()}>
              <Square aria-hidden className="h-3.5 w-3.5" fill="currentColor" />
            </Button> : <Button type="submit" ghost size="icon" className="h-9 w-9 shrink-0 rounded-full bg-[#4073ed] p-0 text-white transition-colors hover:bg-[#3264dc] disabled:bg-[#b3c8f5] disabled:text-white [&>svg]:size-6" aria-label={copy.send} disabled={!canSend || !hasContent}>
              <ArrowUp aria-hidden strokeWidth={3} />
            </Button>}
          </div>
        </form>
      </div>
    </div>
  </section>;
}
