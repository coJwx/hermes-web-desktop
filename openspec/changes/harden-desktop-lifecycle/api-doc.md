# Desktop leave reply (local bridge only)

## POST /__desktop/leave
Implementation: src-tauri/src/bridge.rs::reply_leave; src-tauri/src/leave_gate.rs.

Authorization: existing random HttpOnly bridge Cookie, exact Host, same Origin and Fetch Metadata guard. Maximum JSON body: 1024 bytes. No new native capability.

Request: {"request_id":"<native-generated UUID>","decision":"pending|allow|deny|busy|unsupported"}. Unknown fields or malformed values are rejected. "checking" is internal and cannot be accepted as a reply.

Responses: 204 accepted; 409 stale/unknown/already-completed request; 401 missing bridge session; 403 hostile origin/host; 413 oversized payload; framework JSON validation errors for malformed payloads.

Only one active request per bridge. Pending acknowledges that a confirmation is visible; it does not authorize anything. A terminal reply is one-use. Native cancellation expires the ID. Browser content cannot use this endpoint to choose a native action or initiate one.

The renderer adapter is installed only when the desktop bootstrap flag is present. Ordinary browser deployments do not send these requests. Existing backend APIs and session formats are unchanged.
