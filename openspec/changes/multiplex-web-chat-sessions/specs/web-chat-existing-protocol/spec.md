## ADDED Requirements

### Requirement: Implementation stays inside the Web client

All implementation edits SHALL remain under web/. Server code/configuration, shared package source, desktop/TUI applications and generated RPC contracts MUST remain unchanged. Rust SHALL transparently forward the existing protocol and MUST NOT fabricate server features or acknowledgements.

#### Scenario: Planned scope review
- **WHEN** implementation files are enumerated
- **THEN** every modified file belongs to web/, no server deployment or protocol generation is required, and Rust changes have an existing lifecycle need

### Requirement: Existing identity and method shapes are used

The client SHALL use stored IDs with session.resume and runtime IDs with activate/events.since/session-scoped operations. It MUST use only existing method parameters and results, maintain local connection/session generations and not require a new remote capability version or attachment fencing field.

#### Scenario: Runtime expires
- **WHEN** activate reports runtime missing
- **THEN** recovery uses the known stored identity with resume instead of retrying the old runtime or requiring a new API

#### Scenario: New fields are absent
- **WHEN** the deployed backend returns existing results without snapshot cursor, detach token or multiplex version
- **THEN** their absence alone does not reject existing additive attachment, and no invented field is sent

### Requirement: Live replay owns its actual applied cursor

The Web connection wrapper SHALL disable the imported client's automatic replay using its existing constructor option, leaving the imported shared package unchanged. The Web workspace SHALL be the only recovery owner and SHALL apply actual received/replayed events in order. Missing epochs, sequence gaps or truncation MUST invalidate the claimed live projection.

#### Scenario: Simultaneous replay and live delivery
- **WHEN** a live event and replay carry the same sequence during recovery
- **THEN** the Web reducer applies it once and no second recovery owner appends it again

#### Scenario: Empty replay after restart
- **WHEN** server epoch changes while the old watermark is high
- **THEN** an empty event list is not treated as proof of complete recovery and the stored conversation uses conservative full recovery

### Requirement: Ordinary full-state responses have no invented cursor

The client MUST NOT combine an unrelated latest_seq with a resume/activate/history result and call it an atomic snapshot. Running cold recovery SHALL use replacement-based synchronized display and terminal/stable history calibration. The application SHALL disclose that live-valid replay and cold in-flight recovery provide different guarantees.

#### Scenario: Append precedes event stamp
- **WHEN** a full response includes text whose event is concurrently arriving without a shared snapshot boundary
- **THEN** recovery does not append that event blindly to the full response and does not claim exactly-once snapshot/delta joining

#### Scenario: Terminal calibration
- **WHEN** a cold-follow task finishes
- **THEN** full final message text replaces provisional output, existing APIs reconcile history, and unstable running responses remain visibly synchronizing

### Requirement: Closing uses no unsupported unsubscribe substitute

The client SHALL retain finite lightweight records for server attachments that cannot be individually removed. It MUST NOT call session.close or interrupt as ordinary local cache cleanup, and MUST NOT forge detach/snapshot methods through Rust. Whole-socket reclamation SHALL obey the design's idle/transaction safety conditions.

#### Scenario: Other window watches the same runtime
- **WHEN** this client closes its local page tab
- **THEN** it sends no operation ending the shared runtime and the other window is not intentionally stopped

#### Scenario: Confirmed connection cleanup
- **WHEN** safe idle connection reclamation occurs
- **THEN** old-generation records are removed locally and membership release follows the server's existing disconnect behavior

### Requirement: Deployment support is verified and errors stay visible

The client SHALL distinguish missing methods or demonstrated non-additive behavior from ordinary network/permission/build errors. Actual remote additive routing and return shapes SHALL be acceptance requirements; source inspection alone MUST NOT be reported as deployed support. Compatibility MUST NOT require a backend upgrade.

#### Scenario: Ordinary denied recovery
- **WHEN** a supported server rejects recovery for authorization or temporary build state
- **THEN** the correct error is shown rather than silently switching modes or resubmitting work

#### Scenario: Server has no incremental replay
- **WHEN** additive attachment is demonstrated but epoch/sequence/replay data is unavailable
- **THEN** continuous same-connection updates remain usable and real disconnections use explicitly conservative full recovery
