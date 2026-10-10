interface Frame {
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

interface Conversation {
  session_id: string;
  stored_session_id: string;
  messages: Array<{ role: string; text: string }>;
  info: { model: string; profile_name: string };
  running: boolean;
  open_requests?: Array<{ id: string; method: string; params: Record<string, unknown> }>;
}

/** Wire-level fixture: production GatewayClient and JsonRpcRequestChannel remain real. */
export class ChatTestSocket extends EventTarget {
  static OPEN = 1;
  static instances: ChatTestSocket[] = [];
  static conversations = new Map<string, Conversation>();
  static next = 0;
  static rejectNext = false;
  static loseNextAck = false;
  readyState = 0;
  readonly url: string;
  readonly frames: Frame[] = [];
  conversation: Conversation | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    ChatTestSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      this.event("gateway.ready", { heartbeat: false, replay_epoch: "test" }, "");
    });
  }

  send(text: string) {
    const frame = JSON.parse(text) as Frame;
    this.frames.push(frame);
    if (!frame.method) {
      if (this.conversation?.open_requests) this.conversation.open_requests = this.conversation.open_requests.filter((request) => request.id !== frame.id);
      return;
    }
    queueMicrotask(() => this.answer(frame));
  }

  private answer(frame: Frame) {
    const p = frame.params ?? {};
    const reply = (result: unknown) => this.receive({ id: frame.id, result });
    const handlers: Record<string, () => void> = {
      "client.capabilities": () => reply({ server_requests: ["approval", "clarify", "sudo", "secret"] }),
      "session.list": () => reply({ sessions: [...ChatTestSocket.conversations.values()]
        .filter((conversation) => conversation.info.profile_name === p.profile)
        .map((conversation) => ({
          id: conversation.stored_session_id, title: conversation.messages[0]?.text ?? "New chat",
          started_at: Date.now() / 1000 - 600, message_count: conversation.messages.length, source: "gui",
        })) }),
      "session.create": () => {
        const n = ++ChatTestSocket.next;
        this.conversation = { session_id: "live-" + n, stored_session_id: "stored-" + n, messages: [], info: { model: "test-model", profile_name: String(p.profile) }, running: false };
        ChatTestSocket.conversations.set(this.conversation.stored_session_id, this.conversation);
        reply(this.conversation);
      },
      "session.resume": () => {
        const stored = ChatTestSocket.conversations.get(String(p.session_id));
        if (!stored || stored.info.profile_name !== p.profile) {
          this.receive({ id: frame.id, error: { code: 4007, message: "session not found" } }); return;
        }
        this.conversation = stored;
        reply(stored);
      },
      "prompt.submit": () => {
        if (ChatTestSocket.rejectNext) {
          ChatTestSocket.rejectNext = false;
          this.receive({ id: frame.id, error: { code: 4090, message: "Request refused" } }); return;
        }
        this.conversation!.messages.push({ role: "user", text: String(p.text) });
        this.conversation!.running = true;
        if (ChatTestSocket.loseNextAck) {
          ChatTestSocket.loseNextAck = false;
          this.close(); return;
        }
        reply({ status: "streaming" });
        this.event("message.start");
      },
      "session.interrupt": () => reply({ status: "interrupted", interrupted: true }),
      "session.events.since": () => reply({ events: [], open_requests: this.conversation?.open_requests ?? [], epoch: "test" }),
    };
    handlers[frame.method!]?.();
  }

  receive(frame: Frame) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ jsonrpc: "2.0", ...frame }) }));
  }

  event(type: string, payload: Record<string, unknown> = {}, sessionId = this.conversation?.session_id ?? "") {
    this.receive({ method: "event", params: { type, payload, session_id: sessionId } });
  }

  request(id: string, method: string, params: Record<string, unknown> = {}) {
    this.receive({ id, method, params: { session_id: this.conversation?.session_id, ...params } });
  }

  finish(text: string, status = "complete") {
    this.conversation!.running = false;
    this.conversation!.messages.push({ role: "assistant", text });
    this.event("message.complete", { text, status });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
  }

  static reset() {
    ChatTestSocket.instances = [];
    ChatTestSocket.conversations = new Map();
    ChatTestSocket.next = 0;
    ChatTestSocket.rejectNext = ChatTestSocket.loseNextAck = false;
  }
}
