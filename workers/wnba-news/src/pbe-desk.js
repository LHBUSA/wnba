// PropBetEdge WNBA Desk — owned, automated stories.
//
// Written ONLY from structured records served by wnba-api (ESPN box scores,
// the injury change ledger recorded by wnba-ingest, ESPN transactions, ESPN
// standings). Every sentence maps to a field in the cited evidence. No quotes
// are invented, no outcomes predicted, no return dates estimated.
// A quiet day produces no stories — volume is never manufactured.

export const DESK_VERSION = 'pbe-desk/1.0.0';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : null);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : null);

async function sid(parts) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return 'pbe_' + [...new Uint8Array(buf)].slice(0, 9).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ENT = (type, id, name) => ({ type, id: String(id), name, method: 'source_record' });

// ------------------------------------------------------------ availability

export async function availabilityStories(ledger, teamsById) {
  const out = [];
  const serious = /^(out|out for season|doubtful|suspension)/i;
  for (const c of ledger || []) {
    if (!c.athlete_id || !c.name) continue;
    const team = teamsById.get(String(c.team_id));
    const teamName = team?.name || 'their team';
    let headline = null;
    let lines = [];
    const reported = c.detail_after?.short_comment ? `ESPN’s injury note reads: “${c.detail_after.short_comment}”` : null;
    const part = [c.detail_after?.side, c.detail_after?.body_part].filter(Boolean).join(' ').toLowerCase() || null;
    if (c.change_kind === 'status_changed' && (serious.test(c.status_after || '') || serious.test(c.status_before || ''))) {
      headline = `${c.name} (${team?.abbr || ''}) moves from ${c.status_before} to ${c.status_after}`.replace(' ()', '');
      lines.push(`ESPN’s WNBA injury feed changed ${c.name}’s status from ${c.status_before} to ${c.status_after}; PropBetEdge recorded the change at ${fmtTime(c.captured_at)}.`);
    } else if (c.change_kind === 'added' && serious.test(c.status_after || '')) {
      headline = `${c.name} (${team?.abbr || ''}) listed ${c.status_after}${part ? ` — ${part}` : ''}`.replace(' ()', '');
      lines.push(`${c.name} of the ${teamName} appeared on ESPN’s WNBA injury feed as ${c.status_after}${part ? ` (${part})` : ''}; PropBetEdge recorded it at ${fmtTime(c.captured_at)}.`);
    } else if (c.change_kind === 'removed' && serious.test(c.status_before || '')) {
      headline = `${c.name} (${team?.abbr || ''}) no longer on the injury feed`.replace(' ()', '');
      lines.push(`${c.name} was listed ${c.status_before} and no longer appears on ESPN’s WNBA injury feed as of ${fmtTime(c.captured_at)}. Removal from the feed is not an official clearance.`);
    } else continue;
    if (reported && c.change_kind !== 'removed') lines.push(reported);
    if (c.detail_after?.source_return_date) lines.push(`The feed lists an expected return date of ${fmtDate(c.detail_after.source_return_date)}. That date is ESPN’s, not a PropBetEdge estimate.`);
    lines.push('Status is sourced from ESPN’s injury feed, not the league’s official injury report.');
    out.push({
      story_id: await sid(['availability', c.athlete_id, c.change_kind, c.status_after || 'none', c.captured_at]),
      kind: 'availability_change',
      headline,
      body: lines.join('\n\n'),
      entities: [ENT('player', c.athlete_id, c.name), ...(team ? [ENT('team', team.team_id, team.name)] : [])],
      evidence: [{ source: 'espn_injuries_feed via wnba-ingest change ledger', record: { change_kind: c.change_kind, status_before: c.status_before, status_after: c.status_after, source_updated_at: c.source_updated_at }, url: 'https://www.espn.com/wnba/injuries', captured_at: c.captured_at }],
      published_at: c.captured_at
    });
  }
  return out;
}

// ------------------------------------------------------------ transactions

export async function transactionStories(items, sinceIso) {
  const byTeamDay = new Map();
  for (const t of items || []) {
    if (!t.team?.team_id || !t.date || !t.description) continue;
    if (sinceIso && t.date < sinceIso) continue;
    const k = `${t.team.team_id}|${t.date.slice(0, 10)}`;
    if (!byTeamDay.has(k)) byTeamDay.set(k, { team: t.team, date: t.date, moves: [] });
    byTeamDay.get(k).moves.push(t.description);
  }
  const out = [];
  for (const g of byTeamDay.values()) {
    out.push({
      story_id: await sid(['transaction', g.team.team_id, g.date.slice(0, 10), g.moves.join('||')]),
      kind: 'transaction',
      headline: `${g.team.name} roster move${g.moves.length > 1 ? 's' : ''}, ${fmtDate(g.date)}`,
      body: [`The ${g.team.name} made ${g.moves.length === 1 ? 'one roster move' : `${g.moves.length} roster moves`} dated ${fmtDate(g.date)}, per ESPN’s WNBA transactions log:`, ...g.moves.map((m) => `• ${m}`)].join('\n\n'),
      entities: [ENT('team', g.team.team_id, g.team.name)],
      evidence: [{ source: 'espn_transactions', record: { team_id: g.team.team_id, date: g.date, moves: g.moves }, url: 'https://www.espn.com/wnba/transactions', captured_at: new Date().toISOString() }],
      published_at: g.date
    });
  }
  return out;
}

// ------------------------------------------------------------ results

