import { GatewayEventHub, type ServerRequest, type GatewayEvent, type ConnectionState } from "@hermes/shared";
import type { WebChatTransport } from "./web-chat-controller";
import { GatewayClient } from "./gatewayClient";

/** Local delivery endpoint only: the workspace owns the real JSON-RPC channel. */
export class WebChatSessionTransport implements WebChatTransport {
  private events = new GatewayEventHub();
  private states = new Set<(state: ConnectionState) => void>();
  private requests = new Set<(request: ServerRequest) => boolean | void>();
  private client: GatewayClient;
  private version = 0;
  connectionGeneration = () => this.version;
  captureRequest = (): GatewayClient["request"] => this.client.request.bind(this.client);
  replaceClient(client: GatewayClient) { this.client = client; this.version++; }
  constructor(client: GatewayClient) { this.client = client; }
  connect = async () => { this.setConnection(this.client.connectionState); };
  close = () => {};
  request: GatewayClient["request"] = (method, params, timeout, signal) => this.client.request(method, params, timeout, signal);
  on: GatewayClient["on"] = (type, handler) => this.events.on(type, handler);
  onState: GatewayClient["onState"] = (handler) => {
    this.states.add(handler); handler(this.client.connectionState);
    return () => { this.states.delete(handler); };
  };
  onRequest: GatewayClient["onRequest"] = (handler) => {
    this.requests.add(handler); return () => { this.requests.delete(handler); };
  };
  setConnection(state: ConnectionState) { for (const handler of this.states) handler(state); }
  event(event: GatewayEvent) { this.events.dispatch(event); }
  accept(request: ServerRequest) { for (const handler of this.requests) if (handler(request)) return true; return false; }
}
