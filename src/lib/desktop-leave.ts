import type { DraftState } from "@/contexts/unsaved-changes-context";

declare global {
  interface Window {
    __HERMES_DESKTOP_REQUEST_LEAVE__?: (id: string) => void;
    __HERMES_DESKTOP_CANCEL_LEAVE__?: (id: string) => void;
  }
}

interface LeaveHandler {
  readState: () => DraftState;
  confirm: (accept: () => void, reject: () => void) => void;
  cancel: () => void;
  approved: (value: boolean) => void;
}

/** Answers native-created requests only. This endpoint cannot initiate a native action. */
export function installDesktopLeaveHandler(handler: LeaveHandler) {
  if (!window.__HERMES_DESKTOP__) return () => {};
  let active: string | null = null;
  let approvedId: string | null = null;
  let disposed = false;
  const reply = async (id: string, decision: string) => {
    try {
      const response = await fetch("/__desktop/leave", {
        method: "POST", credentials: "same-origin", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: id, decision }),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  const finish = async (id: string, allow: boolean) => {
    if (active !== id || disposed) return;
    const busy = handler.readState().busy;
    const decision = busy ? "busy" : allow ? "allow" : "deny";
    // The native receiver can act before the HTTP response returns to this page.
    handler.approved(decision === "allow");
    approvedId = decision === "allow" ? id : null;
    active = null;
    if (!await reply(id, decision) && approvedId === id) {
      approvedId = null;
      handler.approved(false);
    }
  };
  const request = (id: string) => {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || active || disposed) return;
    active = id;
    approvedId = null;
    handler.approved(false);
    const state = handler.readState();
    if (state.busy || !state.dirty) { void finish(id, !state.busy); return; }
    void reply(id, "pending").then((ok) => {
      if (disposed || active !== id) return;
      if (!ok) { active = null; return; }
      handler.confirm(() => { void finish(id, true); }, () => { void finish(id, false); });
    });
  };
  const cancel = (id: string) => {
    if (active !== id && approvedId !== id) return;
    active = null;
    approvedId = null;
    handler.approved(false);
    handler.cancel();
  };
  window.__HERMES_DESKTOP_REQUEST_LEAVE__ = request;
  window.__HERMES_DESKTOP_CANCEL_LEAVE__ = cancel;
  return () => {
    disposed = true;
    if (active) void reply(active, "deny");
    if (window.__HERMES_DESKTOP_REQUEST_LEAVE__ === request) delete window.__HERMES_DESKTOP_REQUEST_LEAVE__;
    if (window.__HERMES_DESKTOP_CANCEL_LEAVE__ === cancel) delete window.__HERMES_DESKTOP_CANCEL_LEAVE__;
  };
}
