import { parseColor, THEME_PRESET_PALETTES, type ThemePresetPalette } from "@hermes/shared";
import type { DashboardTheme, ThemePalette, ThemeTypography, ThemeLayout } from "./types";

/**
 * Built-in dashboard themes.
 *
 * Each theme defines its own palette, typography, and layout so switching
 * themes produces visible changes beyond just color — fonts, density, and
 * corner-radius all shift to match the theme's personality.
 *
 * Shared built-in theme names stay in sync with the backend's
 * `_BUILTIN_DASHBOARD_THEMES` list in `hermes_cli/web_server.py`.
 * `LOCAL_ONLY_THEMES` are deliberately absent from that list.
 *
 * Presets that also ship on the desktop (midnight, ember, mono, cyberpunk)
 * take their colours from `@hermes/shared` `THEME_PRESET_PALETTES` so both
 * surfaces render one palette; only typography/layout/overrides live here.
 */

// ---------------------------------------------------------------------------
// Shared typography / layout presets
// ---------------------------------------------------------------------------

/** Default system stack — neutral, safe fallback for every platform. */
const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  baseSize: "15px",
  lineHeight: "1.55",
  letterSpacing: "0",
};

const DEFAULT_LAYOUT: ThemeLayout = {
  radius: "0.5rem",
  density: "comfortable",
};

/**
 * Project a shared (desktop-shaped) preset palette onto the dashboard's
 * 3-slot model. The dashboard's `midground` is its text + primary-fill
 * colour, which is the desktop's `primary`; its `warmGlow` is the brand
 * accent stroke, which is the desktop's `midground` (falling back to `ring`).
 * `foreground` stays the dashboard's invisible white overlay. Dark palettes
 * are the dashboard's home turf, so a preset shipping `darkColors` is read
 * from that side.
 */
export function webPresetFromShared(
  preset: ThemePresetPalette,
): Omit<ThemePalette, "noiseOpacity"> {
  const colors = preset.darkColors ?? preset.colors;
  const [r, g, b] = parseColor(colors.midground ?? colors.ring) ?? [255, 255, 255];
  return {
    background: { hex: colors.background, alpha: 1 },
    midground: { hex: colors.primary, alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: `rgba(${r}, ${g}, ${b}, 0.3)`,
  };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const defaultTheme: DashboardTheme = {
  name: "default",
  label: "Hermes Teal",
  description: "Classic dark teal — the canonical Hermes look",
  palette: {
    background: { hex: "#041c1c", alpha: 1 },
    midground: { hex: "#ffe6cb", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(255, 189, 56, 0.35)",
    noiseOpacity: 1,
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: DEFAULT_LAYOUT,
  terminalBackground: "#000000",
};

export const midnightTheme: DashboardTheme = {
  name: "midnight",
  label: "Midnight",
  description: "Deep blue-violet with cool accents",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.midnight),
    noiseOpacity: 0.8,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Inter", ${SYSTEM_SANS}`,
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
    letterSpacing: "-0.005em",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0.75rem",
  },
};

export const emberTheme: DashboardTheme = {
  name: "ember",
  label: "Ember",
  description: "Warm crimson and bronze — forge vibes",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.ember),
    noiseOpacity: 1,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Spectral", Georgia, "Times New Roman", serif`,
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0.25rem",
  },
  colorOverrides: {
    destructive: "#c92d0f",
    warning: "#f97316",
  },
};

export const monoTheme: DashboardTheme = {
  name: "mono",
  label: "Mono",
  description: "Clean grayscale — minimal and focused",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.mono),
    noiseOpacity: 0.6,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"IBM Plex Sans", ${SYSTEM_SANS}`,
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0",
  },
};

export const cyberpunkTheme: DashboardTheme = {
  name: "cyberpunk",
  label: "Cyberpunk",
  description: "Neon green on black — matrix terminal",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.cyberpunk),
    noiseOpacity: 1.2,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Share Tech Mono", "JetBrains Mono", ${SYSTEM_MONO}`,
    fontMono: `"Share Tech Mono", "JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@400;700&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0",
  },
  colorOverrides: {
    success: "#00ff88",
    warning: "#ffd700",
    destructive: "#ff0055",
  },
};

export const roseTheme: DashboardTheme = {
  name: "rose",
  label: "Rosé",
  description: "Soft pink and warm ivory — easy on the eyes",
  palette: {
    background: { hex: "#1a0f15", alpha: 1 },
    midground: { hex: "#ffd4e1", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(249, 168, 212, 0.3)",
    noiseOpacity: 0.9,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Fraunces", Georgia, serif`,
    fontMono: `"DM Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Mono:wght@400;500&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "1rem",
  },
};

/** Light mode — vivid Nous-blue accents on a cream canvas. */
export const nousBlueTheme: DashboardTheme = {
  name: "nous-blue",
  label: "Nous Blue",
  description: "Light mode — vivid Nous-blue accents on cream canvas",
  palette: {
    background: { hex: "#E8F2FD", alpha: 1 },
    midground: { hex: "#0053FD", alpha: 1 },
    foreground: { hex: "#170d02", alpha: 0 },
    warmGlow: "rgba(0, 83, 253, 0.12)",
    noiseOpacity: 0,
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: DEFAULT_LAYOUT,
  terminalBackground: "#f5f8fc",
  terminalForeground: "#170d02",
  seriesColors: {
    inputTokenAccent: "#001934",
    outputTokenAccent: "#0053fd",
  },
  swatchColors: ["#170d02", "#0053FD", "#E8F2FD"],
};

/** Personal Codex-inspired palettes for the local dashboard frontend. */
const CODEX_FONT_STACK =
  '"JetBrains Mono", Consolas, "STDongGuanTi", "Microsoft YaHei UI", monospace';

const CODEX_TYPOGRAPHY: ThemeTypography = {
  fontSans: CODEX_FONT_STACK,
  fontMono: CODEX_FONT_STACK,
  fontDisplay: CODEX_FONT_STACK,
  baseSize: "15px",
  lineHeight: "1.55",
  letterSpacing: "0",
};

/** Nous UI's font utilities read their own tokens instead of theme typography. */
const CODEX_CUSTOM_CSS = `
  :root {
    --font-sans: var(--theme-font-sans);
    --font-mono: var(--theme-font-mono);
    --font-rules-compressed: var(--theme-font-display);
    --font-rules-expanded: var(--theme-font-display);
    --font-mondwest: var(--theme-font-display);
  }
  .font-courier {
    font-family: var(--theme-font-mono);
  }
  #app-sidebar a[aria-current="page"] {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
  #app-sidebar a[aria-current="page"] > span[aria-hidden] {
    background: var(--color-primary);
  }
