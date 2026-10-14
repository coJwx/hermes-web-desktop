# Hermes Dashboard — Tauri Windows 客户端

此客户端把 `web/` 的 React/Vite 前端编译进 exe，连接用户指定的远程 Hermes Dashboard。**不包含 Python、不启动本机 Hermes 后端，不加载后端服务器上的 Dashboard JS/CSS bundle（仍读取其初始化 HTML 和登录页面）。** 远程服务仍需提供 Hermes 的 API、认证页面和 HTML bootstrap（通常由 `hermes dashboard` 提供）。

## 使用

1. 启动 `hermes-dashboard.exe` 或使用 NSIS 安装包安装后启动。
2. 首次使用时在连接窗口填写后端地址；已保存地址时，启动会自动连接并打开 Dashboard。首次默认 `http://10.144.1.2:9119`，支持 HTTP/HTTPS 和路径前缀，例如 `https://example.com/hermes/`。
3. 点击「保存并连接」。需要认证的服务器会显示它自己的登录页面。
4. 更换服务器：窗口菜单「连接 → 修改后端地址…」（`Ctrl+Shift+S`）。保存后会创建全新的连接，关闭原 Dashboard，只加载新后端自己的偏好和登录会话；旧后端的加密会话保留，切回时可以恢复。
5. 后端重启后，可用「连接 → 重新加载」（`Ctrl+R`）。自动连接失败时显示连接设置供重试。Dashboard 的 `X` 和「连接 → 退出」都完全退出应用；首次设置页的 `X` 也退出。已连接时关闭辅助设置窗口，只隐藏设置并保留当前 Dashboard。

正常情况下后端 URL 保存到 Tauri app config 目录的 `connection.json`（Windows 通常为 `%APPDATA%\space.hermes.dashboard\connection.json`）。启动前会检查目录可写性；如果 AppData 不可写，会改用 **exe 同目录下的 `hermes-dashboard-data/`**，其中 `connection.json` 保存地址，`webview/` 保存 WebView 配置。连接窗口标题会标注「便携模式」。便携目录也不可写时会弹出具体错误，不需要或尝试管理员提权。不保存密码，也不将 Cookie/token 明文写入配置。远程 Cookie 及其过期/作用域信息以 Windows DPAPI 加密文件保存；退出登录会清除当前后端的已保存会话。启动时自动连接已保存的有效地址；首次使用、配置损坏或连接失败时显示设置页。关闭设置窗口时，如果 Dashboard 仍打开，设置窗口只是隐藏；从菜单「退出」退出整个程序。

## 构建

环境：Node.js/pnpm、Rust 1.89+ MSVC 工具链（使用标准库文件锁）、Visual Studio C++ Build Tools + Windows SDK、WebView2 Runtime。

```powershell
pnpm install --frozen-lockfile
pnpm build:exe
```

开发与验证：

```powershell
pnpm dev:desktop
pnpm build:desktop
pnpm test:desktop
```

`dev:desktop` 使用预先构建的内置前端，而不是 Vite 开发代理；前端修改后需重新启动，便于让开发/发布遵循同一条认证和转发路径。浏览器开发继续使用 `pnpm dev`。独立前端 `pnpm build` 现输出当前仓库的 `dist/`；桌面构建继续显式输出 `dist-desktop/`。两者都使用仓库内共享快照，完整项目与独立克隆均无需父级构建脚本。

产物：

- 应用 exe：`src-tauri/target/release/hermes-dashboard.exe`
- NSIS 安装包：`src-tauri/target/release/bundle/nsis/Hermes Dashboard_0.1.4_x64-setup.exe`
- 桌面前端中间目录：`dist-desktop/`（被 Git 忽略）

如果 Windows 编译器无法自动发现，请在 **x64 Native Tools Command Prompt** 运行构建命令。此机器 MSVC 的 `cl.exe` 编译 C 依赖时出现 D8050，可在该命令行使用已有 LLVM 编译器：

```bat
set CC=clang-cl
set CXX=clang-cl
pnpm build:exe
```

此环境的原生子进程写系统默认临时目录会被拒绝，构建/测试时还需选择工作区内可写的临时目录：

```powershell
New-Item -ItemType Directory -Force src-tauri/target/tmp | Out-Null
$env:TEMP = (Resolve-Path src-tauri/target/tmp).Path
$env:TMP = $env:TEMP
```

