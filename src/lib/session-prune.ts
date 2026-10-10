interface SessionPruneResult {
  removed: number
  skipped_open: number
}

export interface SessionPruneMessages {
  pruned: string
  skippedOpen: string
}

const ENGLISH_PRUNE_MESSAGES: SessionPruneMessages = {
  pruned: 'Pruned sessions: {count}.',
  skippedOpen: 'Skipped open sessions: {count}; only ended sessions are pruned.'
}

export function formatSessionPruneResult(
  result: SessionPruneResult,
  messages: SessionPruneMessages = ENGLISH_PRUNE_MESSAGES
): string {
  const removed = messages.pruned.replace('{count}', String(result.removed))
  if (!result.skipped_open) return removed

  return `${removed} ${messages.skippedOpen.replace('{count}', String(result.skipped_open))}`
}
