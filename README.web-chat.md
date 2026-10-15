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

Browser sessionStorage keeps only the stored conversation IDs, tab order and
active conversation, scoped to origin, base path and profile. The original last-ID
key remains compatible. Reloading restores those tabs over one new connection,
with at most two concurrent existing resume requests. A deleted or refused
conversation stays as a local retryable error rather than creating a replacement.
Malformed or blocked storage falls back to the prior last-ID behavior when available.
Transcript history remains on the server; text/image drafts and private input are
never persisted. New chat does not delete old server history.

After the first Web Chat visit, its profile-scoped workspace survives navigation
to Files, Logs and other in-app routes. Returning retains tabs, selection, cached
messages, text/image drafts, scroll/cursor and expansion state; valid cached views
need no connection or history reload. The chat body unmounts while away, pausing
roster/tail and cold snapshot-follow polling, while the shared WS continues routing
background messages and requests. Existing cache budgets still apply: an evicted
history needs local recovery on return. Ordinary navigation does not discard chat
drafts or prompt for them. Profile replacement and refresh/window/native departure
remain guarded, even while another page is visible; other editors still protect
their own edits. Confirmed profile replacement disposes the old socket and owned
image URLs. Browser routing and server APIs are unchanged.

The workspace owns one logical WebSocket per origin, base path and selected
profile. Conversation state and client operations are independent; the page
renders only the selected conversation body. A cached tab selection needs no
new connection, activate, resume, history or list request. Other open
conversations continue receiving events and human requests by runtime ID.

Conversation tabs sit beside the page title. The + button offers New chat and
historical conversations that are not already open; dismissing it creates no
session or tab. A successful create/resume commits the new tab, while a refused
load keeps the old view and draft. An empty unbound placeholder is reused. Late
open results do not override a newer selection. Empty conversations remain
Untitled until a title or first user message is available.

Viewing another tab is allowed while a conversation is working, waiting for
input or performing a client transaction. Closing/replacing the transaction's
own tab waits for submission acknowledgement, image staging, slash execution
or model confirmation. Asynchronous results stay attached to their original
conversation. Text/images, cursor, scroll/follow and expansion state are
retained while this workspace is mounted. The toolbar dropdown can replace a
running conversation's view; that task remains reachable in the background.

Closing an idle tab releases its local history. Closing a running/waiting tab
releases its local body/preview and leaves a visible Background tasks entry that
can reopen it and answer requests. Reopening a closed view restores full state
through the existing APIs; inactive tabs that remain open keep their warm cache.
The active tab chooses its left neighbor (right when there is no left), and the
last tab stays open. No ordinary close calls session.close, delete or interrupt.
The existing server has no per-session detach method, so a lightweight binding
record survives for this connection generation. A later request on a closed
binding promotes it back to background tracking.

The current connection allows at most 16 potentially attached runtimes,
including closed records and pending/uncertain creations. Local closing does
not free a remote subscription. At capacity, use Reclaim idle connection records
when every known task/request/client transaction and uncertain send is resolved;
it reconnects once and restores only the visible conversations, preserving
drafts. A lost create acknowledgement is never automatically retried. Unknown
create membership can be cleared by ending the old idle connection, rather than
guessing a session ID from the history list.

History retention is limited to 8 conversations and an estimated 64 MiB;
each displayed history keeps at most 400 rows / 8 MiB. Evicted background
histories keep finite previews/status rather than growing from tokens again.
Text drafts have a shared 4 MiB budget, image Files 100 MiB (25 MiB each), and
recent closed drafts retain at most 8 entries without evicting open/task drafts.
Owned image URLs are released on removal, eviction and departure. These limits
bound retained data; a legacy full server response can still cause a larger
network/JSON-decoding peak before trimming. Retained sizes are estimated from
UTF-16 content and fixed object/reference overhead, cached by immutable identity.
Buffer counters update on enqueue/drain and request counters on metadata changes;
normal streaming does not serialize histories, requests or summaries for sizing.

A single recovery coordinator uses at most two concurrent attachments. Complete
live projections in the same runtime/epoch activate and replay from their
actual applied sequence, buffering/deduplicating live events. Missing runtimes
resume the stored identity. Truncated replay, sequence gaps, epoch changes and
cold caches use full existing-protocol responses. Running cold recovery shows
Synchronizing and replaces provisional text; only the visible active view
refreshes a full snapshot, at most once per second without overlapping calls.
Final text and settled history calibrate the result. The existing protocol has
no atomic snapshot cursor, so cold inflight recovery does not promise an
exactly-once snapshot/delta join.

Requests replayed before attachment replies are buffered and assigned once the
runtime identity resolves. Disconnection disables old responders; a replayed
request replaces its closure. Private form values are cleared on disconnect
or view removal and never enter the workspace cache/storage. Uncertain prompt
acknowledgements keep an explicit notice and draft, are never automatically
resent, and are not accepted/cleared based on arbitrary identical history text.

