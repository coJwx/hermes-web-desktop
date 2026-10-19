// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebChatMediaCache } from "./web-chat-media";

const json = (source: string) => new Response(JSON.stringify({ data_url: source }), { headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("workspace media cache", () => {
  it("shares in-flight reads, reuses completed data, and keeps profiles isolated", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(json("profile-b"));
    vi.stubGlobal("fetch", fetch);
    const cache = new WebChatMediaCache();
    const a = cache.acquire("A", "/same.png");
    const other = cache.acquire("A", "/same.png");
    a.release();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    finish(json("profile-a"));
    expect(await other.promise).toBe("profile-a");
    other.release();
    expect(await cache.acquire("A", "/same.png").promise).toBe("profile-a");
    expect(await cache.acquire("B", "/same.png").promise).toBe("profile-b");
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.clear();
  });

  it("evicts least-used data by bytes/entry count and does not retain oversized responses", async () => {
    const fetch = vi.fn(async () => json("1234"));
    vi.stubGlobal("fetch", fetch);
    const cache = new WebChatMediaCache(16, 2);
    await cache.acquire("A", "a").promise;
    await cache.acquire("A", "b").promise;
    cache.get("A", "a");
    await cache.acquire("A", "c").promise;
    expect(cache.get("A", "a")).toBe("1234");
    expect(cache.get("A", "b")).toBeUndefined();
    fetch.mockResolvedValueOnce(json("too-large-for-this-cache"));
    await cache.acquire("A", "large").promise;
    expect(cache.get("A", "large")).toBeUndefined();
    expect(cache.get("A", "a")).toBe("1234");
    const one = new WebChatMediaCache(100, 1);
    await one.acquire("A", "a").promise; await one.acquire("A", "b").promise;
    expect(one.get("A", "a")).toBeUndefined();
    cache.clear(); one.clear();
  });

  it("cancels unobserved reads and prevents late responses from repopulating a disposed cache", async () => {
    const pending: Array<(value: Response) => void> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(resolve => pending.push(resolve)));
    vi.stubGlobal("fetch", fetch);
    const cache = new WebChatMediaCache();
    const first = cache.acquire("A", "image");
    first.release(); first.release();
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const second = cache.acquire("A", "image");
    cache.clear();
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
    pending[0](json("old")); pending[1](json("late"));
    await Promise.all([first.promise, second.promise]);
    expect(cache.get("A", "image")).toBeUndefined();
    const third = cache.acquire("A", "image"); pending[2](json("fresh"));
    expect(await third.promise).toBe("fresh");
    cache.clear();
  });
});
