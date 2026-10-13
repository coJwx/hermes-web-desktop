import { JsonRpcGatewayError, type ServerRequest, type SessionCreateResult, type SessionResumeResult, type SessionListResult, type SessionHistoryResult, type ModelOptionsResult, type ConfigSetResult, type SubagentListResult, type SubagentTailResult } from "@hermes/shared";
import { GatewayClient } from "./gatewayClient";
import { errorMessage } from "./api-error";
import { initialWebChatState, transcriptMessages, toolResultText, type ChatMessage, type WebChatState, type WebChatUnsentTurn } from "./web-chat-state";
import { WEB_CHAT_MAX_RECONNECT_ATTEMPTS, webChatReconnectDelayMs } from "./web-chat-reconnect";
import { toolResultFailed } from "./web-chat-activity";
import { runWebChatCommand, type WebChatCommandResult } from "./web-chat-commands";
import type { WebChatCopy } from "./web-chat-copy";
import { uploadChatImage } from "./chatImagePaste";
import { detachChatImages, ImageStagingError, stageChatImages, type ChatImage } from "./web-chat-images";
import { sessionModelValue } from "./web-chat-models";
import { applySubagentEvent, reconcileSubagentSnapshot, SUBAGENT_EVENTS, type WebChatSubagent } from "./web-chat-subagents";

const REQUEST_METHODS = new Set(["approval", "clarify", "sudo", "secret"]);

export interface WebChatOptions {
  profile: string;
  restore: () => string | null;
  remember: (id: string) => void;
}

/** Owns one page's transport and transcript; React only subscribes and renders. */
export class WebChatController {
  private state = initialWebChatState();
  private readonly listeners = new Set<() => void>();
  private client: GatewayClient | null = null;
  private detach: Array<() => void> = [];
  private generation = 0;
  private listGeneration = 0;
  private nextId = 0;
  private assistantId: string | null = null;
  private readonly imageCleanup = new Map<string, string[]>();
  private readonly subagentHistory = new Map<string, WebChatSubagent[]>();
  private subagentRequestGeneration: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private manualStop = false;

  constructor(privateOptions: WebChatOptions) { this.options = privateOptions; }
  private readonly options: WebChatOptions;

