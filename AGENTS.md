# Web / Tauri 开发指南（给 AI Agent）

本文件描述当前定制分支的事实与约束；在完整 Hermes checkout 中还须遵循根 `AGENTS.md`。
**日常开发在父仓库 `desktop-dev` 上进行，`web/` 通过 subtree 发布到独立公开仓库。**
不要仅凭目录名、旧 README 或上游默认规则判断这里的产品形态。开始前查实际 Git 状态；分支名、remote 和构建配置可能变化。

## 1. 先确认工作环境与修改边界

在当前目录先运行：

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
git remote -v
```

- 完整项目：Git 根目录是 `hermes-agent`，这里是它的 `web/` 子目录；在 `web/` 执行 Git 命令仍操作父仓库。不要在其中 `git init`、创建嵌套 `.git`，或把 `origin` 改成 Web 仓库。
- 独立克隆 `coJwx/hermes-web-desktop`：Web 文件位于仓库根，通常 `origin` 就是该仓库；这种环境使用普通提交/推送，不能再套用 `--prefix=web`。
- 日常功能默认只改 `web/` 的前端、`src-tauri/` Rust、测试与文档。远程后端代码/配置、`apps/shared`、`apps/desktop`、生成协议默认为只读依据；跨边界修改须有明确任务授权。
- 用户授权合并父仓库上游时，可以合入上游的非 Web 文件并解决交叉冲突。这不代表服务器已经更新，也不代表可以为前端需求另造后端接口。
- 保留用户现有的暂存/未暂存修改。提交、推送、发布分别按用户授权执行；只要求改代码时不默认推送，只要求提交时不默认公开发布。
- 独立仓库是公开的。不得提交实际 token、Cookie、私钥、个人运行数据；检查已跟踪文件，不能把 `.gitignore` 当作历史脱敏工具。

## 2. 产品形态与定位入口

上游以 PTY/TUI 为主；**本分支的用户已明确授权 React Web Chat，这是已实施的本地例外**。
维护或扩展已有 `/web-chat` 不需要重新请求“能否做 React 聊天”的批准。
保留 `/chat` 原有 TUI 功能，两个入口不能相互替代。

| 问题 | 优先读取 |
|---|---|
| 路由、侧栏、页面布局、profile 重挂载 | `src/main.tsx`、`src/App.tsx`、`src/contexts/ProfileProvider.tsx` |
| `/chat` 终端 | `src/pages/ChatPage.tsx`、`src/lib/pty-*`、`src/lib/terminal-*` |
| `/web-chat` 界面、页签和标题栏 | `src/pages/WebChatPage.tsx`、`src/components/web-chat/ConversationTabs.tsx`、`src/contexts/PageHeaderProvider.tsx` |
| 跨路由工作区、草稿、刷新恢复 | `src/contexts/WebChatWorkspaceProvider.tsx`、`src/lib/web-chat-drafts.ts`、`src/lib/web-chat-persistence.ts` |
| 单 WS、多会话事件、恢复与缓存 | `src/lib/web-chat-workspace.ts`、`web-chat-workspace-recovery.ts`、`web-chat-session-events.ts`、`web-chat-cache.ts` |
| 历史图片缓存与请求租用 | `src/lib/web-chat-media.ts`、`src/components/web-chat/MessageImages.tsx`；由工作区 provider 持有并清理 |
| 会话发送、图片、模型、命令 | `src/lib/web-chat-controller.ts` 及 `web-chat-commands.ts`、`web-chat-images.ts` 等专题模块 |
| REST/WS 认证与 base path | `src/lib/api.ts`、`src/lib/gatewayClient.ts`；共享实现固定在 `vendor/hermes-shared`，上游来源是父级 `apps/shared` |
| 未保存状态、profile/原生退出 | `src/contexts/UnsavedChangesProvider.tsx`、`src/hooks/useUnsavedChanges.ts`、`src/lib/desktop-leave.ts` |
| Tauri 连接、代理、窗口与状态 | `src-tauri/src/main.rs`、`bridge.rs`、`dashboard_lifecycle.rs`、`leave_gate.rs`、`persistence.rs` |
| 当前设计与验证边界 | `README.web-chat.md`、`README.desktop.md`、`openspec/changes/` |

`/chat` 通过 `/api/pty` 嵌入真实 `hermes --tui`；Ink/TUI 的行为不应在 React 再实现一遍。
`/web-chat` 通过已有 `/api/ws` JSON-RPC 驱动远程会话，不要求服务器安装新的 API 服务。
`dashboard` 提供 SPA/初始化 HTML；`serve` 是 headless API 产品。Tauri 客户端在本机内嵌 Web 资源，经 Rust 桥接连接远程服务，不打包 Python，不启动本机后端。不要与父级 Electron `apps/desktop` 混淆。

## 3. 聊天修改必须保持的不变量

- 一个 origin + base path + profile 工作区只有一条逻辑 WS；会话状态和操作独立。事件按 runtime `session_id` 分流，持久会话 ID 用于 `resume`。异步发送/图片/模型结果必须归发起会话，不能随活动页签改变目标。
- `WebChatWorkspaceProvider` 位于 `Routes` 外、profile 生命周期内，首次访问才建立工作区。去 Files/Logs 只卸载聊天视图；WS、页签、有限缓存和草稿保留。不要把 `workspace.stop()` 放回页面卸载清理。
- 缓存有效的页签切换/路由返回不应 dial/resume/activate/history。聊天视图不在路由中时，不渲染 Markdown/媒体，不做 roster/tail；冷会话 snapshot-follow 也必须同时检查路由与 document 可见性。
- 加号先选择再创建；已有会话不重复打开。页签放在 `setAfterTitle`。普通关闭只是释放视图，不能以 `session.close/delete/interrupt` 模拟解绑；运行/待回复会话仍有后台入口。
- 工作区负责唯一恢复调度。Web wrapper 实际转发 `replay: false`，避免共享客户端与工作区重复补发。无原子快照游标时，冷运行快照使用替换/终态校准，不能盲目拼接并发 delta 或宣称 exactly-once。
- 未确认 prompt/create 不自动重发，人机请求不自动批准。老服务器单问题 clarify 与新版 questions 批量格式均须兼容；不能只为消除类型错误删除既有协议分支。
- `sessionStorage` 只保存 scoped stored IDs、顺序、活动项，并兼容旧最近 ID。文字/图片草稿与 scroll/cursor 在内存中；请求 responder、秘密值、完整正文不落浏览器存储。
- profile 替换/真正退出释放连接和 owned URL；站内导航保留型聊天草稿不提示丢弃。其他编辑器的未保存保护仍有效。服务器长任务不等于阻塞退出的短客户端事务。
- 预算以 `CHAT_LIMITS` 为准：16 关联、8 历史/估算 64MiB、每会话 400 行/8MiB、文字草稿 4MiB、图片草稿总计 100MiB；另有历史媒体缓存最多64项/估算32MiB编码字符串。估算保留量不是硬 heap 上限；全量 RPC 的下载/解码峰值及图片像素内存另计。不要在每条 delta 对整个历史/缓冲做 stringify 计量。

所有 REST/WS 继续复用已有 Cookie/token/一次性 ticket 和 base path。浏览器不能随意给 WS 设置 Authorization header。
Rust 只透明转发现有协议；不能造 snapshot/detach ACK、放宽 TLS，或给远程 Dashboard 授予 Tauri 原生权限。
连接页、标题栏/About 的原生操作必须保留完整来源/窗口标签校验。Cookie 继续按后端隔离并使用已有 DPAPI 路径，不能明文降级。

## 4. 依赖、运行与构建的隐形前提

**完整checkout与独立克隆都能在Web根目录单独构建前端。** `@hermes/shared`已固定在 `vendor/hermes-shared/`；package、TypeScript、Vite与Vitest均使用本地快照。正常构建不读父级 `apps/shared`、不调用父级脚本、不下载上游。
Node.js 22.12+（本地验收使用Node 24）和pnpm即可生成前端；使用冻结锁文件：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

默认产物为当前仓库 `dist/`，不再自动写父级 `hermes_cli/web_dist`。部署到现有Dashboard要遵循服务原有资源/HTML bootstrap注入流程；构建成功不代表业务可脱离Hermes后端。构建本身不需要Python/Rust或后端在线。
浏览器开发用 `pnpm dev`，代理地址由 `HERMES_DASHBOARD_URL`/Vite配置决定；认证复用现有bootstrap，不能写死真实token。
`pnpm dev:desktop`仍使用预构建内嵌前端而非Vite热更新；修改前端后重新启动/构建。

共享快照中的源文件不要直接改写；`UPSTREAM.json`保存来源commit/tree和文件哈希，LICENSE保留上游版权，`.gitattributes`禁止自动改写快照字节。本次用户已授权纳入快照。上游共享代码的有意更新需选定提交后执行：

```powershell
pnpm sync:shared --source "D:/path/to/hermes-agent" --ref "the-reviewed-commit-sha"
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