不要求其他机器使用 LLVM 或更改临时目录。复现构建请提交/使用 `pnpm-lock.yaml` 与 `src-tauri/Cargo.lock`；仅前端改动也必须重新构建 exe，前端资源在 Rust 编译时内嵌。

## 实现边界与安全

- `src-tauri/src/main.rs`：应用装配、连接设置与切换入口。
- `src-tauri/src/dashboard_lifecycle.rs`、`leave_gate.rs`：原生离开确认、窗口替换与回滚；`src/lib/desktop-leave.ts` 将确认接入 Web 草稿保护。
- `src-tauri/src/trusted_ui.rs`：连接/标题栏/About 的完整来源与标签校验。
- `src-tauri/src/instance.rs`、`diagnostics.rs`、`preference_recovery.rs`：目录独占、本地事件日志和非敏感偏好恢复。
- `src-tauri/src/settings.rs`：URL 校验和非敏感设置保存。
- `src-tauri/src/bridge.rs`：内嵌资源、bootstrap、HTTP 与 WebSocket 转发。
- `src-tauri/src/persistence.rs` 及同名目录：后端隔离的主题/字体保存、Cookie 序列化、DPAPI 保护和原子写入。
- `desktop/desktop-connection.*`：独立的离线连接表单，只在受信任的 Tauri 窗口加载。
- 桥接层绑定 `127.0.0.1` 的随机端口，以一次性入口生成随机 HttpOnly/SameSite Cookie，校验 Host/Origin，拒绝跨来源请求。只连接选定的后端；此端口不是对外服务。
- 远程 Cookie 使用按后端隔离、可恢复的 cookie jar，落盘前以当前 Windows 用户的 DPAPI 加密；后端 URL 也参与保护。TLS/路径作用域以真实远程 URL 为准，不把 Secure Cookie 降级复制到 HTTP localhost。转发层不关闭 TLS 证书验证。
- 打包 Dashboard 不授予 Tauri 原生能力；配置命令另外验证调用窗口标签。服务器和插件代码仍应视为可信 Web 内容。
- 初始化只解析服务器 HTML 中白名单 JSON/boolean bootstrap 字段，不执行整段远程初始化脚本。自定义主题仍由现有前端加载。
- 已支持 Cookie 密码登录、token 模式与现有 WebSocket。第三方 OAuth 的绝对 callback URL/提供商 WebView 限制需要按实际服务器配置人工验证；本版本没有新增系统浏览器 PKCE 流程。
- HTTP 不加密凭据与流量；公网使用 HTTPS。自签名证书需要正确配置系统/服务证书，不能绕过验证。
- 聊天仍由远程后端的 PTY/TUI 提供；exe 不改变远程后端的 OS 支持条件。
- exe 与服务端 API 要保持兼容，后端升级不自动更新 exe 内置前端。
- Windows 签名证书未配置：安装包和 exe 未签名，分发时可能触发 SmartScreen。直接 exe 仍需要系统已有 WebView2；NSIS 使用 Tauri 的默认 WebView2 bootstrap 安装流程。
## 手工验收清单

构建和转发测试不等同于已完成本机 GUI/账号验收。请在正常 Windows 用户会话中验证：

1. 启动 exe，看到离线连接表单，默认地址正确；菜单可以重新打开设置。
2. 连接实际服务器，使用自己的账号登录；会话/配置页面加载，聊天 WebSocket/PTY 正常。
3. 更换另一个 Hermes 地址，再切回原地址；旧登录会话不得跟到新服务器。退出、重启后保留最后保存的地址。
4. 输入不可达地址，应显示错误；已有 Dashboard 在新连接预检失败时仍保持可用。
5. 若使用 OAuth，单独检查登录提供商允许 WebView、绝对 callback 地址、Cookie 和回跳行为；当前没有实现 native PKCE。

已在本机复现并修复启动时 AppData「拒绝访问」导致的闪退，修复版已成功创建窗口、保存后端 URL 并连接到远程 Dashboard。完整安装器已在独立目录通过安装、重复安装、注册表登记、启动和卸载验证；真实账号登录后的业务仍需人工验收。现有 Web 前端测试、真实 HTTP/Cookie/WebSocket 转发测试和 Windows 构建已通过。仓库现有 ESLint 配置缺少 `@eslint/js`，无法运行 lint；没有为本任务修补该无关依赖。