function lineOf(r) {
  const parts = [`${r.pts} points`];
  if (r.fgm !== null && r.fga !== null) parts[0] += ` (${r.fgm}-${r.fga} FG)`;
  if (r.reb >= 10) parts.push(`${r.reb} rebounds`);
  if (r.ast >= 8) parts.push(`${r.ast} assists`);
  return `${parts.join(', ')} in ${r.min} minutes`;
}

/** A final earns a Desk story only when something notable is in the box score. */
export async function resultStory(live) {
  const g = live?.game;
  if (!g || g.status?.state !== 'post' || !g.status?.completed) return null;
  const box = live.box?.players || [];
  const notable = box.filter((r) => (r.pts ?? 0) >= 30 || (r.reb ?? 0) >= 15 || (r.ast ?? 0) >= 12 || ((r.pts ?? 0) >= 10 && (r.reb ?? 0) >= 10 && (r.ast ?? 0) >= 10));
  const ot = (g.home?.linescores?.length || 0) > 4;
  const lead = live.derived?.lead;
  const winner = g.home?.winner ? g.home : g.away;
  const loser = g.home?.winner ? g.away : g.home;
  const loserSide = loser === g.home ? 'home' : 'away';
  const comeback = lead?.largest_lead?.[loserSide]?.margin >= 15;
  if (!notable.length && !ot && !comeback) return null;

  const top = [...notable].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0] || [...box].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0];
  const headline = `${winner.short_name} ${winner.score}, ${loser.short_name} ${loser.score}${ot ? ' (OT)' : ''}${top ? `: ${top.name} ${top.pts}${(top.reb ?? 0) >= 10 ? `-${top.reb}` : ''}` : ''}`;
  const lines = [`The ${winner.name} beat the ${loser.name} ${winner.score}–${loser.score}${ot ? ` in ${g.home.linescores.length - 4 === 1 ? 'overtime' : `${g.home.linescores.length - 4} overtimes`}` : ''} on ${fmtDate(g.start_utc)}${g.venue?.name ? ` at ${g.venue.name}` : ''}.`];
  for (const r of notable.slice(0, 3)) {
    const team = r.team_id === g.home?.team_id ? g.home : g.away;
    lines.push(`${r.name} (${team?.abbr}) finished with ${lineOf(r)}.`);
  }
  if (comeback) lines.push(`The ${loser.name} led by as many as ${lead.largest_lead[loserSide].margin} and lost.`);
  if (lead) lines.push(`Lead changes: ${lead.lead_changes}. Ties: ${lead.ties}.`);
  const run = live.derived?.runs?.largest;
  if (run) {
    const best = Object.values(run).sort((a, b) => b.points - a.points)[0];
    if (best && best.points >= 10) {
      const t = best.team_id === g.home?.team_id ? g.home : g.away;
      lines.push(`Largest unanswered run: ${t?.abbr} ${best.points}–0 (${best.from} to ${best.to}).`);
    }
  }
  lines.push('All figures from the ESPN box score and play-by-play; runs and lead changes are computed by PropBetEdge from the published event stream.');
  return {
    story_id: await sid(['result', g.game_id]),
    kind: 'result',
    headline,
    body: lines.join('\n\n'),
    entities: [ENT('game', g.game_id, `${g.away?.abbr} @ ${g.home?.abbr}`), ENT('team', g.home.team_id, g.home.name), ENT('team', g.away.team_id, g.away.name), ...notable.slice(0, 3).map((r) => ENT('player', r.athlete_id, r.name))],
    evidence: [{ source: 'espn_summary via wnba-api', record: { game_id: g.game_id, final: `${g.away?.abbr} ${g.away?.score} – ${g.home?.abbr} ${g.home?.score}`, events: live.events_total }, url: `https://www.espn.com/wnba/game/_/gameId/${g.game_id}`, captured_at: new Date().toISOString() }],
    published_at: g.last_play_wallclock || g.start_utc
  };
}

// ------------------------------------------------------------ standings

const CLINCH = { x: 'clinched a playoff berth', e: 'been eliminated from playoff contention', o: 'been eliminated from playoff contention' };

export async function clinchStories(standings, previousMarks) {
  const out = [];
  const marks = {};
  for (const g of standings?.groups || []) {
    for (const e of g.entries) {
      marks[e.team_id] = e.clincher || null;
      const before = previousMarks?.[e.team_id] ?? null;
      const now = e.clincher || null;
      if (!previousMarks || !now || now === before || !CLINCH[now]) continue;
      out.push({
        story_id: await sid(['clinch', standings.season?.year, e.team_id, now]),
        kind: 'clinch',
        headline: `${e.name} have ${CLINCH[now]}`,
        body: [`ESPN’s ${standings.season?.label || 'WNBA'} standings now mark the ${e.name} (${e.wins}-${e.losses}) “${now}”: they have ${CLINCH[now]}.`, `Current position: ${g.name}, seed ${e.seed ?? '—'}, ${e.games_behind === '-' ? 'leading' : `${e.games_behind} games back`}.`].join('\n\n'),
        entities: [ENT('team', e.team_id, e.name)],
        evidence: [{ source: 'espn_standings via wnba-api', record: { team_id: e.team_id, clincher_before: before, clincher_now: now, wins: e.wins, losses: e.losses }, url: 'https://www.espn.com/wnba/standings', captured_at: new Date().toISOString() }],
        published_at: new Date().toISOString()
      });
    }
  }
  return { stories: out, marks };
}
