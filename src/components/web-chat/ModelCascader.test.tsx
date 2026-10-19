// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelCascader } from "./ModelCascader";
import { WebChatController } from "@/lib/web-chat-controller";
import { webChatCopy } from "@/lib/web-chat-copy";
import { json, mountEditor, press, profileResponse, setupEditorDOM } from "@/test/editor-test-utils";

let app: Awaited<ReturnType<typeof mountEditor>> | undefined;
beforeEach(() => {
  setupEditorDOM();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => profileResponse(new URL(url, "http://localhost").pathname) ?? json({})));
});
afterEach(async () => { await app?.unmount(); app = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("ignores menu scrolling, coalesces outer scrolls, and selects providers only when activated", async () => {
  const controller = new WebChatController({ profile: "A", restore: () => null, remember: () => {} });
  vi.spyOn(controller, "getModelOptions").mockResolvedValue({ provider: "custom:a", model: "a-model", providers: [
    { slug: "custom:a", name: "A", models: ["a-model"] }, { slug: "custom:b", name: "B", models: ["b-model"] },
  ] });
  app = await mountEditor(<ModelCascader controller={controller} info={{ provider: "custom:a", model: "a-model" }}
    sessionId="runtime" disabled={false} switching={false} copy={webChatCopy("en")} />);
  await press("Switch model: custom:a/a-model");
  const models = () => document.querySelector('[aria-label="Models"]')!;
  const providers = document.querySelector('[aria-label="Providers"]')!;
  const b = [...providers.querySelectorAll("button")].find(button => button.textContent?.includes("B"))!;
  await act(async () => { b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); b.focus(); });
  expect(models().textContent).toBe("a-model");
  await act(async () => { b.click(); });
  expect(models().textContent).toBe("b-model");
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  await act(async () => { for (let i = 0; i < 12; i++) models().dispatchEvent(new Event("scroll")); });
  expect(measure).not.toHaveBeenCalled();
  await act(async () => { for (let i = 0; i < 12; i++) window.dispatchEvent(new Event("scroll")); });
  expect(frames).toHaveLength(1);
  await act(async () => { frames[0](0); });
  expect(measure).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event("resize")); });
  await press("Switch model: custom:a/a-model");
  expect(cancel).toHaveBeenCalledWith(2);
  controller.stop();
});