## 重启后的主题与登录恢复

此版本不再依赖随机 localhost 端口下的 localStorage 作为唯一保存位置。选中的主题（包括 `codex-dark` / `codex-light`）、字体和页面语言会按后端保存在稳定的 JSON 中，页面加载前先恢复。Windows Cookie 容器在连接前解密恢复，过期 Cookie 被过滤；不会因为重启而延长服务器的会话有效期。

状态位于 `connection.json` 所在目录的以下子目录：

```text
servers/<canonical-backend-url-sha256>/preferences.json  # 非敏感主题/字体
servers/<canonical-backend-url-sha256>/session.dpapi     # 加密 Cookie，不是密码
```

便携模式下，它们在 exe 旁的 `hermes-dashboard-data/servers/` 中。不要为了升级删除该数据目录。DPAPI 状态通常只适用于同一 Windows 用户和电脑；复制到其他用户/电脑时，需要清除对应服务器的 `session.dpapi` 后重新登录。损坏的文件也会显示恢复错误，不会被当作明文读取。

第一次从旧版升级仍需登录、选择主题一次，因为旧版从未保存内存中的登录 Cookie，旧随机端口下的主题也没有被转换到这份状态中。之后重新打开同一后端会恢复；明确退出登录、服务端撤销或过期后仍需登录。无过期时间的 session Cookie 可跨应用重启恢复，但最终认证有效性仍由服务端检查。退出登录时还会使已在途的旧 HTTP 响应失效，避免它们在退出后重新写回 Cookie。

切换服务器不会把 Cookie 发给其他服务器；回到已登录的服务器可以恢复它自己的会话。当前只增强 Windows 的安全存储；其他平台没有明文降级。页面语言也按后端保存，重新打开后恢复；其他 localStorage 偏好不在本次修复范围内。

已使用过的便携数据目录会继续使用，即使 AppData 后来变得可写，也不会突然切换到另一份空配置。升级请先退出旧客户端，然后替换 exe；保留原数据目录。

## 0.1.1 安装修复与交付（2026-10-02）

**请使用下载目录中的新版安装包，不要直接运行工作区 release/target 下的旧 exe。**

本机工作区产物继承了 NTFS Low（低完整性）标签。实际对照实验显示：同一个 NSIS 探针在工作区启动时使用 Temp\Low，无法写入当前用户注册表；把相同字节写入下载目录中的新文件后，使用正常 Temp 且注册表写入成功。旧安装包的自定义目录预检查无法解决这种进程权限问题。本次未修改系统安全设置、目录 ACL 或个人数据，也没有要求管理员权限。

当前 Tauri 配置已没有旧的自定义 installer hook。本次按此配置完整重建 **0.1.1**，避免与多个 0.1.0 旧包混淆，并新增交付脚本：

```powershell
pnpm build:exe -- --locked
pwsh -File desktop/package-windows.ps1
```

脚本默认在 Windows 配置的下载目录中创建全新的 Hermes-Dashboard-0.1.1 目录，不覆盖已有目录；可用 -OutputDirectory 指定另一个正常用户目录，但禁止指定开发工作区。通过写入新文件字节而不是复制构建目录的安全元数据，保留目标目录的正常权限继承。输出安装包、备用直接运行 exe、使用说明、SHA256SUMS.txt 和 ZIP。ZIP 不携带 NTFS 完整性标签；请解压到正常下载/桌面目录，而非带 Low 标签的工作区。不要为解决此问题关闭安全软件或改整个磁盘的权限。

本次已验收的交付目录：

`C:\Users\satellite\Downloads\Hermes-Dashboard-0.1.1-fixed`

安装器：`Hermes-Dashboard-0.1.1-windows-x64-setup.exe`。可选默认安装路径或 D:\Soft\Hermes Dashboard，不需要事先手动创建目录。升级前从「连接 → 退出」关闭旧客户端。安装包尚未签名，Windows 可能提示未知发布者；请核对文件来源。

### 完整安装器回归测试

在无现存 Hermes 安装注册项的 Windows 用户下运行（脚本发现已有注册项会拒绝，避免污染真实安装）：

