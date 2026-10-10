## 1. Desktop integration
- [x] 1.1 Add Tauri manifest, capabilities, native connection UI and isolated desktop build output.
- [x] 1.2 Implement URL validation, persistence, connection switching and native menu.
## 2. Transport
- [x] 2.1 Embed assets and forward bootstrap, HTTP cookie login and WebSocket frames with loopback access guards.
- [x] 2.2 Add real HTTP/WebSocket contract tests including unauthorized requests and switching isolation.
## 3. Delivery
- [x] 3.1 Build exe/NSIS installer.
- [x] 3.2 Document build/run/security constraints and record verified versus manual-only authentication scenarios.
- [x] 3.3 Reproduce the startup crash, validate storage selection and manually launch the repaired Windows executable.
- [x] 3.4 Check profile/portable storage persistence and failure reporting with two additional filesystem contract tests.
- [ ] 3.5 Installer and authenticated remote login/chat still require user acceptance; no account credentials were used.

## 4. Restart persistence
- [x] 4.1 Persist desktop appearance per backend, bootstrap it before React and preserve ordinary browser behavior.
- [x] 4.2 Persist remote cookie metadata with Windows DPAPI, restore before preflight, and forget local sessions on logout.
- [x] 4.3 Verify reopen, A→B→A, expiry, encryption/backend binding and hostile-origin requests with real filesystem/HTTP/DPAPI tests; verify the frontend adapter with behavior tests.
- [x] 4.4 Rebuild and launch the repaired Windows artifacts, update persistence/security documentation and receipts. Default installer filename was occupied; delivered the completed NSIS output under the persistence-setup filename.

## 5. Installer write checks and language persistence
- [x] 5.1 Extend the existing backend-scoped preference protocol with locale and route I18nProvider saves through it; bootstrap hermes-locale before React mounts.
- [x] 5.2 Add a pre-extraction NSIS write check using OPEN_EXISTING (no truncation), actionable retry/cancel messages and no process-name kills.
- [x] 5.3 Retest real restart/bootstrap locale restoration and frontend saves; test compiled NSIS hook with a real locked and then unlocked target file.
- [x] 5.4 Rebuild exe and deliver latest NSIS intermediate under the language-installfix filename because the old standard installer remains running.

## 6. Clean installer delivery (0.1.1)
- [x] 6.1 Rebuild the current standard Tauri NSIS installer without the obsolete custom write preflight; distinguish it with a patch version.
- [x] 6.2 Exercise the complete delivered installer in a new nested Unicode/space path, reinstall with a preserved data sentinel, and launch the installed executable.
- [x] 6.3 Deliver checksummed artifacts and replace stale installer instructions with the verified workflow and limitations.
- [x] 6.4 Reproduce Low-integrity registry failure, publish fresh bytes to normal Downloads without changing ACLs, and repeat complete installer E2E under D:\Soft. Supersedes the obsolete custom-hook approach in section 5.

## 7. Titlebar connection menu (0.1.2)
- [x] 7.1 Place connection menu beside the backend title in an isolated local titlebar; preserve remote capability isolation and window lifecycle.
- [ ] 7.2 Native Windows interaction acceptance remains pending: executable launch was policy-blocked. Eight Rust tests passed; isolated browser preview verified the single-row layout and maximize/restore label binding with a mocked native bridge.
- [x] 7.3 Rebuild and publish the patched Windows package in normal Downloads; record receipts and remaining manual checks.


## 8. Compact titlebar and recoverable upgrade (0.1.3)
- [x] 8.1 Reduce the Windows titlebar from 36 to 30 logical pixels and menu button from 28 to 24.
- [x] 8.2 Recommend in-place NSIS upgrade preserving configuration; keep explicit uninstall, actionable path/exit-code diagnostics and consent-based repair fallback.
- [x] 8.3 Compile six shared maintenance-policy choices; verify a real 0.1.2 upgrade with its uninstaller renamed in an isolated profile, plus fresh D:/Soft install/reinstall/launch/uninstall.

## 9. Saved connection and close lifecycle (0.1.4)
- [x] 9.1 Automatically open a saved backend, falling back to editable settings for missing/corrupt configuration or startup failure.
- [x] 9.2 Remove the settings menu bar; Dashboard X and menu Quit both exit, while auxiliary settings close leaves Dashboard open.
- [x] 9.3 Show the actual selected local data directory and clarify preserved backend sessions and remote configuration.
- [x] 9.4 Validate settings-file/connection-form contracts, rebuild and publish the 0.1.4 package outside the Low-labeled workspace.
- [ ] 9.5 Actual native saved startup, menu absence, Dashboard X exit and auxiliary-settings close acceptance: new E2E harness creation/execution was policy-blocked; requires user acceptance.

## 10. Dashboard maximized-mode memory (0.1.5)
- [x] 10.1 Persist an app-wide maximized boolean beside connection settings and restore it before showing Dashboard; seed the matching titlebar control state.
- [x] 10.2 Snapshot mode on native resize, close and menu Quit; ignore minimized and hidden startup windows; retain backend credentials/preferences unchanged.
- [x] 10.3 Verify maximize/restore reopen, minimized preservation, unchanged connection data and failed writes with two real-filesystem contracts.
- [x] 10.4 Rebuild/publish protected Windows delivery and record actual evidence versus native acceptance limitations.
- [ ] 10.5 Actual native maximize/restore then quit/reopen (X and menu Quit) remains user acceptance; automated native interaction was not performed this turn.

## 11. Windows Dashboard zoom hotkeys (0.1.6)
- [x] 11.1 Enable native zoom_hotkeys_enabled on dashboard-content only; leave titlebar, connection form and remote command capabilities unchanged.
- [x] 11.2 Compile/test the app, rebuild and publish protected Windows artifacts, record runtime verification limitations.
- [ ] 11.3 Actual Ctrl-plus/minus/zero and Ctrl-wheel behavior in the native Dashboard remains user acceptance; no native key/mouse automation was performed.

## 12. Grouped desktop menu and dedicated icon (0.1.7)
- [x] 12.1 Implement grouped native menu and separate compatible desktop preference store; defaults preserve existing automatic-connect behavior.
- [x] 12.2 Restore optional zoom/pinning, read real Windows controller zoom on normal exit/switch/menu, serialize rapid menu operations and retain titlebar isolation.
- [x] 12.3 Enable user-triggered release DevTools only for content; add safe data-folder/About actions with local origin/label checks and truthful metadata.
- [x] 12.4 Restore the user-selected bootstrap ICO and stop prepare.mjs from overwriting it; use the same asset for titlebar and NSIS installer/uninstaller.
- [x] 12.5 Rebuild final artifacts, verify preference/security/UI-binding contracts, preserve the selected icon across preparation, publish receipts.
- [ ] 12.6 Actual native menu clicks, accelerator/zoom restoration, DevTools popup and Explorer/About actions require user acceptance if not exercised by native E2E.

## 13. Desktop icon sizing and explicit shortcuts (0.1.8)
- [x] 13.1 Inspect actual installedPE resources/shortcut target and compareShell image-list sizes/cache paths; do not guess that only cache is at fault.
- [x] 13.2 Generate15 ICO frames from the selected1024px master and keep favicon separate.
- [x] 13.3 Install the explicit desktop ICO; create/update app-owned shortcuts without changing unrelated metadata or global Explorer cache.
- [x] 13.4 Compile/run temporary real-shortcut contract, verify final15-frame exe/setup resources, publish protected installer.
- [ ] 13.5 Actual desktop appearance after upgrading and DPI-specific visual acceptance remains a user check.
