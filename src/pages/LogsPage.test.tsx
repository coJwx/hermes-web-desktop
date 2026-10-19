// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogsPage from "./LogsPage";
import { api, type LogsResponse } from "@/lib/api";
import { json, mountEditor, press, profileResponse, setupEditorDOM } from "@/test/editor-test-utils";

let app: Awaited<ReturnType<typeof mountEditor>> | undefined;
beforeEach(() => {
  setupEditorDOM();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => profileResponse(new URL(url, "http://localhost").pathname) ?? json({})));
});
afterEach(async () => { await app?.unmount(); app = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("log request ownership and following", () => {
  it("cancels old filters and ignores their late results and errors", async () => {
    let rejectOld!: (reason: Error) => void;
    let finishErrors!: (value: LogsResponse) => void;
    const get = vi.spyOn(api, "getLogs").mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishErrors = resolve; }))
      .mockResolvedValue({ file: "gateway", lines: ["New gateway output"] });
    app = await mountEditor(<LogsPage />);
    const oldSignal = get.mock.calls[0][1]!;
    await press("ERRORS");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { rejectOld(new Error("Obsolete error")); });
    expect(document.body.textContent).not.toContain("Obsolete error");
    await press("GATEWAY", document.querySelector('[role="toolbar"]')!.firstElementChild!);
    await act(async () => { finishErrors({ file: "errors", lines: ["Old errors output"] }); });
    expect(document.body.textContent).toContain("New gateway output");
    expect(document.body.textContent).not.toContain("Old errors output");
  });

  it("avoids overlapping/hidden polls and preserves reading position until the user returns to the bottom", async () => {
    vi.useFakeTimers();
    let finish!: (value: LogsResponse) => void;
    const get = vi.spyOn(api, "getLogs").mockResolvedValue({ file: "agent", lines: ["Initial output"] });
    app = await mountEditor(<LogsPage />);
    const box = document.querySelector<HTMLDivElement>(".font-mono-ui")!;
    Object.defineProperties(box, { clientHeight: { value: 100 }, scrollHeight: { value: 1000, configurable: true } });
    box.scrollTop = 200;
    await act(async () => { box.dispatchEvent(new Event("scroll", { bubbles: true })); });
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { document.getElementById("logs-auto-refresh")!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ file: "agent", lines: ["Refreshed output"] }); });
    expect(box.scrollTop).toBe(200);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(get).toHaveBeenCalledTimes(2);
    box.scrollTop = 900;
    await act(async () => { box.dispatchEvent(new Event("scroll", { bubbles: true })); });
    Object.defineProperty(box, "scrollHeight", { value: 1200, configurable: true });
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(get).toHaveBeenCalledTimes(3);
    expect(box.scrollTop).toBe(1200);
  });
});
