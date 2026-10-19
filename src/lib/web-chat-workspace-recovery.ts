import { JsonRpcGatewayError, type GatewayEvent, type SessionActivateResult, type SessionEventsSinceResult, type SessionResumeResult } from "@hermes/shared";
import type { GatewayClient } from "./gatewayClient";
import type { WebChatController } from "./web-chat-controller";
import type { WebChatSessionTransport } from "./web-chat-session";
import { CHAT_LIMITS, ChatEventBuffer } from "./web-chat-cache";

export interface SessionBinding {
  id: string;
  connectionGeneration: number;
  controller: WebChatController;
  transport: WebChatSessionTransport;
  visible: boolean;
  pendingOpen: boolean;
  lastUsed: number;
  projection: "live-valid" | "refresh-required" | "snapshot-follow";
  appliedSeq: number;
  epoch: string | null;
  held: ChatEventBuffer | null;
  preview: string;
  unread: boolean;
  title: string | null;
  syncing: Promise<void> | null;
  calibration: number;
  settledBaseline: boolean;
  unsubscribe: () => void;
}

export function reduceSessionEvent(binding: SessionBinding, event: GatewayEvent) {
  if (typeof event.seq === "number") {
    if (event.seq <= binding.appliedSeq && binding.epoch === event.replayEpoch) return;
    if (binding.projection === "live-valid" && ((binding.epoch && event.replayEpoch && binding.epoch !== event.replayEpoch) || (binding.appliedSeq && event.seq !== binding.appliedSeq + 1))) {
      binding.projection = "snapshot-follow"; binding.settledBaseline = false; binding.calibration = 3;
    }
    binding.epoch = event.replayEpoch ?? binding.epoch;
  } else if (binding.projection === "live-valid") {
    // Streaming still works on legacy peers; the projection cannot support seq replay.
    binding.epoch = null;
  }
  const state = binding.controller.getSnapshot();
  const bodyEvent = ["message.delta", "reasoning.delta", "reasoning.available", "message.interim", "tool.start", "tool.complete"].includes(event.type);
  const cold = binding.projection !== "live-valid";
  if (cold && bodyEvent) {
    const payload = event.payload as { text?: string } | undefined;
    if ((binding.visible || binding.pendingOpen) && payload?.text) binding.preview = (binding.preview + payload.text).slice(-CHAT_LIMITS.previewBytes / 2);
    if (event.type === "tool.start" || event.type === "tool.complete") {
      if (binding.visible || binding.pendingOpen) binding.controller.applyToolEvent(event as GatewayEvent<"tool.start"> | GatewayEvent<"tool.complete">, true);
    }
    // ID-addressed tool lifecycle is independent of the untrusted text snapshot.
  } else {
    if (event.type === "message.start" && !state.busy && binding.projection === "snapshot-follow" && binding.calibration === 0 && binding.settledBaseline)
      binding.projection = "live-valid";
    if (event.type === "message.complete" && !binding.visible && !state.messages.length) {
      const payload = (event as GatewayEvent<"message.complete">).payload;
      binding.controller.patchState({ busy: false, stopping: false,
        error: payload?.error ?? (payload?.status === "error" ? payload.failure_reason ?? "Hermes could not complete this turn." : null),
        notice: payload?.warning ?? null });
    } else {
      if (cold && event.type === "message.complete") binding.controller.prepareFinalReplacement();
      binding.transport.event(event);
    }
  }
  if (typeof event.seq === "number") binding.appliedSeq = event.seq;
  if (event.type === "message.complete") { binding.calibration = cold ? 3 : 0; binding.unread = true; }
  if (event.type === "message.start") binding.unread = true;
}

