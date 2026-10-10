## Why
The user needs a Windows executable containing the existing frontend, without Python or a bundled Hermes backend. The remote backend defaults to http://10.144.1.2:9119 but must be user-configurable.

## What Changes
- Add a Tauri 2 application and reproducible Windows build scripts.
- Add an offline connection window with validated, persisted backend URLs and native-menu access.
- Embed the Vite frontend and forward HTTP/WebSocket requests through an authenticated loopback bridge.
- Preserve server-injected session bootstrap, cookie login and the existing PTY chat.
- Keep browser builds and existing user changes unchanged.

## Capabilities
### New Capabilities
- `tauri-remote-client`: Packaged frontend, configurable remote connection, isolated authentication and Windows artifacts.
### Modified Capabilities
None.

## Impact
Changes are scoped to web/package.json, its lockfile, new desktop build/connection files and web/src-tauri. No Python, shared client, Electron or existing React feature changes. Adds Tauri CLI and bounded Rust dependencies. Security-sensitive bridge behavior requires real HTTP and WebSocket tests; OAuth provider callbacks require manual deployment-specific verification.
