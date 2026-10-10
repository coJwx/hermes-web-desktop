const STORAGE_KEYS = {
  theme: "hermes-dashboard-theme",
  font: "hermes-dashboard-font",
  locale: "hermes-locale",
};

declare global {
  interface Window {
    /** Injected only by the authenticated Tauri loopback bridge. */
    __HERMES_DESKTOP__?: boolean;
    __HERMES_DESKTOP_APPEARANCE__?: Partial<Record<keyof typeof STORAGE_KEYS, string | null>>;
  }
}

export function hasDesktopAppearancePreference(kind: keyof typeof STORAGE_KEYS): boolean {
  return !!window.__HERMES_DESKTOP__ && window.__HERMES_DESKTOP_APPEARANCE__?.[kind] != null;
}

/** Browser builds keep their existing localStorage behavior; desktop adds backend-scoped disk persistence. */
export function writeAppearancePreference(kind: keyof typeof STORAGE_KEYS, value: string): void {
  window.localStorage.setItem(STORAGE_KEYS[kind], value);
  if (!window.__HERMES_DESKTOP__) return;
  window.__HERMES_DESKTOP_APPEARANCE__ = { ...window.__HERMES_DESKTOP_APPEARANCE__, [kind]: value };
  void fetch("/__desktop/preferences", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [kind]: value }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(await response.text());
  }).catch((error: unknown) => {
    console.error("[desktop] Appearance applied but could not be saved for next launch:", error);
  });
}