export async function recoverBinding(binding: SessionBinding, client: GatewayClient, profile: string, epoch: string | null,
  current: () => boolean, deliverHeld: () => void, coldOnly = false, compatibility = false, onActivateUnavailable?: () => void, onReplayUnavailable?: () => void): Promise<void> {
  if (binding.syncing) return binding.syncing;
  const run = async () => {
    const controller = binding.controller;
    const before = controller.getSnapshot();
    if (!before.sessionId || !before.storedSessionId) return;
    const params = { session_id: before.sessionId, profile: profile || undefined };
    const warm = !compatibility && !coldOnly && binding.projection === "live-valid" && !!epoch && epoch === binding.epoch && binding.appliedSeq > 0;
    binding.held = new ChatEventBuffer();
    controller.patchState({ loading: !coldOnly || !before.messages.length, error: null });
    try {
      let snapshot: SessionActivateResult | SessionResumeResult;
      try {
        if (compatibility || (!coldOnly && !!epoch && !!binding.epoch && epoch !== binding.epoch)) snapshot = await client.request<SessionResumeResult>("session.resume", { session_id: before.storedSessionId, profile: profile || undefined, source: "gui", close_on_disconnect: false }, 15_000);
        else snapshot = await client.request<SessionActivateResult>("session.activate", { ...params, omit_messages: warm }, 15_000); }
      catch (error) {
        if (!(error instanceof JsonRpcGatewayError) || (error.code !== 4007 && error.code !== -32601)) throw error;
        if (error.code === -32601) onActivateUnavailable?.();
        snapshot = await client.request<SessionResumeResult>("session.resume", { session_id: before.storedSessionId,
          profile: profile || undefined, source: "gui", close_on_disconnect: false }, 15_000);
      }
      if (!current()) return;
      await controller.clearImageQueue(snapshot.session_id, snapshot.stored_session_id ?? before.storedSessionId);
      if (!current()) return;
      let replayValid = false;
      if (warm && snapshot.session_id === before.sessionId && snapshot.messages_omitted) {
        try {
          const replay = await client.request<SessionEventsSinceResult>("session.events.since", { ...params, last_seen: binding.appliedSeq }, 10_000);
          if (!current()) return;
          const frames = [...replay.events as unknown as GatewayEvent[], ...binding.held!.items]
            .filter(event => event.session_id === before.sessionId).sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
          let seq = binding.appliedSeq;
          replayValid = binding.projection === "live-valid" && replay.epoch === epoch && replay.truncated === false && typeof replay.latest_seq === "number";
          for (const frame of frames) {
            if (typeof frame.seq !== "number") { replayValid = false; break; }
            if (frame.seq <= seq) continue;
            if (frame.seq !== seq + 1) { replayValid = false; break; }
            seq = frame.seq;
          }
          if (replayValid && seq < replay.latest_seq) replayValid = false;
          if (replayValid) {
            for (const frame of frames) reduceSessionEvent(binding, { ...frame, replayEpoch: epoch! });
            const ids = new Set(replay.open_requests.map(request => request.id));
            controller.patchState({ requests: controller.getSnapshot().requests.filter(request => ids.has(request.id)) });
          }
        } catch (error) {
          if (!(error instanceof JsonRpcGatewayError) || error.code !== -32601) throw error;
          onReplayUnavailable?.();
        }
      }
      if (!replayValid) {
        if (snapshot.messages_omitted) snapshot = await client.request<SessionActivateResult>("session.activate", { ...params, omit_messages: false }, 15_000);
        if (!current()) return;
        binding.projection = "snapshot-follow";
        binding.appliedSeq = 0;
        binding.epoch = epoch;
        controller.restoreSnapshot(snapshot);
        binding.calibration = controller.getSnapshot().busy ? 3 : 0;
        binding.preview = "";
        binding.settledBaseline = !controller.getSnapshot().busy && !controller.getSnapshot().historyTruncated && !binding.held?.items.some(event => ["message.start", "message.delta", "message.complete"].includes(event.type));
      } else controller.patchState({ loading: false });
      // A warm replay can retain its runtime ID across a new transport generation.
      void controller.refreshSessionModel();
      // Replies replay requests before resolving. Mapping is updated before the held delivery.
      deliverHeld();
    } catch (error) {
      if (current()) controller.patchState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      const held = binding.held; binding.held = null;
      if (current() && held) for (const event of held.drain()) {
        if (event.session_id === controller.getSnapshot().sessionId) reduceSessionEvent(binding, event);
      }
      if (current()) controller.patchState({ loading: false });
    }
  };
  binding.syncing = run().finally(() => { binding.syncing = null; });
  return binding.syncing;
}

export function holdEvent(binding: SessionBinding, event: GatewayEvent, availableBytes = CHAT_LIMITS.bufferBytes) {
  if (!binding.held) return false;
  if (!binding.held.push(event, availableBytes)) {
    binding.projection = "refresh-required"; binding.settledBaseline = false; binding.held.clear();
  }
  return true;
}