`;

export const codexDarkTheme: DashboardTheme = {
  name: "codex-dark",
  label: "Codex Dark",
  description: "Neutral charcoal with calm blue accents",
  palette: {
    background: { hex: "#111111", alpha: 1 },
    midground: { hex: "#fcfcfc", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(1, 105, 204, 0.1)",
    noiseOpacity: 0,
  },
  typography: CODEX_TYPOGRAPHY,
  layout: { ...DEFAULT_LAYOUT, radius: "8px" },
  customCSS: CODEX_CUSTOM_CSS,
  componentStyles: {
    sidebar: { background: "#151515" },
    header: { background: "#151515" },
    card: { background: "#1b1b1b" },
  },
  colorOverrides: {
    card: "#1b1b1b",
    cardForeground: "#fcfcfc",
    popover: "#1b1b1b",
    popoverForeground: "#fcfcfc",
    primary: "#0169cc",
    primaryForeground: "#ffffff",
    secondary: "#242424",
    secondaryForeground: "#fcfcfc",
    muted: "#242424",
    mutedForeground: "#b0b0b0",
    accent: "#1b3349",
    accentForeground: "#e6f2ff",
    destructive: "#e02e2a",
    success: "#00a240",
    border: "#383838",
    input: "#383838",
    ring: "#0169cc",
  },
  seriesColors: {
    inputTokenAccent: "#0169cc",
    outputTokenAccent: "#00a240",
  },
  terminalBackground: "#111111",
  terminalForeground: "#fcfcfc",
  terminalFontFamily: CODEX_FONT_STACK,
  swatchColors: ["#111111", "#0169cc", "#fcfcfc"],
};

export const codexLightTheme: DashboardTheme = {
  name: "codex-light",
  label: "Codex Light",
  description: "Cool near-white canvas with crisp blue accents",
  palette: {
    background: { hex: "#f7fcff", alpha: 1 },
    midground: { hex: "#0d0d0d", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(1, 105, 204, 0.08)",
    noiseOpacity: 0,
  },
  typography: CODEX_TYPOGRAPHY,
  layout: { ...DEFAULT_LAYOUT, radius: "8px" },
  customCSS: CODEX_CUSTOM_CSS,
  componentStyles: {
    sidebar: { background: "#eef5fa" },
    header: { background: "#eef5fa" },
    card: { background: "#ffffff" },
  },
  colorOverrides: {
    card: "#ffffff",
    cardForeground: "#0d0d0d",
    popover: "#ffffff",
    popoverForeground: "#0d0d0d",
    primary: "#0169cc",
    primaryForeground: "#ffffff",
    secondary: "#e8f1f7",
    secondaryForeground: "#0d0d0d",
    muted: "#e8f1f7",
    mutedForeground: "#526473",
    accent: "#dceeff",
    accentForeground: "#084b87",
    destructive: "#e02e2a",
    success: "#00a240",
    border: "#cbdce8",
    input: "#cbdce8",
    ring: "#0169cc",
  },
  seriesColors: {
    inputTokenAccent: "#0169cc",
    outputTokenAccent: "#00a240",
  },
  // Light terminal background aligned with Codex Light canvas.
  terminalBackground: "#f7fcff",
  terminalForeground: "#0d0d0d",
  terminalFontFamily: CODEX_FONT_STACK,
  swatchColors: ["#f7fcff", "#0169cc", "#0d0d0d"],
};

/** These presets are personal to this frontend and never written to the backend config. */
export const LOCAL_ONLY_THEMES: Record<string, DashboardTheme> = {
  "codex-dark": codexDarkTheme,
  "codex-light": codexLightTheme,
};

/**
 * Same look as ``defaultTheme`` but with a larger root font size, looser
 * line-height, and ``spacious`` density so every rem-based size in the
 * dashboard scales up. For users who find the default 15px UI too dense.
 */
export const defaultLargeTheme: DashboardTheme = {
  name: "default-large",
  label: "Hermes Teal (Large)",
  description: "Hermes Teal with bigger fonts and roomier spacing",
  palette: defaultTheme.palette,
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    baseSize: "18px",
    lineHeight: "1.65",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    density: "spacious",
  },
};

export const BUILTIN_THEMES: Record<string, DashboardTheme> = {
  default: defaultTheme,
  "default-large": defaultLargeTheme,
  "nous-blue": nousBlueTheme,
  midnight: midnightTheme,
  ember: emberTheme,
  mono: monoTheme,
  cyberpunk: cyberpunkTheme,
  rose: roseTheme,
  ...LOCAL_ONLY_THEMES,
};
