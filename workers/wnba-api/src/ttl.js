// Freshness windows (seconds). Live data is short; season aggregates are long.
// The live windows sit below WNBACast's ~5s poll so each tick can read the provider.
export const TTL = {
  scoreboardLive: 4,
  scoreboard: 60,
  summaryLive: 4,
  summaryFinal: 86400,
  summaryPre: 120,
  standings: 600,
  injuries: 300,
  roster: 3600,
  teams: 86400,
  athlete: 3600,
  leaders: 1800,
  schedule: 900,
  transactions: 300
};
