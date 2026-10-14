# Hermes Web / Desktop

Hermes Dashboard 前端及本地 Tauri 客户端源码。**单独克隆本仓库即可构建前端产物**；构建不需要父级 Hermes checkout、Python、Rust 或正在运行的后端。

## 前端构建

使用 Node.js 22.12+（推荐 Node 24 LTS）和 pnpm，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

产物位于 `dist/`，包含 `index.html`、JS/CSS、字体和图标。`pnpm build` 先执行 TypeScript 检查，再运行 Vite。构建时不连接后端；依赖安装需要包缓存或网络。

`vendor/hermes-shared/` 是仓库内固定版本的共享包，包含客户端、类型、公共工具和MIT许可证。正常安装/构建不读取 `../apps/shared`，也不运行父项目的构建脚本。来源和校验见 `vendor/hermes-shared/UPSTREAM.json`，有意更新的步骤见同目录README。

## 开发与验证

```powershell
pnpm dev
pnpm typecheck
pnpm test
```

浏览器开发需连接已有Hermes Dashboard，可通过进程环境 `HERMES_DASHBOARD_URL` 指定地址。Vite复用已有API/WS代理和初始化bootstrap，不要把真实token写入源码。

前端产物仍需要Hermes后端提供API、认证和初始化HTML中的运行时bootstrap；`pnpm preview`可检查静态资源，不会启动Hermes服务。部署到现有Dashboard时，应按该服务原有流程放置 `dist/` 内容并保留bootstrap注入；本次改造不提供新的后端、通用静态站点认证或部署脚本。

## 桌面客户端

现有桌面流程保留：`pnpm build:desktop`生成 `dist-desktop/`，`pnpm build:exe`构建Tauri程序。桌面打包另需Rust/MSVC、Windows SDK及WebView2，具体见 `README.desktop.md`；独立前端构建不要求这些工具。本次独立构建验收以 `dist/` 为准。

聊天架构与行为见 `README.web-chat.md`，Agent工作规则及从父仓库单独提交/推送Web的命令见 `AGENTS.md`。

## 来源与许可证

本项目来自Nous Research Hermes Agent，定制Web Chat/Tauri功能在Web范围维护。源码遵循根目录MIT LICENSE；固定共享包同时保留上游LICENSE与来源记录。


## Typography & contrast rules

Read before adding or editing UI styles. These rules keep the dashboard legible across all built-in themes and stop drift back into the patterns the design system was just refactored out of.

### Text size floor

- **Minimum body size: `text-xs` (12px / 0.75rem).** Do not use arbitrary `text-[0.6rem]`, `text-[0.65rem]`, `text-[9px]`, `text-[10px]`, or `text-[11px]` on copy, hints, labels, counts, or badges. Use the standard scale: `text-xs`, `text-sm`, `text-base`.
- Smaller sizes are only acceptable on **decorative overlays** (chart stripes, empty-state icons) — never on text the user is meant to read.

### Opacity floor on text

- **Never apply opacity below 0.7 to text.** No `opacity-30`, `opacity-50`, `opacity-60` on `<span>`s, `<p>`s, labels, etc.
- **Do not stack opacity tokens.** Patterns like `text-muted-foreground/60`, `text-midground/70`, `text-foreground/50` create unpredictable WCAG failures because the parent token already has alpha.
- Use the **semantic text tokens** from `@nous-research/ui`'s `globals.css`:
  - `text-text-primary` — default body text.
  - `text-text-secondary` — subtitles, meta, inactive nav.
  - `text-text-tertiary` — small chrome labels, counts, footnotes.
  - `text-text-disabled` — disabled states.
  - `text-text-on-accent` — text on filled accent surfaces.

### Brand uppercase via `text-display`, not raw `uppercase`

- The dashboard preserves the Nous brand uppercase aesthetic, but it is **opt-in per element, not global**.
- Apply uppercase via the DS utility `text-display` on **brand chrome only** — page titles, nav section headings, badges, brand wordmark. DS components (`Button`, `Badge`, `Tabs`, `Segmented`, etc.) already self-apply `text-display`.
- **Do not introduce new `uppercase`** (the literal Tailwind class) in `hermes-agent/web/src`. Prefer `text-display` for new brand chrome. Legacy `uppercase` call sites (e.g. `components/ui/label.tsx`, `card.tsx`) remain until migrated.
- The app shell no longer forces uppercase globally, so blanket `normal-case` opt-outs are unnecessary. Use `normal-case` only where a DS component applies `text-display` but the label should stay sentence case — e.g. dynamic user content (model slugs, theme names) **or** fixed UI copy that is not brand chrome (EnvPage “not configured” toggle, sidebar “New chat”).

### Fonts

Typography is **opt-in per surface**, not global on layout shells — the app shell and page header keep their original theme/expanded fonts; Mondwest applies only where explicitly set.

| Tier | Classes | Use for |
|------|---------|---------|
| Brand chrome | `font-mondwest text-display` (or `themedChrome`) | Sidebar nav, card section headers (`CardTitle`), Segmented filter buttons, filter panel headings |
| Themed body | `font-mondwest normal-case` (or `themedBody`) | Card content (`Card`, `CardDescription`), session/platform rows, analytics tables — **scoped to the component** |
| Page chrome | `font-expanded` | Page header h1 (`PageHeaderProvider`) — sentence case, not `text-display` |
| Wordmark | `Typography` + size/tracking only | Sidebar/mobile “Hermes Agent” — mixed case, no Mondwest, no `text-display` |
| Technical | `font-mono-ui` / `font-mono` / `font-courier` | Model slugs, env keys, schedules, YAML, repo URLs |

- Do **not** put `themedBody` or `themedFont` on `<main>`, `App`, or other layout wrappers — it overrides component-scoped styles.
- **`Card`** applies `themedBody`; **`CardTitle`** uses `text-display` (uppercase chrome); **`CardDescription`** uses `themedBody`.
- **`NouiTypography`** defaults to `font-sans` unless a font prop is passed.
- Do **not** use raw `font-sans` or `font-display` (theme sans variable) on new dashboard UI — prefer Mondwest tiers above where brand-appropriate.

### Color tokens

- Prefer **semantic tokens** (`text-text-*`, `bg-card`, `border-border`, `text-foreground`, `text-destructive`, `text-success`, `text-warning`) over raw layer references (`text-midground`, `text-foreground`).
- `text-muted-foreground` is now wired to `--color-text-secondary`, so existing call sites stay correct, but new code should prefer the semantic name.
- When you genuinely need a non-token color (icon de-emphasis on a chart, terminal foreground via inline style), keep alpha at `≥ 0.7` for any text.

