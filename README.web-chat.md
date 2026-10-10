# Web Chat (optional JSON-RPC client)

Open **Web Chat / 网页对话** in the sidebar or visit /web-chat. The original
/chat terminal page is unchanged. This additional page is an explicit local
feature request, an exception to the upstream dashboard's TUI-only chat policy.

The page connects directly to the existing /api/ws endpoint through
GatewayClient; it needs neither a PTY nor Node/Ink on the server. No API Server
on port 8642 or new backend endpoint is required. Dashboard login/session-token
and single-use WebSocket-ticket authentication are reused.

Supported: session creation/resume, streamed Markdown replies, reasoning and tool
activity, stop, new conversation, a profile-scoped conversation dropdown, manual reconnect, approval, single/batch
clarification, sudo and secret requests. Unsupported server requests fail through
the shared client's method-not-found response, never an implicit approval.

Only the last stored session ID is kept in browser sessionStorage, scoped to
origin, base path and profile. Transcript history remains on the server. Reloading
or returning to the page resumes that conversation; changing profiles restores
the selected profile's own session. Private input is never added to the local
transcript or sessionStorage. If storage is blocked, automatic refresh recovery is
unavailable. New chat does not delete old server history.

The compact toolbar lists the selected profile's latest 100 sessions through
session.list and switches with session.resume. The list refreshes after turns,
on session-change notifications and when the dropdown is focused. Switching is
disabled during an active turn or pending human request; stop or finish it first.
Unsent drafts are retained per conversation while this page remains mounted.

Dropdown options show the title followed by a secondary line with relative
creation time (started_at, not last activity), message count and source
(gui/tui/api_server/etc.). Missing metadata is omitted. The compact trigger shows
only the title; the current full session ID remains outside the dropdown.

Tool calls use compact, collapsible activity trails with argument previews rather
than separate large cards. Reasoning-only steps share one folded section. Expand
an individual call to inspect arguments and output supplied by the server; live
completion preserves start-time context and displays duration/error status.
Current session.resume history snapshots supply tool arguments/context but omit
outputs, so restored calls explicitly say when output is unavailable.

Lost submission acknowledgements are not retried automatically. Use Reconnect to
load authoritative server history and determine whether the turn was accepted.
Stopping remains busy until the backend sends its terminal message event.

This first version does not implement the TUI's slash-command palette, image/file
attachments, a searchable/full history picker, model picker or automatic network reconnection.
Messages are ordinary model prompts, not terminal commands.

For development use the existing Vite proxy (pnpm dev) and configure
HERMES_DASHBOARD_URL for the running Dashboard/Serve backend. Build with
pnpm exec tsc -b and pnpm exec vite build. The new page uses the same theme
tokens, UI buttons and Markdown renderer as the rest of the dashboard.
