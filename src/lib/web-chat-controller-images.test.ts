import { beforeEach, describe, expect, it, vi } from "vitest";
import { JsonRpcGatewayError } from "@hermes/shared";
import { WebChatController } from "./web-chat-controller";

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  promptFailure: "" as "" | "reject" | "timeout",
  upload: vi.fn(),
}));

vi.mock("./chatImagePaste", () => ({ uploadChatImage: mock.upload }));
vi.mock("./gatewayClient", () => ({
  GatewayClient: class {
    states = new Set<(state: string) => void>();
    onState(listener: (state: string) => void) { this.states.add(listener); return () => { this.states.delete(listener); }; }
    onRequest() { return () => {}; }
    on() { return () => {}; }
    async connect() { for (const listener of this.states) listener("open"); }
    close() { for (const listener of this.states) listener("closed"); }
    async request(method: string, params: Record<string, unknown>) {
      mock.requests.push({ method, params });
      if (method === "session.create" || method === "session.resume") return {
        session_id: "live", stored_session_id: "stored", info: {}, messages: [],
      };
      if (method === "session.list") return { sessions: [] };
      if (method === "image.attach") return { attached: true };
      if (method === "image.detach") return { detached: true };
      if (method === "prompt.submit") {
        if (mock.promptFailure === "reject") throw new JsonRpcGatewayError("refused", { code: 4009 });
        if (mock.promptFailure === "timeout") throw new Error("acknowledgement lost");
        return { status: "streaming" };
      }
      throw new Error("Unexpected RPC " + method);
    }
  },
}));

const file = { name: "photo.png", type: "image/png", size: 100 } as File;
const uploaded = { path: "/profile/images/photo.png", name: file.name, bytes: file.size, mime_type: file.type };
const createController = () => new WebChatController({ profile: "pictures", restore: () => null, remember: () => {} });

beforeEach(() => {
  mock.requests.length = 0;
  mock.promptFailure = "";
  mock.upload.mockReset().mockResolvedValue(uploaded);
});

describe("Image submission through the web chat controller", () => {
  it("locks submission/switching while staging and sends an image-only turn to the same session/profile", async () => {
    const controller = createController();
    await controller.start();
    let finishUpload!: (result: typeof uploaded) => void;
    mock.upload.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
    const sending = controller.submit("", [file]);
    expect(controller.getSnapshot().sendingImages).toBe(true);
    expect(await controller.submit("duplicate")).toBe(false);
    expect(await controller.switchSession("other")).toBe(false);
    expect(mock.requests.some((request) => request.method === "prompt.submit")).toBe(false);
    finishUpload(uploaded);
    expect(await sending).toBe(true);
    expect(mock.upload).toHaveBeenCalledWith(file, "pictures");
    expect(mock.requests.filter((request) => request.method.startsWith("image.") || request.method === "prompt.submit")).toEqual([
      { method: "image.attach", params: { session_id: "live", profile: "pictures", path: uploaded.path } },
      { method: "prompt.submit", params: { session_id: "live", profile: "pictures", text: "" } },
    ]);
    expect(controller.getSnapshot().messages[0]).toMatchObject({ role: "user", text: "", images: [{ path: uploaded.path, name: file.name }] });
    expect(controller.getSnapshot().sendingImages).toBe(false);
    controller.stop();
  });

  it("undoes an explicit rejection but retains an ambiguous prompt without retry or detaching its images", async () => {
    const controller = createController();
    await controller.start();
    mock.promptFailure = "reject";
    expect(await controller.submit("caption", [file])).toBe(false);
    expect(mock.requests.filter((request) => request.method === "image.detach")).toHaveLength(1);
    expect(controller.getSnapshot().busy).toBe(false);
    expect(controller.getSnapshot().messages).toEqual([]);
    mock.promptFailure = "timeout";
    expect(await controller.submit("caption", [file])).toBe(false);
    expect(controller.getSnapshot().busy).toBe(true);
    expect(controller.getSnapshot().messages[0].images).toHaveLength(1);
    expect(mock.requests.filter((request) => request.method === "image.detach")).toHaveLength(1);
    expect(await controller.submit("caption", [file])).toBe(false);
    expect(mock.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
    controller.stop();
  });
});