维护命令读取Git对象，不复制源checkout未提交工作；发现快照有本地修改会拒绝覆盖。同步后审查并一起提交源码快照、来源记录和锁文件。此维护步骤需要Git和上游源码；日常构建不需要。不要重新引入父目录alias或生成新的服务器协议。

Tauri 环境需要 Rust/MSVC、Windows SDK、WebView2；入口：

```powershell
pnpm build:desktop
pnpm build:exe
pnpm test:desktop
```

前端内嵌到 Rust 产物，前端变更后旧 exe 不会自行更新。产物路径以 `src-tauri/tauri.conf.json` 和 Cargo 配置为准，README 中带版本号的安装器名称只是历史例子。
`src-tauri/target`、`dist-desktop`、依赖/测试产物均忽略；不要忽略或删除源码图标、锁文件、已记录的验收资料。Windows 若需改 TEMP/TMP 或使用 clang-cl，按实际错误和 `README.desktop.md` 处理，不当作所有机器的必要步骤。

## 5. 选择能证明修改的检查

- JS/React 行为用本目录 Vitest，调用真实入口/DI seam；不读源码文本断言实现形状。纯文档/忽略规则调整只核对引用、命令、diff/ignore，不例行重跑产品测试。
- 聊天/profile/leave 修改的常用回归（在 `web/`）：