```powershell
pwsh -File desktop/test-installer.ps1 -Installer 'C:\Users\satellite\Downloads\Hermes-Dashboard-0.1.1-fixed\Hermes-Dashboard-0.1.1-windows-x64-setup.exe' -Application 'src-tauri/target/release/hermes-dashboard.exe'
```

可加 `-TestParent D:\Soft`。在唯一隔离目录内测试完整安装、安装注册表、二次安装保留模拟便携配置、连接窗口与 WebView2 子进程启动、卸载保留模拟配置。不会读取真实登录数据或连接服务器。测试收据写入其独立测试目录的 receipt.json；失败时保留现场。Tauri 在打包时将 exe 内的 UNK 标记临时改成 NSS，测试按此唯一差异校验其余完整字节，不把两个文件不同的原始哈希误判为损坏。

本次 Temp 与 D:\Soft 下含中文/空格的全新嵌套目录均通过。账户登录、实际远程服务及聊天交互仍未进行用户账号验收；无 WebView2 电脑上的联网安装流程未复测。

## 0.1.2：Windows 标题栏中的连接菜单

Windows Dashboard 的标题与「连接 ▾」现在共用顶部一行：`Hermes Dashboard — 后端地址  连接 ▾`。右侧提供最小化、最大化/还原和关闭；空白区域可以拖动窗口，双击可最大化/还原。连接菜单仍使用原有原生菜单及「修改后端地址…」「重新加载」「退出」动作；Ctrl+Shift+S / Ctrl+R 保留。连接设置窗口保留原有原生外观。

实现位于 `src-tauri/src/titlebar.rs` 和 `desktop/desktop-titlebar.*`，复用 Tauri 多 WebView 能力（现有依赖的 `unstable` feature）。36 逻辑像素高的本地标题栏与远程 Dashboard 是同一个窗口中的两个独立 WebView；缩放/尺寸变化时重新布局，不向远程 HTML 注入原生窗口权限。标题栏命令同时校验 WebView 标签与本地 URL；原连接配置命令仍限定连接窗口。其他操作系统保留旧的原生装饰窗口。

此修改不迁移个人数据。回滚可以使用 0.1.1 安装包。仍应使用 `desktop/package-windows.ps1` 导出到正常下载目录，不直接运行工作区带 Low 完整性标签的构建 exe。


## 0.1.4：自动连接与统一退出

连接设置窗口不再显示重复的顶部「连接」菜单，页面保留地址输入和「保存并连接」。成功保存的地址在下次启动时自动连接；不需要每次确认。第一次没有保存地址时不自动使用示例/default 地址。损坏的配置或无法连接的后端会显示可修改的设置页，不清除已保存登录和偏好。

Dashboard 的右上角 X、Alt+F4/系统关闭请求和「连接 → 退出」现在都退出整个客户端，不再回到第一个页面。通过「修改后端地址」打开的设置窗口是辅助窗口：只关闭它时保留已有 Dashboard。未连接时关闭设置窗口则退出。没有新增后台/托盘驻留模式。

本机与远程数据边界：

- 正常用户配置：Windows Roaming AppData 下的 `space.hermes.dashboard/connection.json`；其 `servers/<backend-hash>/preferences.json` 保存主题、字体、语言，`session.dpapi` 保存 Windows 加密登录 Cookie。
- WebView 缓存：Windows Local AppData 下的 `space.hermes.dashboard`。缓存不是登录/主题恢复的唯一来源。
- 便携回退模式：上述地址和 servers 数据位于 exe 旁 `hermes-dashboard-data`，WebView 位于其 webview 子目录。已有便携配置会继续沿用。
- Hermes 模型、工具、渠道、定时任务、聊天会话等业务状态在远程服务端。客户端不创建本机 Python Hermes 数据库。

设置页底部会显示当前实际选中的配置目录，不需要猜测当前处于普通还是便携模式。切换服务器只切换当前连接，不删除原服务器按后端隔离保存的登录会话；「退出程序」也不等于「退出登录」。

## 0.1.5：记住 Dashboard 最大化状态

