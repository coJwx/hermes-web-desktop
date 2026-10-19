import { JsonRpcGatewayError, type ServerRequest, type SessionCreateResult, type SessionResumeResult, type SessionListResult, type SessionHistoryResult, type ModelOptionsResult, type ConfigSetResult, type SubagentListResult, type SubagentTailResult } from "@hermes/shared";
import { GatewayClient } from "./gatewayClient";
import { errorMessage } from "./api-error";
import { initialWebChatState, transcriptMessages, type ChatMessage, type WebChatState, type WebChatUnsentTurn } from "./web-chat-state";
import { WEB_CHAT_MAX_RECONNECT_ATTEMPTS, webChatReconnectDelayMs } from "./web-chat-reconnect";
import { attachSessionEvents } from "./web-chat-session-events";
import { runWebChatCommand, type WebChatCommandResult } from "./web-chat-commands";
import type { WebChatCopy } from "./web-chat-copy";
import { uploadChatImage } from "./chatImagePaste";
import { detachChatImages, ImageStagingError, stageChatImages, type ChatImage } from "./web-chat-images";
import { sessionModelValue, storedSessionModel } from "./web-chat-models";
import { api } from "./api";
import { reconcileSubagentSnapshot, type WebChatSubagent } from "./web-chat-subagents";

import { cacheHistoryAppend, cacheHistoryReplacement, requestsBytes } from "./web-chat-cache";

const REQUEST_METHODS = new Set(["approval", "clarify", "sudo", "secret"]);

export interface WebChatTransport {
  connectionGeneration?: () => number;
  captureRequest?: () => GatewayClient["request"];
  connect: () => Promise<void>;
  close: () => void;
  request: GatewayClient["request"];
  on: GatewayClient["on"];
  onState: GatewayClient["onState"];
  onRequest: GatewayClient["onRequest"];
}

export interface WebChatOptions {
  transport?: WebChatTransport;
  bodyDelay?: () => number;
  visible?: () => boolean;
  allowWork?: () => boolean;
  refreshSessions?: () => Promise<void>;
  reconnect?: () => Promise<void>;
  profile: string;
  restore: () => string | null;
  remember: (id: string) => void;
}

/** Owns one page's transport and transcript; React only subscribes and renders. */
export class WebChatController {
  private state = initialWebChatState();
  private responders = new WeakSet<ServerRequest>();
  private readonly listeners = new Set<() => void>();
  private client: WebChatTransport | null = null;
  private detach: Array<() => void> = [];
  private generation = 0;
  private listGeneration = 0;
  private nextId = 0;
  private assistantId: string | null = null;
  private messagePosition: { id: string; index: number } | null = null;
  private readonly imageCleanup = new Map<string, string[]>();
  private readonly subagentHistory = new Map<string, WebChatSubagent[]>();
  private subagentRequestGeneration: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private manualStop = false;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private modelRead: AbortController | null = null;
  private modelReadKey: string | null = null;
  private modelLoadedKey: string | null = null;

  constructor(privateOptions: WebChatOptions) { this.options = privateOptions; }
  private readonly options: WebChatOptions;

