import { JsonRpcGatewayError, type ServerRequest, type SessionCreateResult, type SessionResumeResult, type SessionListResult } from "@hermes/shared";
import { GatewayClient } from "./gatewayClient";
import { errorMessage } from "./api-error";
import { initialWebChatState, transcriptMessages, toolResultText, type ChatMessage, type WebChatState } from "./web-chat-state";
import { toolResultFailed } from "./web-chat-activity";

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

  constructor(privateOptions: WebChatOptions) { this.options = privateOptions; }
  private readonly options: WebChatOptions;

  getSnapshot = (): WebChatState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
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
        if (connection === "closed" || connection === "error") this.update({ requests: [] });
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
    ];
  }

  start = async (fresh = false, selectedId?: string): Promise<void> => {
    this.stop();
    const generation = this.generation;
    const client = new GatewayClient();
    this.client = client;
    this.assistantId = null;
    const storedId = fresh ? null : selectedId ?? this.state.storedSessionId ?? this.options.restore();
    this.update({ loading: true, error: null, notice: null, requests: [], sessionId: null, sessionsLoading: false, sessionsError: null });
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

  switchSession = async (id: string): Promise<boolean> => {
    if (!id || this.state.busy || this.state.loading || this.state.requests.length || this.state.connection !== "open") return false;
    if (id === this.state.storedSessionId) return true;
    await this.start(false, id);
    return !!this.state.sessionId && !this.state.error;
  };

  submit = async (text: string): Promise<boolean> => {
    const { sessionId, busy, loading, connection } = this.state;
    if (!text.trim() || !sessionId || busy || loading || connection !== "open" || this.state.requests.length) return false;
    const generation = this.generation;
    const id = "user:" + ++this.nextId;
    this.assistantId = null;
    this.update({ busy: true, stopping: false, error: null, notice: null, messages: [...this.state.messages, { id, role: "user", text, timestamp: Date.now() / 1000 }] });
    try {
      await this.client!.request("prompt.submit", { session_id: sessionId, profile: this.options.profile || undefined, text });
      return generation === this.generation;
    } catch (error) {
      if (generation !== this.generation) return false;
      // A lost acknowledgement is ambiguous: reconnect, never resubmit a model turn.
      const rejected = error instanceof JsonRpcGatewayError;
      this.update({ error: errorMessage(error), busy: !rejected, messages: rejected ? this.state.messages.filter((row) => row.id !== id) : this.state.messages });
      return false;
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
    this.generation++;
    this.listGeneration++;
    for (const detach of this.detach) detach();
    this.detach = [];
    this.client?.close();
    this.client = null;
  };
}
