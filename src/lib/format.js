const TZ = 'America/New_York';

export function fmtTimeET(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) + ' ET';
}
export function fmtDateET(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, ...opts });
}
export function fmtDateTimeET(iso) {
  if (!iso) return '—';
  return `${fmtDateET(iso, { month: 'short', day: 'numeric' })}, ${fmtTimeET(iso)}`;
}
export function compactToIso(yyyymmdd) {
  if (!yyyymmdd) return null;
  const s = String(yyyymmdd).replaceAll('-', '');
  // noon ET avoids any date roll when formatting in ET
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T16:00:00Z`;
}
export function fmtCompactDate(yyyymmdd, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return fmtDateET(compactToIso(yyyymmdd), opts);
}
export function american(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Math.round(Number(v));
  return n > 0 ? `+${n}` : String(n);
}
export function signed(v, d = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(d)}`;
}
export function num(v, d = 1) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(d);
}
export function pct(v, d = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${(n <= 1 ? n * 100 : n).toFixed(d)}%`;
}
export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
export function relTime(iso) {
  if (!iso) return '—';
  const d = Date.now() - Date.parse(iso);
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 14) return `${days}d ago`;
  return fmtDateET(iso, { month: 'short', day: 'numeric' });
}
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
export const BOOKS = { draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', betrivers: 'BetRivers', fanatics: 'Fanatics', bovada: 'Bovada', williamhill_us: 'Caesars', lowvig: 'LowVig', betonlineag: 'BetOnline', mybookieag: 'MyBookie', espnbet: 'ESPN BET', ballybet: 'Bally Bet', hardrockbet: 'Hard Rock' };
export const bookName = (k) => BOOKS[k] || k;
