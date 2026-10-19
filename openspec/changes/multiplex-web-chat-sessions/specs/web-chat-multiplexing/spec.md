## ADDED Requirements

### Requirement: A workspace owns one continuous connection

The Web client SHALL own one logical active WS per origin, base path and selected profile. Selecting a ready tab MUST NOT reconnect, resume, activate or reload an already valid conversation. Other browser windows remain independent.

#### Scenario: Warm switches
- **WHEN** five live-valid cached conversations are selected 100 times
- **THEN** there is one logical WS, no selection-driven session RPC, and only the selected conversation body is rendered

#### Scenario: Profile replacement
- **WHEN** the user confirms A to B to A profile changes
- **THEN** old connection generations are disposed and no messages, drafts or operation results cross workspace scope

### Requirement: Session operations retain their target

Messages, assistant/tool IDs, model and image transactions, requests and drafts SHALL belong to their session. Operations MUST capture stored/runtime identity, profile and generation when started. Selecting another tab MUST NOT retarget an asynchronous result. Resolved duplicate lineage tips SHALL use one tab.

#### Scenario: Image upload after selection
- **WHEN** A uploads images and B is selected before attachment completes
- **THEN** attachment and submission target A, B retains its own drafts, and A cannot be closed during its client transaction

#### Scenario: Delayed model confirmation
- **WHEN** A's model confirmation returns while B is displayed
- **THEN** the confirmation remains bound to A and never changes B's model

### Requirement: Opening is transactional

The plus menu SHALL offer new conversations and unopened history, allocate no session before selection, and commit a new tab only after actual existing-protocol attachment succeeds. Refused loads SHALL preserve the previous view/drafts. An unbound placeholder SHALL be reused only if text and image drafts are empty.

#### Scenario: Dismissed picker
- **WHEN** the menu is opened then dismissed
- **THEN** no session or tab is created and no extra WS appears

#### Scenario: Empty placeholder after failure
- **WHEN** initial create fails and later history attachment succeeds with an empty unbound placeholder
- **THEN** that placeholder is reused without an unusable neighbor

#### Scenario: Late open result
- **WHEN** an open response arrives after the user chose another view
- **THEN** the conversation is retained without stealing the later view selection

### Requirement: Background events and requests stay reachable

The workspace SHALL route events and supported server requests by runtimeId, including pending attachments and closed binding records. Background content MUST NOT be rendered into another session. Secrets MUST NOT enter messages, caches, browser storage or logs.

#### Scenario: Concurrent background states
- **WHEN** A completes and C asks for approval while B is displayed
- **THEN** A's completion and C's waiting entry update, B's body is unchanged, and no approval is automatic

#### Scenario: Request before attach reply
- **WHEN** resume delivers open_requests before its RPC promise resolves
- **THEN** supported requests are retained and assigned after identity resolves rather than rejected because B is active

#### Scenario: Closed session asks for input
- **WHEN** a retained closed binding receives a supported human request
- **THEN** it is promoted to a visible reachable background entry with a valid responder

### Requirement: Existing-protocol recovery is conservative

One coordinator SHALL recover attachments with concurrency at most two. Complete live-valid caches SHALL use actual applied seq and verified continuous replay. Cold, truncated, restarted or invalid projections SHALL use existing full-state returns without claiming an atomic cursor. Uncertain prompt/create results MUST NOT be automatically resent.

#### Scenario: Warm replay
- **WHEN** epoch/runtime remain valid and a complete live projection can replay all missed events
- **THEN** replay and live buffered events are reduced once in sequence with no duplicate text

#### Scenario: Cold restore while running
- **WHEN** a running conversation is restored without a trustworthy projection boundary
- **THEN** full-state responses replace temporary text, concurrent deltas are not blindly appended, synchronization is visible, and terminal content is reconciled

#### Scenario: One failed conversation
- **WHEN** A's recovery fails but B succeeds
- **THEN** A has a local retryable state and B is not cleared or subjected to another workspace dial

#### Scenario: Lost acknowledgement
- **WHEN** prompt.submit or create may have been accepted but its result is unknown
- **THEN** uncertainty is retained and neither operation is automatically repeated or inferred from arbitrary identical history text

### Requirement: Closing releases local views rather than server subscriptions

Ordinary close SHALL remove the tab and eligible heavy local resources without calling session.close/delete/interrupt or an invented detach method. A lightweight current-connection binding record SHALL remain while the server may still route events. Working/waiting sessions SHALL have a visible background entry. Closing during a client transaction SHALL be rejected and the final tab retained.

#### Scenario: Idle close with other session running
- **WHEN** A is idle and closes while B streams
- **THEN** A's local history/media are released, its binding record remains, B's WS is untouched, and the UI does not claim server detachment