The shared leave guard aggregates every open/background draft and short client
transaction. Cancelling profile replacement keeps the workspace intact; confirmed profile
replacement or actual application departure disposes its socket, listeners, timers
and URLs. In-app route departure preserves the workspace. Long server tasks do not
indefinitely block navigation. Reload restores stored tab identities/order/selection;
draft bodies, Files and requests are not persisted.

If incremental replay is unavailable, disconnects use conservative full
recovery. A missing attachment method uses explicit single-session compatibility
with the existing resume API; tab selection restores the active conversation
and background streaming is not promised. An idle user can also choose that
mode from an error state after verifying a non-additive deployment. Network,
permission and settling errors remain their actual errors. No backend/shared
package/Rust protocol change or new capability field is needed. Actual additive
routing on the target deployment still requires its own acceptance check.

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

A collapsed Subagents strip appears above the composer when children are known.
The read-only first version shows goals, model/status, tool counts and last tool;
select a child to inspect recent activity, its completion summary and live log.
It subscribes to subagent events and hydrates with session-scoped subagent.list
every 5 seconds while its selected conversation view is visible. Only the expanded child log polls
subagent.tail (2 seconds while running); the server caps this to the latest
16 KiB. Hidden pages and background tabs stop polling. Summaries observed here remain cached per
conversation until this workspace is disposed; they are not a durable child-history
viewer. Missing roster entries show unavailable rather than guessed completion.
Unavailable logs retain the last fetched content while the detail remains open.
Legacy backends without subagent.list keep the event-fed list without repeated
method-not-found calls. Steering and per-child stop controls are not included.

Markdown rendering uses react-markdown with remark-gfm (CommonMark + tables,
nested lists and task lists). Fenced code has a language header, a copy action
and a stable theme-aware surface. Raw HTML remains escaped; only standalone
inline br tags are converted to line breaks. Search highlighting and the live
streaming caret are presentation transforms on the parsed tree.

Lost submission acknowledgements are not retried automatically. Use Reconnect to
load authoritative server history and determine whether the turn was accepted.
Stopping remains busy until the backend sends its terminal message event.

Typing / or a command prefix opens the server's complete.slash suggestions for
the current session/profile/workspace, including skill commands. Arrow keys select,
Tab or Enter completes, Escape dismisses, and Shift+Enter inserts a newline.
The popup is debounced and stale completion responses are discarded.

Slash commands run through slash.exec, with command.dispatch fallback only for
ownership refusals. Plain output is displayed separately from model replies;
skill/send directives submit their model-facing payload while showing only the
invocation. Prefill directives populate the composer without automatically sending.
The /new, /stop and /resume families are deliberately not connected yet; use the
existing page controls. They are never sent to the model or executed in a worker.

Image messages support file selection, clipboard paste and drag/drop, removable
thumbnails and a full-image preview. Send text with images or images alone. PNG,
JPEG, GIF, WebP and BMP are supported, up to 25 MB per image. Unsent images remain
local to their profile/conversation across in-app navigation; they are not
restored after a reload. Slash commands with image drafts are refused explicitly.

Sending reuses POST /api/chat/image-upload, then image.attach and prompt.submit.
Uploads name the selected profile, attachment RPCs name the live session, and the
existing backend decides native vision versus vision-tool handling. Known failed
sends detach staged images before retry; lost prompt acknowledgements are never
automatically resent. History @image refs are rendered through authenticated,
profile-scoped GET /api/media and remain visible after resume.

The page does not implement non-image file attachments or a searchable/full
history picker. Automatic network recovery belongs to the workspace, with one
retry/backoff schedule and a manual reconnect action.

The composer model label opens a compact provider -> model cascader backed by
session-scoped model.options. Choosing a model calls config.set with an explicit
provider and --session, preserving profile defaults and other conversations.
The menu has two single-line columns; click a provider (or activate it with Enter/Space), then choose its
model. The label shows provider/model (including custom:<name> slugs). Switching blocks
duplicate picks, prompt submission and closing/replacing the target tab until acknowledged;
server-required expensive-model confirmations are kept. Active turns, image
staging and pending human requests must finish before a model can be changed.

The displayed selection prefers `model_config` from the existing profile-scoped
`GET /api/sessions/{stored_id}` detail endpoint. Serialized JSON and object configs
are both supported; only the provider/model identity is retained per controller.
Warm tab and route switches reuse this identity without another detail request.
Missing, malformed or unavailable metadata falls back to the WS/catalog display.
Successful model changes update the selection immediately and invalidate older
detail requests. This affects display only, not the backend's actual request route.

For development use the existing Vite proxy (pnpm dev) and configure
HERMES_DASHBOARD_URL for the running Dashboard/Serve backend. Install with
pnpm install --frozen-lockfile and build with pnpm build. The output is repository-local dist/, using the pinned vendor/hermes-shared snapshot; a parent
Hermes checkout is not needed for compilation. The new page uses the same theme
tokens, UI buttons and Markdown renderer as the rest of the dashboard.
