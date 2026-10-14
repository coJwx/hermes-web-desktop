import { type GatewayEvent, type ServerRequest, type SessionListResult, type ConnectionState } from "@hermes/shared";
import { GatewayClient } from "./gatewayClient";
import { WebChatController, type WebChatOptions } from "./web-chat-controller";
import { WebChatSessionTransport } from "./web-chat-session";
import { CHAT_LIMITS, ChatEventBuffer, clientBusy, historyBytes, requestBytes, sessionTitle, trimHistory } from "./web-chat-cache";
import { recoverBinding, reduceSessionEvent, holdEvent, type SessionBinding } from "./web-chat-workspace-recovery";
import type { ChatMessage } from "./web-chat-state";
import { WEB_CHAT_MAX_RECONNECT_ATTEMPTS, webChatReconnectDelayMs } from "./web-chat-reconnect";

export interface WebChatLayout { sessions: string[]; activeSessionId: string | null; }
export interface WebChatWorkspaceOptions extends WebChatOptions {
  restoreLayout?: () => WebChatLayout | null;
  rememberLayout?: (layout: WebChatLayout) => void;
}
export interface WorkspaceTab { id: string; storedSessionId: string | null; title: string | null;
  busy: boolean; waiting: boolean; unread: boolean; syncing: boolean; locked: boolean; error: boolean; }
export interface WorkspaceSnapshot { tabs: WorkspaceTab[]; activeTabId: string; background: WorkspaceTab[];
  controller: WebChatController; opening: boolean; error: string | null; associations: number;
  canReclaim: boolean; busy: boolean; dirty: boolean; compatibility: boolean; replayUnavailable: boolean; newWorkPaused: boolean; }
const sameTab = (a: WorkspaceTab, b: WorkspaceTab) => (Object.keys(a) as Array<keyof WorkspaceTab>).every(key => a[key] === b[key]);
const sameTabs = (a: WorkspaceTab[], b: WorkspaceTab[]) => a.length === b.length && a.every((tab, index) => tab === b[index]);
const BODY_DELTAS = new Set(["message.delta", "reasoning.delta"]);
const REQUESTS = new Set(["approval", "clarify", "sudo", "secret"]);

/** One profile-scoped channel; selecting a view never changes its ownership. */
export class WebChatWorkspace {
  private connection = new GatewayClient({ replay: false });
  get client() { return this.connection; }
  private bindings = new Map<string, SessionBinding>();
  private runtime = new Map<string, SessionBinding>();
  private pending = new Map<string, Promise<SessionBinding | null>>();
  private requests = new Map<string, ServerRequest>();
  private frames = new ChatEventBuffer();
  private pendingRequestBytes = 0;
  private knownMessages = new WeakMap<SessionBinding, ChatMessage[]>();
  private tabSummaries = new WeakMap<SessionBinding, WorkspaceTab>();
  private framesOverflow = false;
  private listeners = new Set<() => void>();
  private unsubscribers: Array<() => void> = [];
  private snapshot!: WorkspaceSnapshot;
  private activeId = "tab-0";
  private nextId = 0;
  private usage = 0;
  private selection = 0;
  private generation = 0;
  private epoch: string | null = null;
  private stopped = true;
  private reservations = 0;
  private draftTabs = new Set<string>();
  private unknownCreate = false;
  private initialAttachmentAttempted = false;
  private compatibility = false;
  private replayUnavailable = false;
  private listPromise: Promise<void> | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private followTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private error: string | null = null;
  private maintaining = false;
  private viewActive = true;
  private restoredLayout = false;
  private initialized = false;
  private starting = false;
  private restoring = false;
  private rememberedLayout: WebChatLayout | null = null;

