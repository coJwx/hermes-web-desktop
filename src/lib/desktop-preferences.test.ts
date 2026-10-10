// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDesktopAppearancePreference, writeAppearancePreference } from "./desktop-preferences";

afterEach(() => {
  delete window.__HERMES_DESKTOP__;
  delete window.__HERMES_DESKTOP_APPEARANCE__;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("desktop appearance persistence", () => {
  it("keeps browser builds local without requesting a native bridge", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    writeAppearancePreference("theme", "codex-dark");
    writeAppearancePreference("font", "theme-default");
    writeAppearancePreference("locale", "zh");
    expect(localStorage.getItem("hermes-dashboard-theme")).toBe("codex-dark");
    expect(localStorage.getItem("hermes-locale")).toBe("zh");
    expect(fetch).not.toHaveBeenCalled();
    expect(hasDesktopAppearancePreference("theme")).toBe(false);
  });

  it("persists partial changes through the authenticated bridge and protects the latest choice from stale server defaults", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    window.__HERMES_DESKTOP__ = true;
    window.__HERMES_DESKTOP_APPEARANCE__ = { theme: "codex-light" };
    expect(hasDesktopAppearancePreference("font")).toBe(false);
    writeAppearancePreference("theme", "codex-dark");
    writeAppearancePreference("font", "theme-default");
    writeAppearancePreference("locale", "zh");
    expect(hasDesktopAppearancePreference("theme")).toBe(true);
    expect(hasDesktopAppearancePreference("font")).toBe(true);
    expect(window.__HERMES_DESKTOP_APPEARANCE__).toEqual({ theme: "codex-dark", font: "theme-default", locale: "zh" });
    expect(fetch).toHaveBeenNthCalledWith(1, "/__desktop/preferences", expect.objectContaining({
      method: "POST", credentials: "same-origin", keepalive: true, body: JSON.stringify({ theme: "codex-dark" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/__desktop/preferences", expect.objectContaining({ body: JSON.stringify({ font: "theme-default" }) }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/__desktop/preferences", expect.objectContaining({ body: JSON.stringify({ locale: "zh" }) }));
    await Promise.resolve();
  });
});
