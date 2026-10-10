# Desktop reliability acceptance

## Scope and prerequisites
Use an isolated test Windows user/data directory and disposable Hermes backend fixtures; never alter real login data or installed registration. Build the bundled frontend before compiling Rust. Existing browser-only deployments must still work without a desktop endpoint. No credentials are needed for automated fixtures.

## Automated contracts
- Real HTTP/WS: text/binary and bidirectional close code/reason, idle reads, active streaming beyond the idle interval, shutdown during headers/body, hostile-origin and one-use entry/reply checks.
- Real filesystem/DPAPI: atomic failure leaves the saved connection intact, corrupt non-secret backups/read-only fallback, OS directory lock release, credential backend binding/expiry/logout generations, bounded fixed-event log rotation.
- Lifecycle operation adapter: candidate creation and commit failures restore old state; rollback failure is reported; settings never commit before window creation.
- Actual React provider: native pending/deny/allow/busy use the same draft guard; approval suppresses only one beforeunload; stale/failed replies and native cancellation do not grant approval.

## Native Windows checks (manual unless separately evidenced)
1. In a disposable profile edit Config and Skill, then use X, Alt+F4 and native Quit: cancel retains input; discard exits; saving refuses exit.
2. Repeat with native Reload and backend A→B→A. Confirm cancellation keeps the old host, login and draft; same-backend reconnect reuses its session.
3. Connect to an unrelated HTTP 200 site and unreachable host: old Dashboard stays usable and saved address unchanged. Inject window/create or connection-file failure: old connection is recreated or a specific rollback error and settings UI are shown.
4. Suspend/unresponsive test renderer: after initial wait, native force confirmation defaults to No. A shown confirmation times out without proceeding. Repeat rapid menu/X actions: no duplicate exits or queued accidental approvals.
5. With disposable copied prefs, corrupt desktop/window/appearance JSON: startup warns and preserves a backup. Make backup impossible: default operation is read-only. Corrupt copied session.dpapi: login recovery fails closed.
6. Start a second client using the same test data directory: it refuses ownership. Exit first and restart: lock is released and credentials unchanged.
7. Change zoom with keyboard/wheel, open menu with read-only prefs, reload, switch and exit: optional persistence errors do not strand navigation. Verify max/restore, titlebar layout and dialogs above pinned windows.

## Limits
Headless tests do not prove native window creation/destroy ordering, MessageBox/WebView2 focus/OS close behavior, real account/OAuth flows, installed shortcuts, DPI appearance, or NSIS upgrade/uninstall. Do not mark these executed without a native receipt. Existing installer/maintenance scripts remain unchanged and are not run against the user's installation.