  getSnapshot = (): WebChatState => this.state;
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
    await this.start(false, this.state.storedSessionId ?? undefined);
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
    for (const listener of this.listeners) listener();
  }

  private patchMessage(id: string, patch: Partial<ChatMessage>) {
    this.update({ messages: this.state.messages.map((row) => row.id === id ? { ...row, ...patch } : row) });
  }

  private assistant(): ChatMessage {
    const existing = this.state.messages.find((row) => row.id === this.assistantId);
    if (existing) return existing;
    const row: ChatMessage = { id: "assistant:" + ++this.nextId, role: "assistant", text: "", status: "working" };
    this.assistantId = row.id;
    this.update({ messages: [...this.state.messages, row] });
    return row;
  }

  private attach(client: GatewayClient, generation: number) {
    const current = () => this.generation === generation;
    const own = (sid?: string) => current() && !!sid && sid === this.state.sessionId;
    this.detach = [
      client.onState((connection) => {
        if (!current()) return;
        this.update({ connection });
        if (connection === "open") {
          this.clearReconnectTimer();
          this.update({ reconnectAttempt: 0, reconnectCountdown: null });
        } else if (connection === "closed" || connection === "error") {
          this.update({ requests: [] });
          this.scheduleReconnect(generation);
        }
      }),
      client.onRequest((request) => {
        if (!current() || !REQUEST_METHODS.has(request.method)) return false;
        // Resume replies deliver open_requests BEFORE their promise resolves.
        if (!this.state.loading && request.params.session_id !== this.state.sessionId) return false;
        this.update({ requests: [...this.state.requests.filter((item) => item.id !== request.id), request] });
        return true;
      }),
      client.on("request.cancel", (event) => {
        if (!current()) return;
        this.update({ requests: this.state.requests.filter((item) => item.id !== event.payload?.id) });
      }),
      client.on("session.info", (event) => {
        if (own(event.session_id)) this.update({ info: { ...this.state.info, ...event.payload } });
      }),
      client.on("sessions.changed", () => {
        if (current() && !this.state.loading) void this.refreshSessions();
      }),
      client.on("message.start", (event) => {
        if (own(event.session_id)) this.update({ busy: true, error: null });
      }),
      client.on("message.delta", (event) => {
        if (!own(event.session_id)) return;
        const row = this.assistant();
        this.patchMessage(row.id, { text: row.text + (event.payload?.text ?? "") });
      }),
      client.on("reasoning.delta", (event) => {
        if (!own(event.session_id)) return;
        const row = this.assistant();
        this.patchMessage(row.id, { reasoning: (row.reasoning ?? "") + (event.payload?.text ?? "") });
      }),
      client.on("reasoning.available", (event) => {
        if (own(event.session_id)) this.patchMessage(this.assistant().id, { reasoning: event.payload?.text ?? "" });
      }),
      client.on("message.interim", (event) => {
        if (!own(event.session_id) || !event.payload) return;
        const row = event.payload.already_streamed ? this.assistant() : null;
        if (row) this.patchMessage(row.id, { role: "commentary", text: event.payload.text, status: "complete" });
        else this.update({ messages: [...this.state.messages, { id: "interim:" + ++this.nextId, role: "commentary", text: event.payload.text }] });
        this.assistantId = null;
      }),
      client.on("message.complete", (event) => {
        if (!own(event.session_id)) return;
        const row = this.assistant();
        const payload = event.payload;
        this.patchMessage(row.id, {
          text: typeof payload?.text === "string" ? payload.text : row.text,
          reasoning: payload?.reasoning ?? row.reasoning,
          status: payload?.status ?? "complete",
        });
        this.assistantId = null;
        this.update({ busy: false, stopping: false, error: payload?.error ?? (payload?.status === "error" ? payload.failure_reason ?? "Hermes could not complete this turn." : null), notice: payload?.warning ?? null });
        void this.refreshSessions();
      }),
      client.on("tool.start", (event) => {
        if (!own(event.session_id) || !event.payload) return;
        const p = event.payload;
        // A tool boundary seals the current reasoning/preamble, so final text appears AFTER tools.
        const preceding = this.state.messages.find((message) => message.id === this.assistantId);
        if (preceding) this.patchMessage(preceding.id, { role: preceding.text.trim() ? "commentary" : "assistant", status: "complete" });
        this.assistantId = null;
        const row: ChatMessage = {
          id: "tool:" + p.tool_id, role: "tool", name: p.name, text: "", status: "working",
          toolArgs: p.args ?? undefined, toolContext: p.context ?? p.preview ?? undefined, toolLabels: p.labels ?? undefined,
        };
        this.update({ messages: [...this.state.messages.filter((item) => item.id !== row.id), row] });
      }),
      client.on("tool.complete", (event) => {
        if (!own(event.session_id) || !event.payload) return;
        const p = event.payload;
        const row: ChatMessage = {
          id: "tool:" + p.tool_id, role: "tool", name: p.name,
          text: p.result_text ?? (p.result === undefined ? p.summary ?? "" : toolResultText(p.result)),
          status: toolResultFailed(p.result) ? "error" : "complete", resultSummary: p.summary ?? undefined,
          durationSeconds: p.duration_s ?? undefined,
          ...(p.args ? { toolArgs: p.args } : {}), ...(p.labels ? { toolLabels: p.labels } : {}),
        };
        if (this.state.messages.some((item) => item.id === row.id)) this.patchMessage(row.id, row);
        else this.update({ messages: [...this.state.messages, row] });
      }),
      client.on("notification.show", (event) => {
        if (own(event.session_id)) this.update({ notice: event.payload?.text ?? null });
      }),
      ...SUBAGENT_EVENTS.map((type) => client.on(type, (event) => {
        if (!own(event.session_id) || !event.payload) return;
        if (!event.payload.subagent_id) { void this.refreshSubagents(); return; }
        this.update({ subagents: applySubagentEvent(this.state.subagents, type, event.payload) });
      })),
    ];
  }

  start = async (fresh = false, selectedId?: string): Promise<void> => {
    if (this.state.storedSessionId) this.subagentHistory.set(this.state.storedSessionId, this.state.subagents);
    this.stop();
    this.manualStop = false;
    this.clearReconnectTimer();
    const generation = this.generation;
    const client = new GatewayClient();
    this.client = client;
    this.assistantId = null;
    const storedId = fresh ? null : selectedId ?? this.state.storedSessionId ?? this.options.restore();
    this.update({ loading: true, submitting: false, commandBusy: false, sendingImages: false, switchingModel: false, error: null, notice: null, requests: [], sessionId: null, sessionsLoading: false, sessionsError: null,
      subagents: [], subagentsError: null, subagentsUnsupported: false });
    this.attach(client, generation);
    try {
      await client.connect();
      if (generation !== this.generation) { client.close(); return; }
      const params = { profile: this.options.profile || undefined, source: "gui", close_on_disconnect: false };
      const snapshot = storedId
        ? await client.request<SessionResumeResult>("session.resume", { ...params, session_id: storedId })
        : await client.request<SessionCreateResult>("session.create", params);
      if (generation !== this.generation) return;
      const resumed = snapshot as SessionResumeResult;
      const persistedId = snapshot.stored_session_id ?? resumed.resumed ?? snapshot.info.stored_session_id ?? storedId ?? snapshot.session_id;
      const cleanup = this.imageCleanup.get(persistedId);
      if (cleanup?.length) {
        const remaining = await detachChatImages(cleanup, (path) => client.request("image.detach", {
          session_id: snapshot.session_id, profile: this.options.profile || undefined, path,
        }));
        if (remaining.length) throw new Error("Could not clear images from a failed send. Reconnect before sending again.");
        this.imageCleanup.delete(persistedId);
        if (generation !== this.generation) return;
      }
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
        loading: false, sessionId: snapshot.session_id, storedSessionId: persistedId,
        info: snapshot.info, messages, busy: !!(resumed.running || snapshot.info.running), stopping: false,
        subagents: reconcileSubagentSnapshot(this.subagentHistory.get(persistedId) || [], []),
        requests: this.state.requests.filter((request) => request.params.session_id === snapshot.session_id),
      });
      void this.refreshSessions();
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: errorMessage(error) });
    }
  };

  refreshSessions = async (): Promise<void> => {
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
    if (!client || !sessionId || this.state.connection !== "open") throw new Error("Hermes is not connected.");
    const result = await client.request<T>(method, { ...params, session_id: sessionId }, method === "complete.slash" ? 10_000 : undefined, signal);
    if (generation !== this.generation || sessionId !== this.state.sessionId) throw new Error("The conversation changed while the request was running.");
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
    const value = sessionModelValue(provider, model);
    const generation = this.generation;
    this.update({ switchingModel: true, error: null });
    try {
      const result = await this.requestSession<ConfigSetResult>("config.set", {
        profile: this.options.profile || undefined, key: "model", value, confirm_expensive_model: confirmed,
      });
      if (generation !== this.generation) return null;
      if (!result.confirm_required) this.update({
        info: { ...this.state.info, provider, model: typeof result.value === "string" ? result.value : model },
        notice: result.warning || null,
      });
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
    if (commandBusy || sendingImages || this.state.submitting || this.state.switchingModel || busy || loading || this.state.requests.length) return false;
    if (!files.length) {
      const ok = await this.submitPrompt(text, text);
      if (ok) this.update({ unsentTurn: null });
      return ok;
    }
    const generation = this.generation;
    const client = this.client!;
    const params = { session_id: sessionId, profile: this.options.profile || undefined };
    this.update({ sendingImages: true, error: null });
    try {
      const images = await stageChatImages(files, {
        upload: (file) => {
          if (generation !== this.generation) throw new Error("The conversation changed while sending images.");
          return uploadChatImage(file, this.options.profile);
        },
        attach: (path) => {
          if (generation !== this.generation) throw new Error("The conversation changed while sending images.");
          return client.request<{ attached: boolean }>("image.attach", { ...params, path });
        },
        detach: (path) => client.request("image.detach", { ...params, path }),
      });
      if (generation !== this.generation || this.state.connection !== "open" || this.state.busy || this.state.requests.length) {
        const pending = await detachChatImages(images.map((image) => image.path!), (path) => client.request("image.detach", { ...params, path }));
        throw new ImageStagingError("The conversation is no longer ready to receive images. Reconnect to check its state.", pending);
      }
      const ok = await this.submitPrompt(text, text, images);
      if (ok) this.update({ unsentTurn: null });
      return ok;
    } catch (error) {
      const pending = error instanceof ImageStagingError ? error.pendingPaths : [];
      if (pending.length && storedSessionId) this.imageCleanup.set(storedSessionId, pending);
      if (generation === this.generation) this.update({ error: errorMessage(error), busy: this.state.busy || !!pending.length });
      if (generation === this.generation) this.update({ error: errorMessage(error), busy: this.state.busy || !!pending.length, unsentTurn: { text, files, error: errorMessage(error) } });
      return false;
    } finally {
      if (generation === this.generation) this.update({ sendingImages: false });
      else client.close();
    }
  };

  private submitPrompt = async (text: string, display: string, images: ChatImage[] = []): Promise<boolean> => {
    const { sessionId, busy, loading, connection } = this.state;
    if ((!text.trim() && !images.length) || !sessionId || busy || this.state.submitting || this.state.switchingModel || loading || connection !== "open" || this.state.requests.length) return false;
    const generation = this.generation;
    const client = this.client!;
    const storedSessionId = this.state.storedSessionId;
    const id = "user:" + ++this.nextId;
    this.assistantId = null;
    this.update({ busy: true, submitting: true, stopping: false, error: null, notice: null, messages: [...this.state.messages, { id, role: "user", text: display, images: images.length ? images : undefined, timestamp: Date.now() / 1000 }] });
    try {
      await client.request("prompt.submit", { session_id: sessionId, profile: this.options.profile || undefined, text });
      return generation === this.generation;
    } catch (error) {
      // A lost acknowledgement is ambiguous: reconnect, never resubmit a model turn.
      const rejected = error instanceof JsonRpcGatewayError;
      const pending = rejected ? await detachChatImages(images.map((image) => image.path!), (path) => client.request("image.detach", { session_id: sessionId, profile: this.options.profile || undefined, path })) : [];
      if (pending.length && storedSessionId) this.imageCleanup.set(storedSessionId, pending);
      if (generation !== this.generation) return false;
      this.update({ error: errorMessage(error), busy: !rejected || !!pending.length, messages: rejected ? this.state.messages.filter((row) => row.id !== id) : this.state.messages });
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

  respond = (request: ServerRequest, result: Record<string, unknown>) => {
    if (this.state.connection !== "open" || !this.state.requests.includes(request)) return;
    request.respond(result);
    this.update({ requests: this.state.requests.filter((item) => item.id !== request.id) });
  };

  stop = () => {
    this.manualStop = true;
    this.clearReconnectTimer();
    this.update({ reconnectCountdown: null });
    this.generation++;
    this.listGeneration++;
    for (const detach of this.detach) detach();
    this.detach = [];
    // Keep an old transport alive until a staged send can undo its image queue.
    if (!this.state.sendingImages) this.client?.close();
    this.client = null;
  };
}
