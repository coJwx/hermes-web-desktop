// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDesktopLeaveHandler } from "./desktop-leave";

let cleanup = () => {};
afterEach(() => { cleanup(); delete window.__HERMES_DESKTOP__; vi.unstubAllGlobals(); });
const id = "00000000-0000-4000-8000-000000000001";
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("native leave adapter", () => {
  it("does nothing in browser mode and never treats a pending/busy/cancelled request as approval", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    let state = { dirty: true, busy: false };
    let accept = () => {};
    let reject = () => {};
    const approved = vi.fn();
    const confirm = vi.fn((yes, no) => { accept = yes; reject = no; });
    const handler = { readState: () => state, approved, confirm, cancel: vi.fn() };
    cleanup = installDesktopLeaveHandler(handler);
    expect(window.__HERMES_DESKTOP_REQUEST_LEAVE__).toBeUndefined();
    window.__HERMES_DESKTOP__ = true;
    cleanup = installDesktopLeaveHandler(handler);
    window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id);
    await tick();
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).decision).toBe("pending");
    reject(); await tick();
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body as string).decision).toBe("deny");
    window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); await tick();
    state = { dirty: true, busy: true };
    accept(); await tick();
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body as string).decision).toBe("busy");
    expect(approved).not.toHaveBeenCalledWith(true);
  });

  it("correlates timeout cancellation, checks allow failures and cleans up the renderer bridge", async () => {
    window.__HERMES_DESKTOP__ = true;
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    let accept = () => {};
    const approved = vi.fn();
    const cancel = vi.fn();
    cleanup = installDesktopLeaveHandler({ readState: () => ({ dirty: true, busy: false }), approved, cancel,
      confirm: (yes) => { accept = yes; },
    });
    window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); await tick();
    window.__HERMES_DESKTOP_CANCEL_LEAVE__!("wrong");
    expect(cancel).not.toHaveBeenCalled();
    window.__HERMES_DESKTOP_CANCEL_LEAVE__!(id);
    accept(); await tick();
    expect(approved).not.toHaveBeenCalledWith(true);
    window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); await tick();
    fetch.mockResolvedValueOnce(new Response(null, { status: 409 }));
    accept(); await tick();
    expect(approved).toHaveBeenCalledWith(true);
    expect(approved).toHaveBeenLastCalledWith(false);
    window.__HERMES_DESKTOP_REQUEST_LEAVE__!(id); await tick();
    accept(); await tick();
    expect(approved).toHaveBeenLastCalledWith(true);
    window.__HERMES_DESKTOP_CANCEL_LEAVE__!(id);
    expect(approved).toHaveBeenLastCalledWith(false);
    cleanup();
    expect(window.__HERMES_DESKTOP_REQUEST_LEAVE__).toBeUndefined();
  });
});
