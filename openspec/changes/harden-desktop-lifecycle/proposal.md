## Why
The desktop bridge loses WebSocket close semantics and native lifecycle actions bypass editor guards. Connection replacement, stalled requests and damaged non-secret preferences need safe recovery rather than destroying a usable session.

## What Changes
- Preserve WebSocket close frames; bound stalled HTTP requests and cancel old bridge work.
- Preflight Hermes responses, retain the old bridge until window/settings commit, and restore it on failure.
- Guard native close/reload/switch through an authenticated, nonce-bound leave-decision endpoint without remote Tauri privileges.
- Recover non-secret preferences with backups/read-only fallback, keep credential failures closed, add bounded credential-free local diagnostics.
- Validate bundled connection origin/path and hold an OS data-directory lock.
- Add behavioral regression coverage and distinguish native acceptance from headless tests.

## Capabilities
### New Capabilities
- `desktop-reliability`: recoverable native lifecycle, transport semantics and local state safety.
### Modified Capabilities
None; the existing remote-client change remains separate and unarchived.

## Impact
Rust modules under src-tauri, the Web unsaved-change provider and its desktop adapter, tests and desktop documentation. No backend changes, new runtime dependencies, credential migration, signing, packaging release, or expansion of remote native capabilities.