  getSnapshot = (): WebChatState => this.state;
  getRequestBytes = () => requestsBytes(this.state.requests);
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private scheduleReconnect(generation: number) {
    if (this.manualStop || this.generation !== generation) return;
    if (this.state.reconnectAttempt >= WEB_CHAT_MAX_RECONNECT_ATTEMPTS) {
      this.clearReconnectTimer();
      this.update({ reconnectCountdown: null });
      return;
    }
    this.clearReconnectTimer();
    const attempt = this.state.reconnectAttempt;
    const delayMs = webChatReconnectDelayMs(attempt);
    let secondsLeft = Math.ceil(delayMs / 1000);
    this.update({ reconnectAttempt: attempt + 1, reconnectCountdown: secondsLeft });

    this.countdownInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        this.update({ reconnectCountdown: secondsLeft });
      } else {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }, 1000);

    this.reconnectTimer = setTimeout(() => {
      this.clearReconnectTimer();
      this.update({ reconnectCountdown: null });
      if (this.generation === generation && !this.manualStop) {
        void this.start(false, this.state.storedSessionId ?? undefined);
      }
    }, delayMs);
  }

  reconnectNow = async (): Promise<void> => {
    this.clearReconnectTimer();
    this.update({ reconnectCountdown: null });
    if (this.options.reconnect) await this.options.reconnect();
    else await this.start(false, this.state.storedSessionId ?? undefined);
  };

  cancelReconnect = (): void => {
    this.clearReconnectTimer();
    this.update({ reconnectCountdown: null });
  };

  retryUnsent = async (): Promise<boolean> => {
    const unsent = this.state.unsentTurn;
    if (!unsent) return false;
    this.update({ unsentTurn: null });
    const success = await this.submit(unsent.text, unsent.files || []);
    if (!success && !this.state.unsentTurn) {
      this.update({ unsentTurn: unsent });
    }
    return success;
  };

  dismissUnsent = (): WebChatUnsentTurn | null => {
    const unsent = this.state.unsentTurn;
    if (!unsent) return null;
    this.update({ unsentTurn: null });
    return unsent;
  };

  private update(patch: Partial<WebChatState>) {
    this.state = { ...this.state, ...patch };
    const bodyOnly = Object.keys(patch).every(key => key === "messages");
    if (bodyOnly && this.options.bodyDelay) {
      if (!this.publishTimer) this.publishTimer = setTimeout(() => { this.publishTimer = null; for (const listener of this.listeners) listener(); }, this.options.bodyDelay());
      return;
    }
    if (this.publishTimer) clearTimeout(this.publishTimer); this.publishTimer = null;
    for (const listener of this.listeners) listener();
  }

  private messageIndex(id: string | null): number {
    if (!id) return -1;
    const cached = this.messagePosition;
    if (cached?.id === id && this.state.messages[cached.index]?.id === id) return cached.index;
    const index = this.state.messages.findIndex(row => row.id === id);
    this.messagePosition = { id, index }; return index;
  }

  private patchMessage(id: string, patch: Partial<ChatMessage>) {
    const previous = this.state.messages;
    const index = this.messageIndex(id); if (index < 0) return;
    const row = { ...previous[index], ...patch };
    const messages = previous.slice(); messages[index] = row;
    cacheHistoryReplacement(messages, previous, previous[index], row);
    this.update({ messages });
  }

  private assistant(): ChatMessage {
    const index = this.messageIndex(this.assistantId);
    if (index >= 0) return this.state.messages[index];
    const row: ChatMessage = { id: "assistant:" + ++this.nextId, role: "assistant", text: "", status: "working" };
    this.assistantId = row.id;
    const previous = this.state.messages;
    const messages = [...previous, row]; cacheHistoryAppend(messages, previous, row);
    this.messagePosition = { id: row.id, index: previous.length };
    this.update({ messages }); return row;
  }

  private attach(client: WebChatTransport, generation: number) {
    const current = () => this.generation === generation;
    this.detach = [
      client.onState((connection) => {
        if (!current()) return;
        this.update({ connection });
        if (connection === "open") {
          this.clearReconnectTimer();
          this.update({ reconnectAttempt: 0, reconnectCountdown: null });
        } else if (connection === "closed" || connection === "error") {
          this.responders = new WeakSet();
          if (!this.options.transport) this.update({ requests: [] });
          if (!this.options.transport) this.scheduleReconnect(generation);
        }
      }),
      client.onRequest((request) => {
        if (!current() || !REQUEST_METHODS.has(request.method)) return false;
        // Resume replies deliver open_requests BEFORE their promise resolves.
        if (!this.state.loading && request.params.session_id !== this.state.sessionId) return false;
        this.responders.add(request);
        this.update({ requests: [...this.state.requests.filter((item) => item.id !== request.id), request] });
        return true;
      }),
      ...attachSessionEvents(client, { state: this.getSnapshot, update: patch => this.update(patch),
        patchMessage: (id, patch) => this.patchMessage(id, patch), assistant: () => this.assistant(),
        assistantId: () => this.assistantId, clearAssistant: () => { this.assistantId = null; },
        nextId: () => ++this.nextId, refreshSessions: this.refreshSessions, refreshSubagents: this.refreshSubagents,
        refreshSessionModel: this.refreshSessionModel }, current),
    ];
  }

  start = async (fresh = false, selectedId?: string): Promise<void> => {
    if (this.state.storedSessionId) this.subagentHistory.set(this.state.storedSessionId, this.state.subagents);
    this.stop();
    this.manualStop = false;
    this.clearReconnectTimer();
    const generation = this.generation;
    const client = this.options.transport ?? new GatewayClient();
    this.client = client;
    this.assistantId = null;
    const storedId = fresh ? null : selectedId ?? this.state.storedSessionId ?? this.options.restore();
    this.update({ loading: true, submitting: false, commandBusy: false, sendingImages: false, switchingModel: false, error: null, notice: null, requests: [], sessionId: null, sessionsLoading: false, sessionsError: null,
      subagents: [], subagentsError: null, subagentsUnsupported: false });
    this.attach(client, generation);
    try {
      await client.connect();
      if (generation !== this.generation) { if (!this.options.transport) client.close(); return; }
      const params = { profile: this.options.profile || undefined, source: "gui", close_on_disconnect: false };
      const snapshot = storedId
        ? await client.request<SessionResumeResult>("session.resume", { ...params, session_id: storedId })
        : await client.request<SessionCreateResult>("session.create", params);
      if (generation !== this.generation) return;
      const resumed = snapshot as SessionResumeResult;
      const persistedId = snapshot.stored_session_id ?? resumed.resumed ?? resumed.session_key ?? snapshot.info.stored_session_id ?? storedId ?? snapshot.session_id;
      await this.clearImageQueue(snapshot.session_id, persistedId);
      if (generation !== this.generation) return;
      this.restoreSnapshot(snapshot, storedId);
      void this.refreshSessions();
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: errorMessage(error), creationUncertain: !storedId && !(error instanceof JsonRpcGatewayError) });
    }
  };

  clearImageQueue = async (runtimeId = this.state.sessionId, storedId = this.state.storedSessionId) => {
    if (!this.client || !runtimeId || !storedId) return;
    const request = this.client.captureRequest?.() ?? this.client.request.bind(this.client);
    const cleanup = this.imageCleanup.get(storedId);
    if (!cleanup?.length) return;
    const remaining = await detachChatImages(cleanup, path => request("image.detach", {
      session_id: runtimeId, profile: this.options.profile || undefined, path,
    }));
    if (remaining.length) throw new Error("Could not clear images from a failed send. Reconnect before sending again.");
    this.imageCleanup.delete(storedId);
  };

  prepareFinalReplacement = () => {
    const last = this.state.messages.at(-1);
    if (!this.assistantId && last?.role === "assistant" && (!this.state.busy || last.status === "working")) this.assistantId = last.id;
  };

  patchState = (patch: Partial<WebChatState>) => this.update(patch);

  restoreSnapshot = (snapshot: SessionCreateResult | SessionResumeResult, storedId: string | null = this.state.storedSessionId) => {
    const resumed = snapshot as SessionResumeResult;
    const persistedId = snapshot.stored_session_id ?? resumed.resumed ?? resumed.session_key ?? snapshot.info.stored_session_id ?? storedId ?? snapshot.session_id;
    this.assistantId = null;
    const messages = transcriptMessages(snapshot.messages);
    if (resumed.inflight?.user && messages.findLast((row) => row.role === "user")?.text !== resumed.inflight.user) {
      messages.push({ id: "user:" + ++this.nextId, role: "user", text: resumed.inflight.user, timestamp: resumed.turn_started_at ?? undefined });
    }
    if (resumed.inflight?.assistant) {
      this.assistantId = "assistant:" + ++this.nextId;
      messages.push({ id: this.assistantId, role: "assistant", text: resumed.inflight.assistant, status: resumed.running ? "working" : "complete" });
    }
    this.options.remember(persistedId);
    this.update({
      loading: false, historyTruncated: false, creationUncertain: false, sessionId: snapshot.session_id, storedSessionId: persistedId,
      modelConfirmation: this.state.sessionId === snapshot.session_id ? this.state.modelConfirmation : null,
      sessionModel: this.state.storedSessionId === persistedId && this.state.sessionId === snapshot.session_id ? this.state.sessionModel : null,
      info: snapshot.info, messages, busy: !!(resumed.running || snapshot.info.running), stopping: false,
      subagents: reconcileSubagentSnapshot(this.subagentHistory.get(persistedId) || this.state.subagents, []),
      requests: this.state.requests.filter((request) => request.params.session_id === snapshot.session_id &&
        (!Array.isArray(resumed.open_requests) || resumed.open_requests.some(entry => entry.id === request.id))),
    });
    void this.refreshSessionModel();
  };

  private modelScopeKey() {
    return [this.state.storedSessionId, this.state.sessionId, this.generation, this.client?.connectionGeneration?.()].join("\0");
  }

  refreshSessionModel = async (force = false): Promise<void> => {
    const { storedSessionId, sessionId } = this.state;
    const key = this.modelScopeKey();
    if (!storedSessionId || !sessionId || this.state.switchingModel || (!force && (this.modelLoadedKey === key || (this.modelReadKey === key && !this.modelRead?.signal.aborted)))) return;
    this.modelRead?.abort();
    const read = new AbortController();
    this.modelRead = read; this.modelReadKey = key;
    // A different scope must not keep the previous runtime's label while the
    // revalidated detail is in flight; unchanged scopes keep their model.
    if (this.modelLoadedKey !== key && this.state.sessionModel) this.update({ sessionModel: null });
    try {
      const detail = await api.getSessionDetail(storedSessionId, this.options.profile, read.signal);
      if (read.signal.aborted || key !== this.modelScopeKey() || detail.id !== storedSessionId) return;
      this.modelLoadedKey = key;
      this.update({ sessionModel: storedSessionModel(detail.model_config, detail.model) });
    } catch {
      // Model metadata is optional: REST failure must not interrupt the WS conversation.
    } finally {
      if (this.modelRead === read) { this.modelRead = null; this.modelReadKey = null; }
    }
  };

  refreshSessions = async (): Promise<void> => {
    if (this.options.refreshSessions) return this.options.refreshSessions();
    if (!this.client || this.state.connection !== "open") return;
    const generation = this.generation;
    const listGeneration = ++this.listGeneration;
    this.update({ sessionsLoading: true, sessionsError: null });
    try {
      const result = await this.client.request<SessionListResult>("session.list", { profile: this.options.profile || undefined, limit: 100 });
      if (generation === this.generation && listGeneration === this.listGeneration) {
        this.update({ sessions: result.sessions, sessionsLoading: false });
      }
    } catch (error) {
      if (generation === this.generation && listGeneration === this.listGeneration) {
        this.update({ sessionsLoading: false, sessionsError: errorMessage(error) });
      }
    }
  };

  switchSession = async (id: string, force = false): Promise<boolean> => {
    if (!id || this.state.loading || this.state.submitting || this.state.requests.length || this.state.connection !== "open") return false;
    if (!force && (this.state.busy || this.state.commandBusy || this.state.sendingImages || this.state.switchingModel)) return false;
    if (id === this.state.storedSessionId) return true;
    await this.start(false, id);
    return !!this.state.sessionId && !this.state.error;
  };

  requestSession = async <T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> => {
    const client = this.client;
    const { sessionId } = this.state;
    const generation = this.generation;
    const connectionGeneration = client?.connectionGeneration?.();
    if (!client || !sessionId || this.state.connection !== "open") throw new Error("Hermes is not connected.");
    const result = await client.request<T>(method, { ...params, session_id: sessionId }, method === "complete.slash" ? 10_000 : undefined, signal);
    if (generation !== this.generation || connectionGeneration !== client.connectionGeneration?.() || sessionId !== this.state.sessionId) throw new Error("The conversation changed while the request was running.");
    return result;
  };

  private refreshCommandHistory = async (): Promise<void> => {
    const generation = this.generation;
    try {
      const result = await this.requestSession<SessionHistoryResult>("session.history");
      this.assistantId = null;
      this.update({ messages: transcriptMessages(result.messages) });
    } catch (error) {
      if (generation === this.generation) this.update({ error: errorMessage(error) });
    }
  };

  refreshSubagents = async (): Promise<boolean> => {
    const generation = this.generation;
    if (this.options.visible?.() === false) return true;
    if (this.state.loading || !this.state.sessionId || this.state.connection !== "open" || this.state.subagentsUnsupported || this.subagentRequestGeneration === generation) return true;
    this.subagentRequestGeneration = generation;
    const before = this.state.subagents;
    try {
      const result = await this.requestSession<SubagentListResult>("subagent.list", { profile: this.options.profile || undefined });
      if (generation !== this.generation) return true;
      // A live event arriving during the read is newer than this snapshot.
      this.update({ subagents: before === this.state.subagents ? reconcileSubagentSnapshot(before, result.subagents || []) : this.state.subagents, subagentsError: null });
      return true;
    } catch (error) {
      if (generation !== this.generation) return true;
      const unsupported = error instanceof JsonRpcGatewayError && error.code === -32601;
      this.update({ subagentsError: unsupported ? null : errorMessage(error), subagentsUnsupported: unsupported });
      return unsupported;
    } finally {
      if (this.subagentRequestGeneration === generation) this.subagentRequestGeneration = null;
    }
  };

  getSubagentTail = (id: string, signal?: AbortSignal): Promise<SubagentTailResult> =>
    this.requestSession<SubagentTailResult>("subagent.tail", { profile: this.options.profile || undefined, subagent_id: id }, signal);

  getModelOptions = (refresh = false, signal?: AbortSignal): Promise<ModelOptionsResult> =>
    this.requestSession<ModelOptionsResult>("model.options", { profile: this.options.profile || undefined, include_unconfigured: false, refresh }, signal);

  switchModel = async (provider: string, model: string, confirmed = false): Promise<ConfigSetResult | null> => {
    if (this.state.loading || this.state.busy || this.state.submitting || this.state.commandBusy || this.state.sendingImages || this.state.switchingModel || this.state.requests.length || !this.state.sessionId || this.state.connection !== "open") return null;
    if (this.options.allowWork?.() === false) return null;
    const value = sessionModelValue(provider, model);
    const generation = this.generation;
    this.modelRead?.abort();
    this.update({ switchingModel: true, error: null });
    try {
      const result = await this.requestSession<ConfigSetResult>("config.set", {
        profile: this.options.profile || undefined, key: "model", value, confirm_expensive_model: confirmed,
      });
      if (generation !== this.generation) return null;
      if (result.confirm_required) this.update({ modelConfirmation: { provider, model, sessionId: this.state.sessionId!, message: result.confirm_message || result.warning || "Confirm model change" } });
      if (!result.confirm_required) {
        this.modelLoadedKey = this.modelScopeKey();
        this.update({
          modelConfirmation: null,
          info: { ...this.state.info, provider, model: typeof result.value === "string" ? result.value : model },
          sessionModel: { provider, model: typeof result.value === "string" ? result.value : model },
          notice: result.warning || null,
        });
      }
      return result;
    } catch (error) {
      if (generation === this.generation) this.update({ error: errorMessage(error) });
      throw error;
    } finally {
      if (generation === this.generation) this.update({ switchingModel: false });
    }
  };

  executeCommand = async (command: string, copy: WebChatCopy): Promise<WebChatCommandResult> => {
    if (this.state.loading || this.state.busy || this.state.submitting || this.state.commandBusy || this.state.sendingImages || this.state.switchingModel || this.state.requests.length || !this.state.sessionId || this.state.connection !== "open") return { accepted: false };
    if (this.options.allowWork?.() === false) return { accepted: false };
    const generation = this.generation;
    this.update({ commandBusy: true, error: null });
    try {
      const result = await runWebChatCommand({
        request: this.requestSession,
        submit: (text, display) => this.submitPrompt(text, display),
        refreshHistory: this.refreshCommandHistory,
        output: (name, text) => {
          if (generation === this.generation) this.update({ messages: [...this.state.messages, { id: "command:" + ++this.nextId, role: "command", name, text }] });
        },
      }, command, copy);
      if (generation !== this.generation) return { accepted: false };
      if (result.accepted) void this.refreshSessionModel(true);
      void this.refreshSessions();
      return result;
    } catch (error) {
      if (generation === this.generation) this.update({ error: errorMessage(error) });
      return { accepted: false };
    } finally {
      if (generation === this.generation) this.update({ commandBusy: false });
    }
  };

  submit = async (text: string, files: File[] = []): Promise<boolean> => {
    const { sessionId, storedSessionId, busy, loading, connection, sendingImages, commandBusy } = this.state;
    if (connection !== "open" || !sessionId) {
      this.update({ unsentTurn: { text, files, error: "Disconnected" } });
      return false;
    }
    if (this.options.allowWork?.() === false) return false;
    if (this.state.modelConfirmation) return false;
    if (commandBusy || sendingImages || this.state.submitting || this.state.switchingModel || busy || loading || this.state.requests.length) return false;
    if (!files.length) {
      const ok = await this.submitPrompt(text, text);
      if (ok) this.update({ unsentTurn: null });
      return ok;
    }
    const generation = this.generation;
    const client = this.client!;
    const request = client.captureRequest?.() ?? client.request.bind(client);
    const connectionGeneration = client.connectionGeneration?.();
    const current = () => generation === this.generation && connectionGeneration === client.connectionGeneration?.();
    const params = { session_id: sessionId, profile: this.options.profile || undefined };
    this.update({ sendingImages: true, error: null });
    try {
      const images = await stageChatImages(files, {
        upload: (file) => {
          if (!current()) throw new Error("The connection changed while sending images.");
          return uploadChatImage(file, this.options.profile);
        },
        attach: (path) => {
          if (!current()) throw new Error("The connection changed while sending images.");
          return request<{ attached: boolean }>("image.attach", { ...params, path });
        },
        detach: (path) => request("image.detach", { ...params, path }),
      });
      if (!current() || this.state.connection !== "open" || this.state.busy || this.state.requests.length) {
        const pending = await detachChatImages(images.map((image) => image.path!), (path) => request("image.detach", { ...params, path }));
        throw new ImageStagingError("The conversation is no longer ready to receive images. Reconnect to check its state.", pending);
      }
      const ok = await this.submitPrompt(text, text, images);
      if (ok) this.update({ unsentTurn: null });
      return ok;
    } catch (error) {
      const pending = error instanceof ImageStagingError ? error.pendingPaths : [];
      if (pending.length && storedSessionId) this.imageCleanup.set(storedSessionId, pending);
      if (generation === this.generation) this.update({ error: errorMessage(error), busy: this.state.busy || !!pending.length, unsentTurn: { text, files, error: errorMessage(error) } });
      return false;
    } finally {
      if (generation === this.generation) this.update({ sendingImages: false });
      else if (!this.options.transport) client.close();
    }
  };

  private submitPrompt = async (text: string, display: string, images: ChatImage[] = []): Promise<boolean> => {
    const { sessionId, busy, loading, connection } = this.state;
    if ((!text.trim() && !images.length) || !sessionId || busy || this.state.submitting || this.state.switchingModel || loading || connection !== "open" || this.state.requests.length) return false;
    const generation = this.generation;
    const client = this.client!;
    const request = client.captureRequest?.() ?? client.request.bind(client);
    const storedSessionId = this.state.storedSessionId;
    const id = "user:" + ++this.nextId;
    this.assistantId = null;
    this.update({ busy: true, submitting: true, stopping: false, error: null, notice: null, messages: [...this.state.messages, { id, role: "user", text: display, images: images.length ? images : undefined, timestamp: Date.now() / 1000 }] });
    try {
      await request("prompt.submit", { session_id: sessionId, profile: this.options.profile || undefined, text });
      return generation === this.generation;
    } catch (error) {
      // A lost acknowledgement is ambiguous: reconnect, never resubmit a model turn.
      const rejected = error instanceof JsonRpcGatewayError;
      const pending = rejected ? await detachChatImages(images.map((image) => image.path!), (path) => request("image.detach", { session_id: sessionId, profile: this.options.profile || undefined, path })) : [];
      if (pending.length && storedSessionId) this.imageCleanup.set(storedSessionId, pending);
      if (generation !== this.generation) return false;
      this.update({ error: errorMessage(error), busy: !rejected || !!pending.length, unsentTurn: rejected ? null : { text, files: [], error: errorMessage(error), uncertain: true }, messages: rejected ? this.state.messages.filter((row) => row.id !== id) : this.state.messages });
      return false;
    } finally {
      if (generation === this.generation) this.update({ submitting: false });
    }
  };

  interrupt = async (): Promise<void> => {
    if (!this.state.sessionId || !this.state.busy || this.state.stopping || this.state.connection !== "open") return;
    const generation = this.generation;
    this.update({ stopping: true });
    try {
      await this.client!.request("session.interrupt", { session_id: this.state.sessionId, profile: this.options.profile || undefined });
    } catch (error) {
      if (generation === this.generation) this.update({ stopping: false, error: errorMessage(error) });
    }
  };

  canRespond = (request: ServerRequest) => this.state.connection === "open" && !this.state.loading && this.responders.has(request) && this.state.requests.includes(request);

  respond = (request: ServerRequest, result: Record<string, unknown>) => {
    if (!this.canRespond(request)) return;
    request.respond(result);
    this.update({ requests: this.state.requests.filter((item) => item.id !== request.id) });
  };

  stop = () => {
    this.manualStop = true;
    this.responders = new WeakSet();
    this.modelRead?.abort(); this.modelRead = null;
    this.modelReadKey = this.modelLoadedKey = null;
    if (this.publishTimer) clearTimeout(this.publishTimer); this.publishTimer = null;
    this.clearReconnectTimer();
    this.update({ reconnectCountdown: null });
    this.generation++;
    this.listGeneration++;
    for (const detach of this.detach) detach();
    this.detach = [];
    // Keep an old transport alive until a staged send can undo its image queue.
    if (!this.options.transport && !this.state.sendingImages) this.client?.close();
    this.client = null;
  };
}
