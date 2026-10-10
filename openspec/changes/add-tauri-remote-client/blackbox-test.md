# Black-box acceptance — Tauri remote client

## Goal and scope
A Windows frontend-only client connects to configurable remote Hermes servers, preserving login/API/WebSocket behavior and isolating sessions between servers. No local Python backend.

## Preconditions
Built exe/NSIS artifact; Windows WebView2 runtime; a reachable Hermes Dashboard server. Real user credentials are required only for manual acceptance, not for tests.

## Automated scenarios and pass criteria
- Real fixture HTTP server injects a token; bridge serves embedded frontend index/icon, authenticates local entry, forwards upload body/token headers, retains upstream Cookie without leaking the local bridge Cookie.
- Gated fixture redirects to a prefix-qualified password page; login sets an upstream Cookie; subsequent bootstrap renders the packaged frontend with auth_required=true and no legacy token.
- Real WebSocket server echoes text and binary data after upstream Cookie authentication. Dropping the bridge cancels the socket.
- Missing bridge Cookie, replayed entry URL, hostile Host/Origin and cross-port same-site requests are rejected. A new bridge rejects old cookies and has no remote login session.
- Invalid backend URLs are rejected; a valid address is saved and read back from a unique temporary directory.
- Windows build emits an exe and NSIS installer without Python assets.

## Manual scenarios
See README.desktop.md: first launch, persistent URL, actual remote login, real PTY chat, native menu/switch/restart, unreachable backend recovery and installer. OAuth providers require separate callback/WebView compatibility checks.

## Evidence and limitations
49 Vitest files / 355 tests passed. Both Rust transport contract tests passed with real sockets/imports, no mocked request client. Release/NSIS build passed. The old release was reproduced exiting with code 101 / AppData access denied before its first window. The repaired debug and release executables were launched successfully; release PID 39964 had a nonzero native window handle and the portable connection-window title, with no stderr error. The debug client also saved the default URL and opened a remote Dashboard window. Installer and authenticated login/chat remain manual; remote-debugging inspection was blocked by tool policy. ESLint cannot initialize due to a pre-existing missing @eslint/js package.

- Startup storage contracts: writable standard storage, portable fallback, URL persistence across selection/restart, and diagnostics containing both failing directory paths are covered by two additional real filesystem tests. All four Rust tests passed.


## Restart persistence regression coverage
- Recreate the complete bridge, cookie store and HTTP browser jar with a fresh random port: a Codex theme and font are restored in the bootstrap, and authentication is recovered from an actual DPAPI-encrypted file.
- A→B→A with two real fixture servers: preferences/cookies remain scoped to each canonical URL, even on the same host with different ports.
- Expired/deleted cookies are not restored; copied blobs cannot decrypt with another backend's entropy. Serialized credential content is not present as plaintext on disk.
- Explicit logout is followed by a restart and unauthenticated login page. An event-coordinated real HTTP response received after logout cannot re-save a session.
- Two frontend adapter behavior tests preserve browser-only localStorage and verify desktop partial saves/priority over stale defaults.
- Retest portable profile selection after standard directories become writable; the existing portable settings still win.

Latest verification: 50 Vitest files / 357 tests passed; all six Rust tests passed on real Windows, including DPAPI calls. No actual remote account password was used. Native authenticated end-to-end behavior and third-party OAuth still require user acceptance.
