## Context
The bundled Web UI and privileged Tauri chrome are separate WebViews. Existing native labels are fixed; changing all labels to stage two complete dashboards would expand the security and menu surface unnecessarily. Scope is strict because lifecycle and authenticated local transport cross security boundaries.

## Goals / Non-Goals
Goals: preserve transport semantics; prevent silent draft loss; keep a working old backend recoverable; bound waiting; recover non-secret preferences safely; serialize ownership of user state.
Non-goals: native privileges for remote content, OAuth redesign, backend changes, new dependencies, telemetry, automatic release or deletion of user data.

## Decisions
- Keep fixed window labels. Preflight successful HTML for Hermes bootstrap, but preserve valid HTTP(S) authentication redirects (including external gateways); identity after a login redirect can only be checked after authentication. Obtain leave consent, retain the old bridge while replacing its window, commit connection.json atomically only after creation. On failure recreate the old window with a fresh one-use bridge entry. Report rollback failure explicitly and retain settings recovery UI. Same-backend reconnect reloads its existing bridge rather than creating competing cookie jars.
- Separate one-use entry tokens from the stable per-bridge cookie secret so rollback does not reuse consumed entry URLs.
- Native leave checks create a random request ID owned by the active bridge. The unprivileged page can only answer that outstanding request via same-origin authenticated POST /__desktop/leave. It cannot initiate quit/switch or invoke Rust commands. Clean/dirty/busy states reuse the Web editor guard. Unresponsive/unsupported pages require a native confirmation defaulting to cancellation; waiting on a displayed confirmation has a bounded deadline.
- HTTP reads use an idle deadline rather than a blanket short total timeout, preserving continuously active uploads/downloads/streams. Shutdown cancels header waits and streamed bodies; WebSocket close code/reason are converted bidirectionally.
- Non-secret preference failures preserve original files. Parse/validation failures are moved to uniquely named backups before defaults may be saved; if preservation fails, defaults remain read-only. Credential recovery remains fail-closed. Optional zoom snapshots must not prevent opening menus or switching/exiting.
- Use a std file lock held for the selected data-directory lifetime. No process-name matching, stale PID files, new plugin or credential migration.
- Diagnostics rotate locally and contain timestamped fixed event codes only, not URLs, tokens, Cookie values, payloads or configuration contents. Detailed recovery messages are shown locally, not logged.
- Connection/titlebar/about command and navigation guards share exact bundled-origin, label and path validation.

## Risks / Trade-offs
- Fixed-label rollback recreates rather than preserves the old WebView; leave consent occurs before destroying it. Because Wry destroy() enqueues an event, replacement waits up to five seconds for the window and child-WebView labels to disappear. A failed native recovery is reported, never presented as a successful switch.
- Approval synchronously freezes page input until the native action completes. A scoped native permit sends cancellation to unfreeze the original renderer on failure; it never silently grants a later action.
- Remote web content can answer only its own pending leave request; this does not elevate its trust or expose native commands.
- Idle deadlines can interrupt genuinely silent streams; use a generous bound and verify active streams are not subject to a total deadline.
- Native window behavior requires Windows acceptance beyond Rust/DOM tests. Record unexecuted checks truthfully.

## Migration Plan
Existing connection/session/preference formats remain readable. Optional corrupt files are preserved beside their originals. Revert source to roll back; do not erase servers/ or session.dpapi. No artifact publishing in this change.