#### Scenario: Running close
- **WHEN** a running or waiting A tab closes
- **THEN** A remains reachable through background tracking and no stop or close RPC is sent

#### Scenario: Offline close
- **WHEN** an idle closed session's socket generation has actually ended
- **THEN** its record is excluded from recovery and no old-generation operation is sent to the new transport

### Requirement: Binding capacity includes closed records

The workspace SHALL count all potentially attached current-generation runtimes and reserved pending creations against a limit of 16. Closing an idle tab MUST NOT falsely free a server-binding slot. New work beyond capacity SHALL be refused visibly until an eligible whole-connection reclamation or true disconnect removes closed records.

#### Scenario: Sixteenth binding then close
- **WHEN** sixteen runtimes have been associated and one tab is locally closed
- **THEN** opening a seventeenth unrelated runtime remains blocked because the closed record may still be subscribed

#### Scenario: Safe reclamation
- **WHEN** all tracked known sessions are idle with no requests or client/uncertain-submit transactions and the user invokes reclaim
- **THEN** the old socket is closed once and only visible needed sessions are reattached with their drafts preserved

#### Scenario: Reclamation while busy
- **WHEN** a session is running or waiting for a response
- **THEN** capacity recovery does not automatically close the whole socket to obtain a free slot

### Requirement: Retained data has explicit frontend budgets

The client SHALL enforce history count/estimated bytes, finite previews and image/draft budgets from design D9. Protected control requests and drafts SHALL not be silently discarded. LRU MUST NOT reconstruct unbounded histories from later background deltas. The client MUST distinguish retained-state limits from uncontrolled full RPC decoding peaks.

#### Scenario: History count or bytes exceeded
- **WHEN** a ninth full history is cached or total estimated history exceeds 64MiB
- **THEN** eligible histories are evicted, essential state remains, and background deltas do not rebuild the evicted full history

#### Scenario: Full legacy response
- **WHEN** a server returns a history larger than the local display window
- **THEN** the client trims retained display data and indicates the window, sends no unsupported limit parameters, and does not claim the network/decode peak was bounded

#### Scenario: Draft budget exceeded
- **WHEN** a new image would exceed the 100MiB File budget
- **THEN** new input is refused visibly and existing attachments are preserved

### Requirement: Only necessary views and polls run

Only the active body SHALL render full transcript/media. Background logs and cold full-state follow polling SHALL stop. Scroll/follow/cursor/expansion state SHALL remain session-specific. Snapshot-follow refresh SHALL be non-overlapping and at most once per second for the visible active conversation.

#### Scenario: Return to old history
- **WHEN** A is cached at an older scroll anchor and later selected again
- **THEN** its anchor, draft and expansion state are restored without forcing the latest message

#### Scenario: Log or follow view becomes hidden
- **WHEN** A's child log or running cold-follow view is hidden by selecting B
- **THEN** A's relevant polling stops and B is not queried for A's content

### Requirement: Departure and compatibility preserve scope

The workspace SHALL reuse the existing aggregate leave guard, dispose connection/listeners/timers/owned URLs after consent, and persist only scoped stored-session identities, their tab order and active identity, with the original last-ID key retained for compatibility. Unsupported deployed behavior SHALL use explicit compatibility rather than inventing capabilities, changing the server or silently using per-tab sockets.

#### Scenario: Leave cancelled
- **WHEN** a profile change would discard drafts and the user cancels
- **THEN** the workspace and all drafts remain usable

#### Scenario: Unsupported additive deployment
- **WHEN** real server behavior lacks additive session attachment
- **THEN** the client explains compatibility mode and does not promise simultaneous background streaming or require a server patch


### Requirement: In-app navigation retains the workspace

A profile-scoped owner above page routes SHALL lazily create the workspace on the first built-in Web Chat visit. Visiting Files, Logs or another in-app route SHALL preserve the single WS, tabs, bounded conversation data and in-memory text/image/view drafts. The chat body SHALL unmount while away; route-specific roster, tail and snapshot-follow polling SHALL pause. Profile replacement and actual application departure SHALL retain aggregate protection and resource cleanup; other editors' unsaved route guards MUST remain effective.

#### Scenario: Four tabs and a route round trip
- **WHEN** four tabs are open with a selected conversation, a draft image, text, an older scroll position and expanded reasoning, and the user visits Files then returns
- **THEN** the same tabs and selection return with their in-memory drafts/view state, no selection-driven connect/resume/activate/create occurs for valid cached conversations, and background events/requests remain usable

#### Scenario: Hidden route and profile guard
- **WHEN** the user leaves Web Chat with drafts and later attempts to replace the profile from another page
- **THEN** normal route departure required no discard, but profile replacement still requires consent and cancellation preserves the workspace; confirming disposes its socket and owned URLs