```powershell
pnpm exec vitest run src/lib/web-chat src/pages/WebChatPage.test.tsx src/hooks/useWebChatImages.test.tsx src/lib/gatewayClient.test.ts src/pages/ConfigPage.test.tsx src/pages/ChatPage.test.tsx
pnpm typecheck
```

- 上游大合并或共享客户端变化可运行 `pnpm exec vitest run`；Rust 改动再跑对应 Cargo 测试，资源打包变化再验证 `build:desktop`/exe。
- 经授权修改 Python 路由时，测试在父级 `tests/hermes_cli/`，必须用 `scripts/run_tests.sh`，不能裸跑 pytest。
- 多会话设计和实施在 `openspec/changes/multiplex-web-chat-sessions/`；桌面生命周期在 `harden-desktop-lifecycle/`。按实际变更同步相关工件，不为小修改新建重复方案，不擅自归档。
- 本地 wire fixture/DOM、Rust 测试、构建成功不证明远端 additive 附着、OAuth、真实原生退出、安装升级或浏览器 p95/heap 已验收。证据指纹/配置改变后，重新核对相关回归；报告实际未跑的边界。

## 6. 在父仓库中只提交 Web

提交仍写入父仓库当前开发分支，不是独立 Web 分支。先看整个 index，不能混入父级其他任务。
下例适用于**本次已确认应提交全部 Web 改动**；局部任务把 `web` 换为明确的文件清单：

```powershell
$repoRoot = (git rev-parse --show-toplevel).Trim()
git -C "$repoRoot" status --short
git -C "$repoRoot" diff --stat -- web
git -C "$repoRoot" diff --cached --stat
git -C "$repoRoot" add -- web
git -C "$repoRoot" diff --cached --check -- web
git -C "$repoRoot" diff --cached --stat -- web
git -C "$repoRoot" commit --only -m "feat(web): 描述实际改动" -- web
```

`--only -- web` 会保留非 Web 文件的原暂存状态；仍须先检查 Web 内是否混有用户其他工作，不要用 `git add .`/`git add -A` 扫全父仓库。
未跟踪文件必须先明确 add。提交后查 `git status --short`，不要把用户留下的其他暂存文件说成“工作区干净”。

## 7. 只推送 Web 到公开仓库（subtree）

完整 checkout 当前 remote 分工：

| remote | 目标 | 用途 |
|---|---|---|
| `origin` | `https://github.com/NousResearch/hermes-agent.git` | 获取/合并 Hermes 上游；不是 Web 发布目标 |
| `web-desktop` | `https://github.com/coJwx/hermes-web-desktop.git` | 接收 `web/` 导出，远端分支 `main` |