  private readonly options: WebChatWorkspaceOptions;
  constructor(options: WebChatWorkspaceOptions) {
    this.options = options;
    const layout = options.restoreLayout?.();
    const first = this.makeBinding("tab-0");
    if (layout?.sessions.length) {
      this.restoredLayout = true;
      for (const [index, storedSessionId] of layout.sessions.entries()) {
        const binding = index === 0 ? first : this.makeBinding();
        binding.projection = "refresh-required"; binding.settledBaseline = false;
        binding.controller.patchState({ storedSessionId, loading: true });
        if (storedSessionId === layout.activeSessionId) this.activeId = binding.id;
      }
    }
    this.publish();
  }
  setViewActive = (active: boolean) => {
    this.viewActive = active;
    if (active) {
      const binding = this.bindings.get(this.activeId);
      if (binding) binding.unread = false;
      this.publish();
    }
  };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getBinding = (id: string) => this.bindings.get(id);
  getDiagnostics = () => {
    const bindings = [...this.bindings.values()];
    return { associations: this.snapshot.associations, histories: bindings.filter(b => b.controller.getSnapshot().messages.length).length,
      historyBytes: bindings.reduce((bytes, b) => bytes + historyBytes(b.controller.getSnapshot().messages), 0),
      bufferedBytes: this.bufferedBytes(),
      requestCount: this.requests.size + bindings.reduce((count, b) => count + b.controller.getSnapshot().requests.length, 0),
      previewBytes: bindings.reduce((bytes, b) => bytes + b.preview.length * 2, 0) };
  };
  setDraftPresence = (id: string, present: boolean) => { if (present && !this.bindings.get(id)?.controller.getSnapshot().storedSessionId) this.draftTabs.add(id); else this.draftTabs.delete(id); };
  private makeBinding(id = "tab-" + ++this.nextId): SessionBinding {
    const transport = new WebChatSessionTransport(this.client);
    const controller = new WebChatController({ ...this.options, restore: () => null, remember: () => {}, transport,
      visible: () => this.viewActive && id === this.activeId && document.visibilityState !== "hidden",
      bodyDelay: () => this.viewActive && id === this.activeId ? 16 : 100, allowWork: () => !this.requestPressure(),
      refreshSessions: this.refreshSessions, reconnect: this.reconnect });
    const binding: SessionBinding = { id, connectionGeneration: -1, controller, transport, visible: true, pendingOpen: false, lastUsed: ++this.usage,
      projection: "live-valid", appliedSeq: 0, epoch: this.epoch, held: null, preview: "", unread: false, title: null, syncing: null, calibration: 0, settledBaseline: true, unsubscribe: () => {} };
    this.bindings.set(id, binding);
    binding.unsubscribe = controller.subscribe(() => { this.maintain(binding); this.publish(); });
    return binding;
  }
  private tab(binding: SessionBinding): WorkspaceTab {
    const state = binding.controller.getSnapshot();
    const next: WorkspaceTab = { id: binding.id, storedSessionId: state.storedSessionId, title: binding.title,
      busy: state.busy, waiting: !!state.requests.length, unread: binding.unread, syncing: state.loading || binding.calibration > 0 || (state.busy && binding.projection !== "live-valid"),
      locked: clientBusy(state) || binding.pendingOpen, error: !!state.error };
    const previous = this.tabSummaries.get(binding);
    if (previous && sameTab(previous, next)) return previous;
    this.tabSummaries.set(binding, next); return next;
  }
  private publish = () => {
    const all = [...this.bindings.values()];
    const active = this.bindings.get(this.activeId) ?? all[0];
    const next: WorkspaceSnapshot = { tabs: all.filter(b => b.visible).map(b => this.tab(b)), activeTabId: active.id,
      background: all.filter(b => !b.visible && (b.controller.getSnapshot().busy || b.controller.getSnapshot().requests.length)).map(b => this.tab(b)),
      controller: active.controller, opening: this.pending.size > 0 || this.restoring, error: this.error,
      associations: this.runtime.size + this.reservations,
      canReclaim: all.every(b => { const s = b.controller.getSnapshot(); return !s.busy && !s.requests.length && !clientBusy(s) && !s.unsentTurn; }) && !this.restoring && !this.starting && !this.pending.size && !this.requests.size,
      compatibility: this.compatibility, replayUnavailable: this.replayUnavailable, newWorkPaused: this.requestPressure(),
      busy: all.some(b => clientBusy(b.controller.getSnapshot())), dirty: this.unknownCreate || all.some(b => !!b.controller.getSnapshot().unsentTurn) };
    if (this.initialized && this.options.rememberLayout) {
      const sessions = [...new Set(next.tabs.flatMap(tab => tab.storedSessionId ? [tab.storedSessionId] : []))];
      const activeSessionId = active.controller.getSnapshot().storedSessionId;
      if (!this.rememberedLayout || this.rememberedLayout.activeSessionId !== activeSessionId ||
        sessions.length !== this.rememberedLayout.sessions.length || sessions.some((id, index) => id !== this.rememberedLayout!.sessions[index])) {
        this.rememberedLayout = { sessions, activeSessionId }; this.options.rememberLayout(this.rememberedLayout);
      }
    }
    // Keep summary identities stable when only transcript bodies changed.
    if (this.snapshot) {
      if (sameTabs(this.snapshot.tabs, next.tabs)) next.tabs = this.snapshot.tabs;
      if (sameTabs(this.snapshot.background, next.background)) next.background = this.snapshot.background;
      if ((Object.keys(next) as Array<keyof WorkspaceSnapshot>).every(key => this.snapshot[key] === next[key])) return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  };
  private maintain(changed: SessionBinding) {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      const state = changed.controller.getSnapshot();
      const previous = this.knownMessages.get(changed);
      // Only the changed conversation needs title/window reconciliation.
      if (state.messages !== previous || state.info.title || !changed.title) changed.title = sessionTitle(state) || changed.title;
      if (!changed.visible && !changed.pendingOpen && state.messages.length) {
        changed.projection = "refresh-required"; changed.settledBaseline = false;
        this.knownMessages.set(changed, []);
        changed.controller.patchState({ messages: [], subagents: [] });
      } else if (state.messages !== previous) {
        const trimmed = trimHistory(state.messages);
        this.knownMessages.set(changed, trimmed.messages);
        if (trimmed.truncated) {
          changed.projection = "snapshot-follow"; changed.settledBaseline = false;
          changed.controller.patchState({ messages: trimmed.messages, historyTruncated: true });
        }
      }
      const histories = [...this.bindings.values()].filter(b => b.controller.getSnapshot().messages.length)
        .sort((a, b) => a.id === this.activeId ? -1 : b.id === this.activeId ? 1 : b.lastUsed - a.lastUsed);
      let count = 0; let bytes = 0;
      for (const b of histories) {
        const rows = b.controller.getSnapshot().messages;
        const size = historyBytes(rows);
        if (count + 1 > CHAT_LIMITS.histories || bytes + size > CHAT_LIMITS.historyBytes) {
          b.projection = "refresh-required"; b.settledBaseline = false;
          this.knownMessages.set(b, []); b.controller.patchState({ messages: [], historyTruncated: true });
        } else { count++; bytes += size; }
      }
    } finally { this.maintaining = false; }
  }
  private bufferedBytes() {
    return this.frames.bytes + [...this.bindings.values()].reduce((sum, b) => sum + (b.held?.bytes ?? 0), 0);
  }
  private clearPendingRequests() { this.requests.clear(); this.pendingRequestBytes = 0; }
  private retireView(binding: SessionBinding) {
    binding.title = sessionTitle(binding.controller.getSnapshot()) || binding.title;
    binding.visible = false; binding.projection = "refresh-required"; binding.settledBaseline = false; binding.preview = "";
    binding.controller.patchState({ messages: [], subagents: [] });
  }
  private mapRuntime(binding: SessionBinding, attached = false) {
    if (attached) binding.connectionGeneration = this.generation;
    if (binding.connectionGeneration !== this.generation) return;
    for (const [sid, b] of this.runtime) if (b === binding) this.runtime.delete(sid);
    const sid = binding.controller.getSnapshot().sessionId; if (sid) this.runtime.set(sid, binding);
  }
  private deliverPending = () => {
    for (const b of this.bindings.values()) if (b.visible || b.syncing || b.controller.getSnapshot().busy || b.controller.getSnapshot().requests.length) this.mapRuntime(b);
    for (const [key, request] of this.requests) {
      const b = this.runtime.get(String(request.params.session_id));
      if (b) { b.transport.accept(request); this.pendingRequestBytes -= requestBytes(request); this.requests.delete(key); }
    }
    const frames = this.frames.drain();
    for (const frame of frames) this.onEvent(frame);
    this.publish();
  };
  private onRequest = (request: ServerRequest): boolean => {
    if (this.stopped || !REQUESTS.has(request.method) || typeof request.params.session_id !== "string") return false;
    const binding = this.runtime.get(request.params.session_id);
    if (binding) { binding.transport.accept(request); binding.unread = !this.viewActive || binding.id !== this.activeId; this.publish(); return true; }
    if (this.starting || this.pending.size || this.connectPromise) {
      const key = request.params.session_id + ":" + request.id;
      const previous = this.requests.get(key);
      this.pendingRequestBytes += requestBytes(request) - (previous ? requestBytes(previous) : 0);
      this.requests.set(key, request);
      this.publish(); return true;
    }
    return false;
  };
  private onEvent = (event: GatewayEvent) => {
    if (this.stopped) return;
    if (event.type === "gateway.ready") {
      const next = (event as GatewayEvent<"gateway.ready">).payload?.replay_epoch;
      this.epoch = typeof next === "string" ? next : null;
      if (!this.epoch) this.replayUnavailable = true;
      return;
    }
    if (event.type === "sessions.changed") { void this.refreshSessions(); return; }
    const b = this.runtime.get(event.session_id || "") ?? [...this.bindings.values()].find(binding => binding.syncing && binding.controller.getSnapshot().sessionId === event.session_id);
    if (!b) {
      if (this.starting || this.pending.size || this.connectPromise) {
        const available = CHAT_LIMITS.bufferBytes - this.bufferedBytes() + this.frames.bytes;
        if (!this.frames.push(event, available)) this.framesOverflow = true;
      }
      return;
    }
    const previousReplayUnavailable = this.replayUnavailable;
    const previousProjection = b.projection;
    if (typeof event.seq !== "number") this.replayUnavailable = true;
    if (this.compatibility && b.id !== this.activeId && !b.pendingOpen) return;
    if (b.held && holdEvent(b, event, CHAT_LIMITS.bufferBytes - this.bufferedBytes() + b.held.bytes)) return;
    reduceSessionEvent(b, event);
    if (this.viewActive && b.id === this.activeId) b.unread = false;
    if (!BODY_DELTAS.has(event.type)) { this.maintain(b); this.publish(); }
    else if (b.projection !== previousProjection || this.replayUnavailable !== previousReplayUnavailable) this.publish();
  };
  private replaceConnection() {
    for (const unsubscribe of this.unsubscribers) unsubscribe(); this.unsubscribers = [];
    this.connection = new GatewayClient({ replay: false });
    for (const binding of this.bindings.values()) binding.transport.replaceClient(this.connection);
    this.unsubscribers.push(this.client.onState(this.setConnection), this.client.onAny(this.onEvent), this.client.onRequest(this.onRequest));
  }
  private setConnection = (state: ConnectionState) => {
    for (const b of this.bindings.values()) { b.transport.setConnection(state); b.controller.patchState({ connection: state }); }
    if ((state === "closed" || state === "error") && !this.stopped) this.scheduleReconnect();
  };
  private scheduleReconnect() {
    if (this.reconnectTimer || this.attempt >= WEB_CHAT_MAX_RECONNECT_ATTEMPTS) return;
    const delay = webChatReconnectDelayMs(this.attempt++);
    for (const b of this.bindings.values()) b.controller.patchState({ reconnectAttempt: this.attempt, reconnectCountdown: Math.ceil(delay / 1000) });
    let seconds = Math.ceil(delay / 1000);
    this.countdownTimer = setInterval(() => {
      seconds--;
      if (seconds <= 0) { if (this.countdownTimer) clearInterval(this.countdownTimer); this.countdownTimer = null; }
      for (const binding of this.bindings.values()) binding.controller.patchState({ reconnectCountdown: seconds > 0 ? seconds : null });
    }, 1000);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.reconnect(); }, delay);
  }
  start = async () => {
    this.stopped = false; this.starting = true; this.restoring = this.restoredLayout; this.publish();
    const generation = ++this.generation;
    for (const binding of this.bindings.values()) {
      binding.unsubscribe(); binding.unsubscribe = binding.controller.subscribe(() => { this.maintain(binding); this.publish(); });
    }
    this.unsubscribers.push(this.client.onState(this.setConnection), this.client.onAny(this.onEvent), this.client.onRequest(this.onRequest));
    this.followTimer = setInterval(() => {
      if (!this.viewActive || document.visibilityState === "hidden" || this.client.connectionState !== "open") return;
      const b = this.bindings.get(this.activeId)!; const state = b.controller.getSnapshot();
      if (b.projection === "snapshot-follow" && (state.busy || b.calibration > 0) && !b.syncing && !clientBusy(state)) {
        if (!state.busy) b.calibration--;
        void this.recover(b, true);
      }
    }, 1000);
    try {
      await this.client.connect();
      if (this.stopped || generation !== this.generation) return;
      if (this.restoredLayout) {
        this.initialAttachmentAttempted = true;
        await this.restoreBindings([...this.bindings.values()].sort((a, b) => a.id === this.activeId ? -1 : b.id === this.activeId ? 1 : 0));
      } else await this.open(this.options.restore() ?? undefined, true);
      if (this.stopped || generation !== this.generation) return;
      this.initialized = true; this.publish();
    } catch (error) {
      if (this.stopped || generation !== this.generation) return;
      this.error = error instanceof Error ? error.message : String(error); this.publish(); this.scheduleReconnect();
    } finally { if (generation === this.generation) { this.starting = false; this.restoring = false; this.publish(); } }
  };
  private recover = async (b: SessionBinding, coldOnly = false) => {
    const generation = this.generation;
    if (!b.controller.getSnapshot().sessionId && b.controller.getSnapshot().storedSessionId) {
      const storedId = b.controller.getSnapshot().storedSessionId!;
      await b.controller.start(false, storedId);
      if (this.stopped || generation !== this.generation) return;
      // Refused persisted tabs remain local and retryable; no replacement conversation is created.
      if (!b.controller.getSnapshot().sessionId) b.controller.patchState({ storedSessionId: storedId });
      else {
        b.projection = "snapshot-follow"; b.epoch = this.epoch;
        b.calibration = b.controller.getSnapshot().busy ? 3 : 0;
        b.settledBaseline = !b.controller.getSnapshot().busy;
        this.mapRuntime(b, true); this.deliverPending();
      }
      this.maintain(b); this.publish(); return;
    }
    await recoverBinding(b, this.client, this.options.profile, this.epoch, () => !this.stopped && generation === this.generation,
      () => { this.mapRuntime(b, true); this.deliverPending(); }, coldOnly, this.compatibility, () => { this.compatibility = true; this.publish(); }, () => { this.replayUnavailable = true; this.publish(); });
    if (this.stopped || generation !== this.generation) return;
    this.mapRuntime(b); this.maintain(b); this.publish();
  };
  private restoreBindings = async (bindings: SessionBinding[]) => {
    const generation = this.generation;
    let index = 0;
    await Promise.all([0, 1].map(async () => {
      while (index < bindings.length && !this.stopped && generation === this.generation) {
        const binding = bindings[index++];
        if (!this.compatibility || binding.id === this.activeId) await this.recover(binding);
      }
    }));
    if (this.stopped || generation !== this.generation) return;
    // A resumed lineage can resolve multiple stored IDs to the same conversation.
    const seen = new Map<string, SessionBinding>();
    for (const binding of bindings) {
      const storedId = binding.controller.getSnapshot().storedSessionId;
      if (!storedId || !binding.visible) continue;
      const existing = seen.get(storedId);
      if (!existing) { seen.set(storedId, binding); continue; }
      if (this.activeId === binding.id) this.activeId = existing.id;
      if (binding.controller.getSnapshot().sessionId === existing.controller.getSnapshot().sessionId) {
        binding.unsubscribe(); binding.controller.stop(); this.bindings.delete(binding.id);
        this.mapRuntime(existing, true);
      } else this.retireView(binding);
    }
    const activeStoredId = this.bindings.get(this.activeId)?.controller.getSnapshot().storedSessionId;
    if (activeStoredId) this.options.remember(activeStoredId);
  };
  reconnect = async (): Promise<void> => {
    if (this.countdownTimer) clearInterval(this.countdownTimer); this.countdownTimer = null;
    if (this.client.connectionState === "open") {
      await this.recover(this.bindings.get(this.activeId)!, true);
      this.error = null; this.publish(); return;
    }
    if (this.connectPromise) return this.connectPromise;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    const run = async () => {
      this.generation++; const generation = this.generation;
      this.restoring = true; this.publish();
      this.clearPendingRequests(); this.frames.clear(); this.framesOverflow = false;
      try {
        this.replaceConnection();
        await this.client.connect();
        if (this.stopped || generation !== this.generation) return;
        const needed = [...this.bindings.values()].filter(b => this.compatibility ? b.id === this.activeId : b.visible || b.controller.getSnapshot().busy || b.controller.getSnapshot().requests.length)
          .sort((a,b) => a.id === this.activeId ? -1 : b.id === this.activeId ? 1 : 0);
        for (const [id, binding] of this.bindings) if (!needed.includes(binding) && !binding.visible) { binding.unsubscribe(); binding.controller.stop(); this.bindings.delete(id); }
        this.runtime.clear();
        if (!this.initialAttachmentAttempted && !this.restoredLayout) await this.open(this.options.restore() ?? undefined, true);
        // At most two attach RPCs; other sessions keep their local projection while recovering.
        await this.restoreBindings(needed);
        this.initialized = true;
        if (this.compatibility && needed.length > 1) {
          await this.recover(this.bindings.get(this.activeId)!, true);
          for (const b of needed) if (b.id !== this.activeId) { b.connectionGeneration = -1; b.transport.setConnection("closed"); }
          for (const [sid, b] of this.runtime) if (b.id !== this.activeId) this.runtime.delete(sid);
        }
        this.unknownCreate = false; this.reservations = 0; this.attempt = 0;
        for (const b of needed) b.controller.patchState({ reconnectAttempt: 0, reconnectCountdown: null });
        await this.refreshSessions();
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); this.scheduleReconnect(); }
      if (generation === this.generation) this.restoring = false;
      this.publish();
    };
    this.connectPromise = run().finally(() => { this.connectPromise = null; }); return this.connectPromise;
  };
  refreshSessions = async (): Promise<void> => {
    if (this.listPromise || this.client.connectionState !== "open" || this.stopped) return this.listPromise ?? undefined;
    const generation = this.generation;
    for (const b of this.bindings.values()) b.controller.patchState({ sessionsLoading: true });
    this.listPromise = (async () => {
      try {
        const result = await this.client.request<SessionListResult>("session.list", { profile: this.options.profile || undefined, limit: 100 });
        if (this.stopped || generation !== this.generation) return;
        for (const b of this.bindings.values()) b.controller.patchState({ sessions: result.sessions, sessionsLoading: false, sessionsError: null });
      } catch (error) {
        if (!this.stopped && generation === this.generation) for (const b of this.bindings.values()) b.controller.patchState({ sessionsLoading: false, sessionsError: error instanceof Error ? error.message : String(error) });
      }
    })().finally(() => { this.listPromise = null; }); return this.listPromise;
  };
  open = async (storedId?: string, initial = false): Promise<boolean> => {
    if (this.stopped || this.client.connectionState !== "open" || (this.restoring && !initial)) return false;
    const existing = storedId ? [...this.bindings.values()].find(b => b.controller.getSnapshot().storedSessionId === storedId) : null;
    if (existing) { existing.visible = true; return this.select(existing.id); }
    const key = storedId || "new";
    if (this.pending.has(key)) return !!await this.pending.get(key);
    if (this.unknownCreate || this.runtime.size + this.reservations >= CHAT_LIMITS.bindings || this.requestPressure()) {
      this.error = this.unknownCreate ? "A new conversation may have been created. Reclaim idle connection records before opening another."
        : "This connection has reached its conversation or request limit. Handle pending tasks or reclaim idle connection records.";
      this.publish(); return false;
    }
    if (this.pending.size >= 2) return false;
    if (this.compatibility) {
      if (!this.snapshot.canReclaim) return false;
      this.stopped = true; this.client.close(); this.stopped = false;
      this.generation++; this.replaceConnection(); await this.client.connect(); this.runtime.clear();
    }
    const version = this.selection; const generation = this.generation;
    const placeholder = [...this.bindings.values()].find(b => b.visible && !b.controller.getSnapshot().storedSessionId && !this.draftTabs.has(b.id));
    const binding = placeholder ?? this.makeBinding(); binding.visible = initial || !!placeholder; binding.pendingOpen = true;
    this.reservations++;
    let retainReservation = false;
    const action = async (): Promise<SessionBinding | null> => {
      this.initialAttachmentAttempted = true;
      await binding.controller.start(!storedId, storedId);
      if (this.stopped || generation !== this.generation) return null;
      const state = binding.controller.getSnapshot();
      if (!state.sessionId || state.error) {
        if (!storedId && state.creationUncertain) { this.unknownCreate = true; retainReservation = true; }
        this.error = state.error;
        if (!placeholder) { binding.unsubscribe(); binding.controller.stop(); this.bindings.delete(binding.id); }
        return null;
      }
      const duplicate = [...this.bindings.values()].find(b => b !== binding && b.controller.getSnapshot().storedSessionId === state.storedSessionId);
      if (duplicate) {
        if (state.sessionId !== duplicate.controller.getSnapshot().sessionId) {
          binding.visible = false; binding.projection = "refresh-required"; this.mapRuntime(binding, true);
        } else { binding.unsubscribe(); binding.controller.stop(); this.bindings.delete(binding.id); }
        duplicate.visible = true;
        if (version === this.selection) { this.activeId = duplicate.id; this.options.remember(state.storedSessionId!); }
        this.deliverPending(); return duplicate;
      }
      binding.projection = storedId || this.framesOverflow ? "snapshot-follow" : "live-valid";
      binding.calibration = state.busy || this.framesOverflow ? 3 : 0; binding.epoch = this.epoch; binding.visible = true;
      this.mapRuntime(binding, true); this.deliverPending();
      if (!this.pending.size || this.pending.size === 1) this.framesOverflow = false;
      if (version === this.selection) { this.activeId = binding.id; this.options.remember(state.storedSessionId!); }
      this.error = null; void this.refreshSessions(); return binding;
    };
    // Defer action until reservation/pending routing is visible to synchronous replies.
    const promise = Promise.resolve().then(action).finally(() => {
      binding.pendingOpen = false;
      if (this.pending.get(key) === promise) this.pending.delete(key);
      if (generation === this.generation && !retainReservation) this.reservations--;
      this.publish();
    });
    this.pending.set(key, promise); this.publish(); return !!await promise;
  };
  select = async (id: string): Promise<boolean> => {
    const b = this.bindings.get(id); if (!b?.visible) return false;
    if (this.compatibility && !this.runtime.has(b.controller.getSnapshot().sessionId || "") &&
      (this.snapshot.busy || [...this.runtime.values()].some(binding => !!binding.controller.getSnapshot().requests.length))) return false;
    this.selection++; this.activeId = id; b.unread = false; b.lastUsed = ++this.usage;
    const storedId = b.controller.getSnapshot().storedSessionId; if (storedId) this.options.remember(storedId);
    this.publish();
    if (this.compatibility && !this.runtime.has(b.controller.getSnapshot().sessionId || "")) {
      this.stopped = true; this.client.close(); this.stopped = false;
      await this.reconnect();
    }
    if (b.projection === "refresh-required" && this.client.connectionState === "open") await this.recover(b, true);
    return true;
  };
  close = async (id: string): Promise<boolean> => {
    const b = this.bindings.get(id); const visible = [...this.bindings.values()].filter(b => b.visible);
    if (!b || visible.length <= 1 || clientBusy(b.controller.getSnapshot()) || b.pendingOpen) return false;
    const index = visible.indexOf(b); this.retireView(b);
    if (this.client.connectionState !== "open" && !b.controller.getSnapshot().busy && !b.controller.getSnapshot().requests.length) {
      b.unsubscribe(); b.controller.stop(); this.bindings.delete(id); for (const [sid, value] of this.runtime) if (value === b) this.runtime.delete(sid);
    }
    if (id === this.activeId) await this.select(visible[index > 0 ? index - 1 : 1].id);
    this.maintain(b); this.publish(); return true;
  };
  replace = async (storedId: string): Promise<boolean> => {
    const old = this.bindings.get(this.activeId)!; if (clientBusy(old.controller.getSnapshot())) return false;
    if (!await this.open(storedId)) return false;
    if (old.id !== this.activeId) { this.retireView(old); this.maintain(old); this.publish(); }
    return true;
  };
  reopen = async (id: string) => { const b = this.bindings.get(id); if (!b) return false; b.visible = true; return this.select(id); };
  reclaim = async (): Promise<boolean> => {
    if (!this.snapshot.canReclaim) { this.error = "Finish running tasks, requests and pending sends before reclaiming this connection."; this.publish(); return false; }
    this.stopped = true; this.client.close(); this.stopped = false;
    for (const [id, b] of this.bindings) if (!b.visible) { b.unsubscribe(); b.controller.stop(); this.bindings.delete(id); }
    this.runtime.clear(); this.reservations = 0; this.unknownCreate = false; this.error = null;
    await this.reconnect(); return true;
  };
  enableCompatibility = async (): Promise<boolean> => {
    if (!this.snapshot.canReclaim) return false;
    this.compatibility = true;
    await this.reclaim(); this.publish(); return true;
  };
  requestPressure = () => {
    let count = this.requests.size; let bytes = this.pendingRequestBytes;
    for (const b of this.bindings.values()) {
      count += b.controller.getSnapshot().requests.length;
      bytes += b.controller.getRequestBytes();
    }
    return count >= CHAT_LIMITS.requests || bytes >= CHAT_LIMITS.requestBytes;
  };

  stop = () => {
    this.stopped = true; this.starting = false; this.restoring = false; this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.followTimer) clearInterval(this.followTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer); this.countdownTimer = null;
    this.reconnectTimer = this.followTimer = null;
    for (const unsubscribe of this.unsubscribers) unsubscribe(); this.unsubscribers = [];
    for (const b of this.bindings.values()) { b.unsubscribe(); b.held?.clear(); b.controller.stop(); }
    this.client.close(); this.clearPendingRequests(); this.frames.clear();
  };
}