Dashboard 会记录最后的「最大化 / 普通窗口」模式；重新启动自动连接、切换后端或重新创建 Dashboard 时恢复该模式。最大化/还原造成的窗口尺寸事件及时保存，右上角 X、系统关闭请求和菜单「退出」也会读取一次状态。最小化不会覆盖之前的最大化/普通模式；隐藏窗口初始化时的暂态尺寸不会覆盖记录。

状态独立保存在当前配置目录的 `window.json`（与 `connection.json` 同级）；普通模式通常为 Windows Roaming AppData 下 `space.hermes.dashboard/window.json`，便携模式则在 exe 旁的 `hermes-dashboard-data/window.json`。不改变后端地址、登录 Cookie 或远程业务配置，也不新增原生权限或依赖。仅记住最大化开关，不保存普通窗口的具体尺寸和坐标。升级后的第一次启动没有旧记录时仍使用默认普通窗口；选择最大化或还原一次即可建立记录。

写入复用现有同目录临时文件 + 原子替换逻辑，只在模式实际改变时写盘；写入失败不会把内存中的状态误认为已持久化。当前开发版对非敏感窗口/桌面/外观偏好使用下文的备份与默认值恢复，不再因这些文件损坏而直接退出；连接地址及加密登录数据保持独立的恢复策略。

## 0.1.6：Dashboard 浏览器式缩放

Windows Dashboard 内容 WebView 已启用 Tauri/WebView2 原生缩放控制：在页面内获得焦点后，可用 `Ctrl + +` / `Ctrl + =` 放大、`Ctrl + -` 缩小、`Ctrl + 0` 恢复默认比例，以及 `Ctrl + 鼠标滚轮` 缩放。顶部标题栏是独立 WebView，仍保持原来的大小；连接设置窗口和其他操作系统的窗口不在本次变更范围内。

实现仅在 Dashboard 内容的 WebviewBuilder 上启用 `zoom_hotkeys_enabled(true)`，没有向远程页面新增原生命令权限或注入键盘脚本，也没有新增依赖。此次没有增加缩放比例的持久化；重新创建内容 WebView 后不保证保留上次比例。

## 0.1.7：分组应用菜单、开发工具与高清图标

顶部仍只有一个下拉入口，位置不变，文字改为「菜单」。菜单分为「连接」「视图」「设置」「开发」「帮助」，底部保留「退出」。

- **连接**：修改后端地址、重新加载（Ctrl+R）。
- **视图**：显示实际当前缩放比例；放大/缩小/恢复100%，80%/100%/125%/150%/200%预设；窗口始终置顶（默认关闭）。标题栏不随页面缩放。
- **设置**：启动时自动连接（默认开启）；记住缩放比例（默认开启）。关闭自动连接不影响当前会话，只改变下次启动。关闭缩放记忆不改变当前比例，下次新建Dashboard使用100%；重新开启时保存当前比例。
- **开发**：主动打开Dashboard开发者工具（F12）。正式包启用了现有Tauri依赖的devtools feature；不会自动弹出。Windows使用“打开”命令，而不是承诺同步关闭/勾选状态。连接页、标题栏和关于页不启用DevTools；没有新增远程原生权限。
- **帮助**：打开当前实际本机数据目录；关于应用显示客户端版本、后端地址、配置目录和WebView缓存目录。关于窗口仅接受本地窗口/URL的信息读取，显示数据使用textContent；客户端版本不是远程Hermes版本。

新偏好保存到与connection.json同级的 `desktop.json`（auto_connect、always_on_top、remember_zoom、zoom），不迁移原来的connection.json、window.json或servers加密会话。记住的比例来自实际WebView2控制器，在菜单打开、重载、切换后端、正常退出时读取，因此也覆盖原生快捷键/滚轮改变的比例；异常强杀不保证保存最后一次键盘缩放。快速菜单操作串行处理，避免连续放大键读取同一个旧比例。全屏、普通窗口位置/尺寸记忆和清理数据不在本版范围内。

**图标来源**：按用户指定，采用 `apps/bootstrap-installer/src-tauri/icons/icon.ico`，复制为本项目独立的 `src-tauri/icons/icon.ico`。它含16/32/64/128/256多尺寸图像。构建脚本只把此专用资源复制到内嵌资源 `desktop-icon.ico`，不会再用最大48px的网页favicon覆盖它；应用、标题栏、NSIS安装器/卸载器统一使用高清图标，浏览器favicon保持不变。Windows当前目标不需要复制macOS的icns，也不依据PNG文件名猜测其尺寸。