首次导出按用户要求只保留本分支的几次提交，未引入旧上游历史；subtree 提交 SHA 与父仓库不同是正常的。
父分支已记录 `git-subtree-dir/mainline/split` 同步基点。不要删除这些提交/trailer，或为了导出切到上游 main；否则可能再次扫描大量旧历史。

**先提交，确认工作区可用于 rejoin，再从父仓库根执行两步推送：**

```powershell
$repoRoot = (git rev-parse --show-toplevel).Trim()
git -C "$repoRoot" remote -v
git -C "$repoRoot" status --short
git -C "$repoRoot" subtree split --prefix=web --branch=codex/web-desktop-export --rejoin HEAD
# 两个 tree ID 必须相同，确认导出正好等于当前 web/。
git -C "$repoRoot" rev-parse HEAD:web
git -C "$repoRoot" rev-parse 'codex/web-desktop-export^{tree}'
git -C "$repoRoot" log -5 --oneline codex/web-desktop-export
git -C "$repoRoot" push web-desktop codex/web-desktop-export:main
git -C "$repoRoot" ls-remote web-desktop refs/heads/main
```

任一步失败即停止后续推送。`--rejoin` 会给父分支增加同步元数据提交，正常情况下不改文件；这是保持后续增量导出高效的机制。
用户其他未提交工作使 rejoin 无法执行时，不能为了推送擅自 reset/stash；先保留状态并处理范围。
已核对内容、希望直接同步时也可使用：

```powershell
git -C "$repoRoot" subtree push --prefix=web --rejoin web-desktop main
```

此快捷命令不负责刷新本地 `codex/web-desktop-export` 分支。**不要用普通 `git push web-desktop` 同步新代码**：本机 push refspec 指向该导出分支，未重新 split 时可能仍是旧版本。
更不能 `git push web-desktop desktop-dev:main`，这会把整个父项目和历史推到 Web 仓库。
如果发现远端有独立的新提交，先 fetch/对账，不能默认 force push 或重建仓库；独立仓库反向同步须另行规划。

remote、代理和导出分支属于本地 Git 配置，不会随克隆携带。**仅在用户授权配置且目标正确时**，完整 checkout 可补配置：

```powershell
git -C "$repoRoot" remote add web-desktop https://github.com/coJwx/hermes-web-desktop.git
git -C "$repoRoot" config remote.web-desktop.proxy http://127.0.0.1:7890
git -C "$repoRoot" config remote.web-desktop.push refs/heads/codex/web-desktop-export:refs/heads/main
```

remote 已存在时先查 URL，不重复 add 或覆盖。7890 是此机器代理端口，不是跨机器固定要求。
当前使用 Git Credential Manager 的 HTTPS 登录；SSH 443 经代理可连通，但已检查的密钥未获 GitHub 授权，不能仅凭本机存在密钥就声称可推送。
不打印/写入 token，不改全局 Git 代理；代理诊断优先检查当前进程环境、`git config --get remote.web-desktop.proxy`。

## 8. 合并上游与常见误判

- 保持开发分支和本地功能，按用户授权 fetch/merge `origin/main`，逐处整合冲突。不要对整次合并使用 `-s ours`/`-X ours` 来假装接入上游；subtree 记录基点的元数据合并是另外一回事。
- 自动合并不等于行为兼容。重点复查 `App`/profile 生命周期、共享 RPC 类型、锁文件、模型选择、文件预览、Tauri字体和构建脚本。保留本地功能同时接入上游修复，不机械选整个 ours/theirs。
- 冲突正文处理完还须 add；以 `git ls-files -u`、`git status`、是否存在 `MERGE_HEAD` 判定合并状态。VS Code 上万“暂存更改”是文件数，可能停留在旧 UI；先查磁盘 Git 状态，再刷新窗口，不重复合并。
- 推送/发布成功要核对远端 SHA；不要把 API 限流误认为 push 失败，也不要把本地 commit 说成已远端同步。
- `README.desktop.md` 有历史版本说明，部分 README 段落可能落后于当前代码。生命周期以 provider/workspace 实现与当前 OpenSpec 为准；构建参数/版本以 manifest/config 为准；独立构建以根 `README.md` 为入口。不要恢复旧的“离开聊天路由就 stop”行为。
- 本文件同时路由到父级 Python Web routers：若任务明确落在那边，读取 `hermes_cli/AGENTS.md`；继续复用服务器已有认证，不扩张第二套认证或单文件路由总管。
