// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfigPage from "./ConfigPage";
import { getManagementProfile } from "@/lib/api";
import { input, json, mountEditor, press, profileResponse, setupEditorDOM, unloadPrevented } from "@/test/editor-test-utils";

let app: Awaited<ReturnType<typeof mountEditor>>;
let failLoad: boolean;
let failRaw: boolean;
let failSave: boolean;
let completeSave: (() => void) | undefined;
let holdSave: boolean;
let writes: string[];
let nativeReplies: Array<{ request_id: string; decision: string }>;
let records: Record<string, { limit: number }>;

beforeEach(() => {
  setupEditorDOM();
  failLoad = failRaw = failSave = holdSave = false;
  completeSave = undefined;
  writes = [];
  nativeReplies = [];
  records = { A: { limit: 1 }, B: { limit: 2 } };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const request = new URL(url, "http://localhost");
    const path = request.pathname;
    const profile = request.searchParams.get("profile") || "A";
    const profiles = profileResponse(path);
    if (profiles) return profiles;
    if (path === "/__desktop/leave") {
      nativeReplies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    if (init?.method === "PUT") {
      writes.push(profile);
      if (holdSave) await new Promise<void>((resolve) => { completeSave = resolve; });
      if (failSave) return json({ detail: "Save unavailable" }, 503);
      const body = JSON.parse(String(init.body));
      records[profile] = body.config ?? { limit: Number(body.yaml_text.split(":")[1]) };
      return json({ ok: true });
    }
    if (path === "/api/config") return failLoad ? json({ detail: "Config unavailable" }, 500) : json(records[profile]);
    if (path === "/api/config/schema") return json({ fields: { limit: { type: "number", category: "general" } }, category_order: ["general"] });
    if (path === "/api/config/defaults") return json({ limit: 0 });
    if (path === "/api/config/raw") return failRaw ? json({ detail: "YAML unavailable" }, 503) : json({ yaml: "limit: " + records[profile].limit, path: profile + "/config.yaml" });
    throw new Error("Unexpected request " + url);
  }));
});

afterEach(async () => {
  await app?.unmount();
  delete window.__HERMES_DESKTOP__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const field = () => document.querySelector<HTMLInputElement>('input[type="number"]')!;
const yaml = () => document.querySelector<HTMLTextAreaElement>("textarea")!;

describe("config editing contracts", () => {
  it("uses the same dirty/busy confirmation for native actions and only bypasses one approved unload", async () => {
    window.__HERMES_DESKTOP__ = true;
    app = await mountEditor(<ConfigPage />);
    const id = "00000000-0000-4000-8000-000000000001";
    await input(field(), "13");
    await press("Leave editor");
    await act(async () => { window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); });
    expect(nativeReplies.at(-1)?.decision).toBe("pending");
    await press("Keep editing");
    expect(nativeReplies.at(-1)?.decision).toBe("deny");
    expect(field().value).toBe("13");
    expect(unloadPrevented()).toBe(true);
    await press("Leave editor");
    await act(async () => { window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); });
    await press("Discard and continue");
    expect(nativeReplies.at(-1)?.decision).toBe("allow");
    expect(app.router.state.location.pathname).toBe("/edit");
    expect(unloadPrevented()).toBe(false);
    expect(unloadPrevented()).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Loading");
    await act(async () => { window.__HERMES_DESKTOP_CANCEL_LEAVE__!(id); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    holdSave = true;
    await press("Save");
    await act(async () => { window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); });
    expect(nativeReplies.at(-1)?.decision).toBe("busy");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { completeSave!(); });
  });
  it("recovers failed loads and preserves drafts through cancelled switches and failed reads/writes", async () => {
    failLoad = true;
    app = await mountEditor(<ConfigPage />);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Config unavailable");
    failLoad = false;
    await press("Retry");
    expect(field().value).toBe("1");
    expect(unloadPrevented()).toBe(false);

    await input(field(), "7");
    expect(unloadPrevented()).toBe(true);
    await press("YAML");
    await press("Keep editing");
    expect(field().value).toBe("7");

    failRaw = true;
    await press("YAML");
    await press("Discard and continue");
    expect(field().value).toBe("7");
    expect(unloadPrevented()).toBe(true);
    failRaw = false;
    failSave = true;
    await press("Save");
    expect(field().value).toBe("7");
    expect(unloadPrevented()).toBe(true);
    failSave = false;
    await press("Save");
    expect(unloadPrevented()).toBe(false);

    await press("YAML");
    expect(yaml().value).toBe("limit: 7");
    await input(yaml(), "limit: 9");
    await press("Form");
    await press("Keep editing");
    expect(yaml().value).toBe("limit: 9");
    failSave = true;
    await press("Save");
    expect(yaml().value).toBe("limit: 9");
    expect(unloadPrevented()).toBe(true);
    failSave = false;
    await press("Save");
    await press("Form");
    expect(field().value).toBe("9");
    expect(unloadPrevented()).toBe(false);
  });

  it("guards profile A→B→A and navigation without retargeting pending writes or remounting the shell", async () => {
    app = await mountEditor(<ConfigPage />);
    await press("Host 0");
    await input(field(), "8");
    await press("Switch profile");
    expect(getManagementProfile()).toBe("A");
    await press("Keep editing");
    expect(field().value).toBe("8");

    holdSave = true;
    await press("Save");
    await press("Switch profile");
    expect(getManagementProfile()).toBe("A");
    expect(writes).toEqual(["A"]);
    await act(async () => { completeSave!(); });
    holdSave = false;
    await press("Switch profile");
    expect(field().value).toBe("2");
    expect(getManagementProfile()).toBe("B");
    await input(field(), "12");
    await press("Switch profile");
    await press("Discard and continue");
    expect(field().value).toBe("8");
    expect(getManagementProfile()).toBe("A");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await input(field(), "10");
    await press("Leave editor");
    await press("Keep editing");
    expect(app.router.state.location.pathname).toBe("/edit");
    await act(async () => { await app.router.navigate(-1); });
    await press("Keep editing");
    expect(field().value).toBe("10");
    await act(async () => { await app.router.navigate(-1); });
    await press("Discard and continue");
    expect(app.router.state.location.pathname).toBe("/other");
    expect(unloadPrevented()).toBe(false);
    expect(document.body.textContent).toContain("Host 1");
    await act(async () => { await app.router.navigate(1); });
    expect(field().value).toBe("8");
  });
});
