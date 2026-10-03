// WNBACast live-stream bookkeeping. Pure (no DOM) so the seq contract is testable:
// since = last seq, merge by seq, never step a live stream backwards.

export const lastSeq = (events) => events.at(-1)?.seq ?? null;

// The response would step our stream backwards (an older provider snapshot).
export function isBackwards(events, incomingLastSeq) {
  return incomingLastSeq !== null && events.length > 0 && incomingLastSeq < events.at(-1).seq;
}

// Incremental (since given): merge by seq, incoming wins, ordered by seq.
// Full load (since undefined): the response is the whole stream.
export function mergeLiveEvents(events, incoming, since) {
  if (since === undefined) return incoming;
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  for (const e of incoming) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

// Identity of the provider state a poll returned. Equal keys and no new events
// means the poll saw nothing new: WNBACast must not repaint or invent activity.
export function liveSnapshotKey(data, meta) {
  const g = data?.game;
  return JSON.stringify([
    data?.last_seq ?? null,
    data?.events_total ?? null,
    g?.status ?? null,
    g?.away?.score ?? null,
    g?.home?.score ?? null,
    meta?.source_updated_at ?? null,
    meta?.freshness ?? null,
    (meta?.degraded || []).join('|')
  ]);
}
