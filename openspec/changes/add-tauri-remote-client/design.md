## Context
Vite emits a browser SPA using relative REST, cookie auth, server-injected bootstrap and same-origin WebSockets. The remote default server exposes password login. Rust/MSVC tools exist locally. Existing staged React edits must remain intact.

## Goals / Non-Goals
Goals: Windows exe with embedded frontend; editable persisted remote URL; HTTP(S), cookie authentication and WebSocket forwarding; an offline connection page that remains accessible when a server fails.
Non-goals: Python bundling, backend spawning, rebuilding chat, backend changes, guaranteeing third-party OAuth callback registration.

## Decisions
- Embed a separate desktop Vite output in Rust via include_dir; preserve the existing browser build output.
- Use an Axum HTTP/WebSocket loopback bridge. Direct cross-origin fetch would require changes throughout the SPA and backend CORS/cookie policies. Loading only a remote website would not package this frontend.
- Bind 127.0.0.1 on an OS-assigned port; require exact Host, same Origin when present, and a random HttpOnly/SameSite=Strict session cookie provisioned through a one-time secret navigation. Strip hop-by-hop headers; load each backend's own active cookie jar from Windows DPAPI-protected storage.
- Only allow HTTP(S) URLs without credentials/query/fragment. Support a backend path prefix and strip it from local redirects/bootstrap.
- The trusted Tauri-protocol connection window alone can call configuration commands. The proxied dashboard receives no native capabilities; commands also verify the calling window label.
- Switching closes the old dashboard and aborts its bridge, creating a fresh port and loading only the selected backend's state. Namespace state by SHA-256 of the canonical backend URL (scheme/host/port/path). Persist appearance as non-secret JSON and cookies as a Windows-user-scoped, backend-entropy-bound DPAPI blob, never passwords or plaintext cookies.
- Native menu opens connection settings and reloads the dashboard. Connection errors remain visible rather than silently falling back to the default.
- Defer configured window creation until storage has been checked. Preserve standard AppData paths when writable; otherwise use executable-adjacent hermes-dashboard-data for both URL settings and an explicit WebView profile shared by both windows. Show portable mode in the connection-window title; keep an already-used portable profile if AppData later becomes writable.
- Surface startup failures through a native Windows error dialog because a failed WebView cannot report its own initialization errors. No administrator elevation or permission changes.

- Random bridge origins remain security-isolated. Seed localStorage from the selected backend's appearance JSON before React mounts; persist theme/font changes through an authenticated, same-origin local endpoint. Native saved preferences outrank stale server defaults; browser builds retain their original behavior.
- Retain cookie expiry/domain/path/Secure metadata when serializing, including active session cookies. Persist immediately after Set-Cookie so crash/close does not require a shutdown flush. Explicit logout forgets all local cookies even if the backend is offline and also attempts remote revocation. Cookie writes are tagged with their request generation so responses started before logout cannot repopulate the saved session.
- Cookie-store write/crypto failures surface as request failures. Unreadable encrypted files fail closed with a recovery message; there is no plaintext fallback. Writes use same-directory temporary files plus replacement, and credential plaintext never reaches disk.

## Risks / Trade-offs
- OAuth absolute callbacks may land outside the bridge: document deployment-specific manual verification; password auth is the primary tested path.
- HTTP sends credentials unencrypted: show a warning and recommend HTTPS outside trusted networks.
- Remote plugins are trusted web code but receive no native privileges. The localhost bridge needs negative security tests.
- Frontend/backend version mismatch can still break API contracts: document upgrading the exe alongside the server.
- A loopback bridge costs a small Rust dependency footprint but avoids intrusive frontend/auth changes.

## Migration Plan
Additive desktop scripts/config only; rollback by removing new desktop files/scripts/dependencies. Browser build unchanged. No backend or user-state migration.

- Page locale shares the existing backend-scoped appearance record and bootstrap; the i18n module still validates supported locale IDs.
- Use the standard Tauri NSIS installer without the obsolete custom write preflight. The build workspace can carry inherited Low integrity labels, so raw workspace EXEs are not delivery artifacts. Publish fresh byte streams to a new normal user Downloads directory and provide a ZIP; do not change ACLs or elevate. Verify the published installer itself in a clean nested Unicode path, including HKCU registration, reinstall, installed WebView startup and uninstall. Bump the patch version to distinguish the delivery from old 0.1.0 packages.

## Titlebar connection menu (2026-10-09)
- Windows dashboard uses a frameless native window with two sibling WebViews: a 36-logical-pixel bundled titlebar and the existing unprivileged proxied dashboard below it. This keeps native commands out of server/plugin-controlled DOM; injecting native controls into the remote page was rejected.
- Enable the existing Tauri dependency's multi-WebView feature; no new package or remote native capability is introduced. Titlebar actions validate both WebView label and exact local titlebar URL. Configuration commands remain connection-window-only.
- Hide the attached native menu row, retaining its commands/accelerators, and pop up the same submenu next to the host label. Preserve minimize/maximize/close, drag/double-click, DPI-aware resizing, and connection-window lifecycle. Other OSes keep the existing decorated window.
- Rollback is the previous 0.1.1 package; no data migration. Verification requires real Windows WebViews, command rejection from dashboard content, menu/control behavior, and protected delivery outside the Low-labeled workspace.