## 0.1.8：桌面图标中间尺寸与快捷方式修复

再次检查已安装的0.1.7确认快捷方式目标/程序版本正确，exe内也确实包含16/32/64/128/256帧。但该ICO缺少Windows桌面常用48档；Shell返回的48px结果比256px结果明显损失细节。同一个exe放到全新测试路径读取时结果相同，因此不能只把问题归因于旧路径缓存。截图本身仍可能涉及桌面缓存或高DPI缩放，不能仅凭截图唯一归因。

从用户指定bootstrap-installer的原1024px PNG复制为独立 `src-tauri/icons/icon-master.png`，生成16/20/24/28/32/40/48/60/64/72/84/96/128/192/256共15个尺寸。生成脚本 `desktop/generate-icons.py` 使用Pillow，是可选的开发资产重生成步骤，不参与用户运行或普通构建；ICO本身已保存。保留同一个头像，不用小图放大，也不新增AI图案。不同于0.1.7直接复制ICO，0.1.8使用同源高清PNG重新生成尺寸齐全的ICO。

安装包另行安装 `icons/hermes-dashboard.ico`，新快捷方式的IconLocation明确指向它，升级现有应用快捷方式时只更新图标字段并保留目标、参数等元数据。仅通知该快捷方式发生变化，不删除系统图标缓存，不结束或重启Explorer。exe/安装器内的图标和内嵌标题栏资源也使用这15帧图标。它能避免不必要的低分辨率放大，但复杂头像在小尺寸仍不如简洁几何标志易辨认；本次不重新设计图案。

## 未发布：桌面可靠性与原生草稿保护

本节描述当前源码，不表示下载目录或已安装的 0.1.8 安装包已被替换。

- WebSocket 双向保留关闭码与原因，包括认证失效和终端启动失败；普通 HTTP 使用 120 秒读空闲时限，不以短总时限截断持续传输。桥接结束会取消等待中的 HTTP/流和 WebSocket。
- 不同后端切换先检查成功页面中的 Hermes bootstrap；合法 HTTP(S) 登录重定向保留原兼容性，包括外部认证代理，只有登录后的页面才能进一步验证 bootstrap。旧 bridge 保留到新窗口和 connection.json 提交成功；窗口创建或保存失败时尝试用新的单次入口恢复旧窗口，失败则显示恢复错误并保留旧地址。相同后端重新连接直接刷新当前连接，不创建争用同一 Cookie 文件的第二个 jar。
- 原生 X/退出、重新加载、重新连接和切换后端会检查配置/Skill 的未保存状态；保存中拒绝离开，取消保留页面。同意后暂时锁住页面输入，防止确认后继续编辑造成竞态；原生操作失败时解除锁定。无响应或不支持该协议的页面会显示默认取消的原生强制操作确认。已显示的页面确认最长等待 120 秒，超时取消；不把用户尚未决定误认为同意。
- Dashboard 仍没有通用 Tauri 原生权限。仅新增经过现有桥接鉴权的单次离开回复端点，只有 Rust 发起的当前随机请求 ID 可以得到响应；端点本身无法发起退出或切换。
- 同一数据目录只能由一个客户端持有 OS 文件锁，进程退出/崩溃后自动释放；不要手工删除运行中客户端的 desktop.lock 文件。
- 非敏感偏好损坏时保留为 *.corrupt-<UUID>.json 并恢复默认值；无法读取或备份时使用只读默认值并提示，避免覆盖原始数据。session.dpapi 损坏仍拒绝恢复，不会明文降级或自动删除。
- desktop.log 位于连接设置目录，仅记录时间戳及固定事件代码；达到 256 KiB 后轮换到 desktop.previous.log，只保留一份历史。不记录地址、查询参数、Cookie、token、配置内容或消息正文，不向外发送。
- 读取缩放最多等待 2 秒；缩放偏好落盘失败不会阻断打开菜单、退出或连接切换。

验证入口与原生手工验收见 openspec/changes/harden-desktop-lifecycle/blackbox-test.md。真实 Windows WebView2、账号 OAuth 和安装升级不能用 Rust/DOM 测试结果替代。