#### Scenario: Route-specific polling
- **WHEN** a cold running conversation's view is absent on another route
- **THEN** snapshot-follow, roster and tail do not issue periodic UI polling RPCs, while background event/request routing continues

### Requirement: Refresh restores tab identities without persisting conversation data

The client SHALL persist a versioned origin/base-path/profile-scoped list of stored-session IDs and an active stored ID. Reload SHALL reconstruct tab order and selection using existing resume with concurrency at most two. Invalid storage SHALL fall back to the prior last-ID behavior. Deleted or denied conversations SHALL remain locally retryable without an automatic replacement create. Draft text, Files, transcript bodies, request responders and secrets MUST NOT be persisted.

#### Scenario: Reload with one unavailable conversation
- **WHEN** a saved list contains four valid conversations and one deleted identity
- **THEN** one new logical WS restores available conversations in the recorded tab order, the recorded selection remains selected, and the unavailable tab shows a local error without blocking the others or creating a replacement

#### Scenario: Invalid or disabled storage
- **WHEN** the saved layout has an unsupported version, malformed JSON, invalid IDs or storage access is denied
- **THEN** layout restoration is skipped safely, legacy scoped last-ID restoration is used when available, and in-memory in-app navigation remains independent of storage

### Requirement: Display caches respect runtime and workspace ownership

Stored model identities SHALL be revalidated when a runtime or transport generation changes, including a warm replay. Unchanged snapshots and warm tab selection SHALL reuse valid metadata. History media SHALL use a workspace-owned profile/path cache bounded to 64 entries and an estimated 32MiB of encoded content, share concurrent reads, and cancel an unfinished read when its final observer leaves. Profile replacement and workspace disposal SHALL clear cached media and prevent old responses from repopulating it. Oversized media MAY be displayed without retention; the cache budget does not bound decoded pixels or response peaks.

#### Scenario: Runtime replacement updates the model label
- **WHEN** the same stored conversation is restored on a new runtime or transport with a different saved model
- **THEN** its saved model identity is read again, an old request cannot override it, and ordinary warm selections still avoid detail requests

#### Scenario: Cached media survives route departure
- **WHEN** a loaded history image is revisited through tab selection or an in-app route round trip
- **THEN** its existing scoped cache entry is reused without another media request; replacing the profile clears the old cache

#### Scenario: Media observers and limits
- **WHEN** two views request the same scoped image and one leaves
- **THEN** the request remains usable by the remaining observer, while the final departure cancels an unfinished request; unused cached entries are evicted by recency when either budget is exceeded

### Requirement: Data page reads and floating menus avoid obsolete work

Files navigation SHALL load once per explicit navigation/refresh and discard cancelled responses. Logs SHALL discard obsolete filter results, avoid overlapping automatic reads, pause new polling while hidden, and preserve a reader's scroll position until they return near the bottom. Floating menus SHALL ignore internal scroll events, coalesce external repositioning using animation frames, and cancel scheduled frames on close.

#### Scenario: A delayed directory or log response
- **WHEN** an older directory/filter request settles after a newer selection
- **THEN** it cannot replace the newer content, path, error or loading state

#### Scenario: A log reader scrolls upward during refresh
- **WHEN** auto-refresh completes while the reader is away from the bottom
- **THEN** their position is preserved; returning to the bottom enables following subsequent output

### Requirement: Streaming display remains stable across tools and compact snapshots

Replies, commentary and reasoning SHALL remain independent message rows when tools begin; only consecutive tool calls SHALL enter collapsible tool groups. An existing reasoning node MUST NOT remount when its first text arrives. Repeated in-flight snapshots SHALL reuse runtime/turn-scoped render identities while replacing text. Tool lifecycle MAY update during cold-follow, independently of untrusted assistant deltas. Previously received tool output MAY be retained only through a durable row identity or an unambiguous same-runtime call identity without known turn conflict; missing/reused IDs MUST NOT be guessed from names, arguments or body text. Pending calls absent from history SHALL survive only a matching confirmed running turn and remain within the existing transcript/cache budgets.

#### Scenario: Text after a collapsed tool group
- **WHEN** an assistant message streams after a collapsed tool group and another tool starts
- **THEN** the message remains visible in the same message node and the existing tool group stays collapsed

#### Scenario: Repeated compact snapshots
- **WHEN** running snapshots repeat with the same runtime and turn timestamp while omitting a known tool output
- **THEN** the in-flight message keeps its render ID, assistant text is replaced without duplication, and an identifiable tool keeps its output, duration and failure state

#### Scenario: Unidentifiable or conflicting tool rows
- **WHEN** a snapshot lacks call identity, contains duplicate call IDs or belongs to another conversation or conflicting turn
- **THEN** cached output is not attached by matching tool names or arguments; a pending tool from another running turn is not carried into the new snapshot