## Saved connection and close lifecycle (0.1.4)
- Create the settings WebView hidden without its native menu. Only an existing valid connection.json triggers startup connection; a missing file is first-run and corrupt configuration stays in recovery UI instead of connecting to the default server.
- Startup and explicit save use the same bridge/open_dashboard path. Startup failure is held as transient native state and emitted to the trusted form; subscribing before reading state covers errors that happen before subscription.
- Dashboard close and menu Quit both exit. Settings close hides only an auxiliary settings window when a Dashboard exists; otherwise it exits. No data migration, tray/background mode or new remote capability.
- The trusted form shows the actual selected settings directory. Local backend-scoped appearance/encrypted cookie state and remote Hermes business configuration remain separate; switching servers does not delete a saved session.

## Dashboard maximize persistence (0.1.5)
- Keep an application-wide window.json beside connection.json, distinct from backend-scoped login/appearance and the connection form. Only the maximized boolean is persisted; no new dependency, native capability or window-position/size policy.
- Restore mode on Dashboard construction before showing it, and seed the trusted titlebar's maximize/restore label from the same state. Normal resize events and close/menu-quit snapshot the actual native mode; hidden startup events and minimized mode do not overwrite it.
- Reuse existing atomic_write and skip unchanged values. Commit the in-memory preference only after a successful write. Saved mode is reused when switching servers within the same process and restarting the client.
- Default to normal when the optional file is absent; malformed/unreadable saved window state reports a path-specific error. Real-filesystem tests cover maximize/restore reopening, unchanged connection data, minimize preservation and failed-write behavior. Actual native maximize/restart remains a user acceptance check unless native execution is available.

## Windows Dashboard native zoom (0.1.6)
- Enable the existing WebviewBuilder zoom_hotkeys_enabled setting only for the Windows dashboard-content child WebView. Leave the trusted desktop-titlebar WebView, connection form, and non-Windows window path unchanged.
- Windows Wry maps the option to WebView2 IsZoomControlEnabled (and pinch zoom where supported); it does not require any new remote/native capability. Browser accelerator keys already retain their default enabled state.
- Reuse native Ctrl-plus/equal/minus/zero and Ctrl-wheel behavior. No injected key handlers, extra dependency, zoom-level persistence or additional toolbar are introduced. Runtime keyboard/mouse behavior remains an explicit native acceptance check if not exercised.

## Native application menu (0.1.7)
- Replace the single connection submenu with one grouped application menu. Use a table of menu IDs/actions; separate desktop_menu and desktop_preferences modules keep the route/setup facade thin.
- Store auto-connect, pinning, remember-zoom and zoom in independent desktop.json with compatible defaults (true/false/true/1.0); reuse atomic_write and commit memory only after disk success. No connection/window/backend-session migration.
- Use native WebView2 ZoomFactor reads via with_webview plus a oneshot channel on asynchronous tasks, never blocking the UI thread. Snapshot on menu-open, reload, backend switch and close/quit. Ctrl+0 is registered as an explicit native reset-to100% menu command. Menu actions are serialized to avoid losing rapid accelerator presses. Optional zoom restoration changes content only; pinning is restored on Dashboard creation.
- Enable the existing Tauri devtools feature in release, and explicitly opt in dashboard-content only. DevTools open is user-triggered (F12), with no unsupported Windows close/open-state toggle promise; local settings/titlebar/about opt out. Native menu commands are not exposed as remote Rust commands.
- About is a separately bundled local WebViewWindow with label+URL guard, owned by the Windows Dashboard so it stays above its owner. Version/address/directories are read-only and refreshed on reopening; no live server-version/account query and no HTML insertion. Open-data-directory invokes Explorer with a native argument, not a shell command.
- Use the user's bootstrap-installer multi-frame ICO as a checked-in independent asset. prepare.mjs no longer overwrites it with the low-resolution browser favicon; titlebar/NSIS installer/uninstaller use the same asset. No AI-generated redesign or new runtime dependency.

## Complete icon frames and explicit shell links (0.1.8)
- Diagnose actual installed exe/group resources and the user's shortcut target without editing user data. Old ICO has16/32/64/128/256 but not48. Shell48 and256 extraction demonstrates resolution-dependent detail; cached-vs-fresh-path extraction is identical, so old-path cache alone is not established as the cause.
- Copy the original user-selected1024px PNG master into the project and check in a regenerated15-frame ICO covering intermediate desktop/DPI sizes. Preparation still copies the dedicated ICO and never replaces it with favicon. Optional Pillow regeneration is build-time asset tooling only.
- Bundle one external icons/hermes-dashboard.ico file. New shortcuts reference it explicitly; migration updates only IconLocation through IShellLink/IPersistFile, preserving arguments/target/description and skipping unrelated shortcuts via the existing IsShortcutTarget guard. SHChangeNotify targets only the modified shortcut, not global caches/Explorer.
- Compile/run the same NSIS macro against a temporary real.lnk to prove icon readback and metadata preservation; assert missing shortcut fails without creating it. Inspect final exe/setup PE resources for all15 frames. Actual desktop refresh after installation remains user acceptance.
