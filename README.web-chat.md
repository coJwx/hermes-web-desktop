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

Conversation tabs sit beside the page title. The + button opens a picker with
New chat and historical conversations that are not already open in a tab;
opening this picker creates neither a tab nor a server session. Selecting an
entry loads its conversation before adding the tab. Empty new conversations are
labeled Untitled until a title or first message is available. The toolbar's
conversation dropdown also excludes sessions occupied by other tabs.

Tab switches can leave an acknowledged model turn running on the server and
resume it later. Loading, submission acknowledgements, image staging, slash execution, model switching,
pending human requests and unresolved unsent messages block tab navigation.
Failed loads preserve the previous tab binding and draft; reconnect to restore
its transport. Closing a tab keeps the conversation's server history and makes
it available in the picker again. Closing the active tab selects its nearest
neighbor, and the final tab remains open. Tabs and drafts reset when changing
profiles or leaving the page; only the last selected session is restored on reload.

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
every 5 seconds while the page is visible. Only the expanded child log polls
subagent.tail (2 seconds while running); the server caps this to the latest
16 KiB. Hidden pages stop polling. Summaries observed here remain cached per
conversation until this page is unloaded; they are not a durable child-history
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
local to their profile/conversation while this page is mounted; they are not
restored after a reload. Slash commands with image drafts are refused explicitly.

Sending reuses POST /api/chat/image-upload, then image.attach and prompt.submit.
Uploads name the selected profile, attachment RPCs name the live session, and the
existing backend decides native vision versus vision-tool handling. Known failed
sends detach staged images before retry; lost prompt acknowledgements are never
automatically resent. History @image refs are rendered through authenticated,
profile-scoped GET /api/media and remain visible after resume.

The page does not implement non-image file attachments, a searchable/full
history picker or automatic network reconnection.

The composer model label opens a compact provider -> model cascader backed by
session-scoped model.options. Choosing a model calls config.set with an explicit
provider and --session, preserving profile defaults and other conversations.
The menu has two single-line columns; hover or select a provider, then choose its
model. The label shows provider/model (including custom:<name> slugs). Switching blocks
duplicate picks, prompt submission and conversation switching until acknowledged;
server-required expensive-model confirmations are kept. Active turns, image
staging and pending human requests must finish before a model can be changed.

For development use the existing Vite proxy (pnpm dev) and configure
HERMES_DASHBOARD_URL for the running Dashboard/Serve backend. Build with
pnpm exec tsc -b and pnpm exec vite build. The new page uses the same theme
tokens, UI buttons and Markdown renderer as the rest of the dashboard.
