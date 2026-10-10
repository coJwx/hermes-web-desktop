## ADDED Requirements

### Requirement: Transport preserves closure and terminates abandoned work
The bridge SHALL preserve valid WebSocket close codes and reasons in both directions, bound idle HTTP reads and cancel old HTTP/WebSocket work on shutdown without imposing a short total deadline on active streams.
#### Scenario: Auth-expired closure
- **WHEN** the backend closes with 4401 and a reason
- **THEN** the client receives the same close metadata
#### Scenario: Bridge replacement during pending HTTP
- **WHEN** an old bridge is dropped while awaiting headers or body data
- **THEN** its requests terminate and cannot update the active connection

### Requirement: Native lifecycle respects editing state
Native close, reload and backend switching SHALL require a correlated response from the current page, reject busy state and preserve user cancellation. The response endpoint MUST NOT grant general native capabilities.
#### Scenario: Dirty editor
- **WHEN** a native action is requested with unsaved edits
- **THEN** cancelling preserves the page and accepting authorizes only that outstanding action
#### Scenario: Missing response or stale reply
- **WHEN** the page is unavailable or a stale request ID is submitted
- **THEN** no action is implicitly authorized; timeout requires explicit native confirmation and stale replies are rejected

### Requirement: Connection replacement is recoverable
Connection settings SHALL be committed atomically only after candidate preflight and window creation succeed; failure SHALL retain or recreate the previous connection.
#### Scenario: Non-Hermes server or failed candidate window
- **WHEN** a server returns unrelated HTML or candidate creation/persistence fails
- **THEN** the old saved address remains and the old connection is retained or rollback failure is visibly reported

### Requirement: Local storage remains safe and diagnosable
Only one client SHALL own a selected data directory. Non-secret preference corruption SHALL preserve the original and permit default operation; credentials MUST remain fail-closed. Local diagnostics SHALL be bounded and contain no credentials or payloads.
#### Scenario: Corrupt preferences
- **WHEN** non-secret preferences cannot be parsed or validated
- **THEN** defaults are used with a visible warning and a backup, or read-only defaults if preservation is impossible
#### Scenario: Duplicate client
- **WHEN** another process already owns the same storage directory
- **THEN** startup is refused without modifying saved settings or sessions

### Requirement: Bundled native surfaces validate their full identity
Connection commands and navigation SHALL validate the exact bundled origin, path and window label as titlebar/about do.
#### Scenario: Same label at an untrusted URL
- **WHEN** a command comes from the expected label but a remote or unexpected local URL
- **THEN** it is rejected
