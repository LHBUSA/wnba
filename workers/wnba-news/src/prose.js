// Shared prose primitives for the WNBA newsroom synthesis generators and the reconcile checks.
// Deterministic and dependency-free so they can be unit-tested directly.

export const TZ = 'America/New_York';
export const dShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) : '');
export const dLong = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }) : '');
export const dMonth = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric' }) : '');
/** Calendar date in New York (YYYY-MM-DD). A 02:00Z tip on the 29th is a game on the 28th. */
export const etDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const tET = (iso) => (iso ? `${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET` : '');
export const f1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : null);
export const sgn = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.abs(v) < 0.05 ? 'even' : v > 0 ? `+${f1(v)}` : `${f1(v)}`);
export const am = (v) => (v === null || v === undefined ? null : v > 0 ? `+${v}` : `${v}`);
export const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
export const nick = (t) => t?.short_name || t?.name || t?.abbr || 'team';
export const full = (t) => t?.name || t?.short_name || 'team';
export const poss = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const wordN = (n) => NUMW[n] ?? String(n);
/** "3 players", "one player", "no players" — never "0 players". */
export const countOf = (n, w, pl = `${w}s`) => (n === 0 ? `no ${pl}` : `${n <= 10 ? wordN(n) : n} ${n === 1 ? w : pl}`);
export const plural = (n, w, pl = `${w}s`) => (n === 0 ? `no ${pl}` : `${n} ${n === 1 ? w : pl}`);
/** An averaged stat as prose: "no rebounds", "1 point", "4.2 rebounds". Never "0 rebounds" or "1 points". */
export const statAvg = (v, one, many = `${one}s`) => (!Number.isFinite(v) ? null : Math.abs(v) < 0.05 ? `no ${many}` : `${f1(v)} ${Math.abs(v - 1) < 0.05 ? one : many}`);
/** A game score: en dash, never a hyphen (a hyphenated "108-100" reads as a price to gate.js). */
export const sc = (a, b) => `${a}–${b}`;
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
/** Whole calendar days between two instants, both read as New York dates. */
export const etDays = (a, b) => Math.round((Date.parse(etDate(b)) - Date.parse(etDate(a))) / 86400e3);

/**
 * Indefinite article for a spoken number: "an 8.5-point", "an 11-point", "an 18-game", "an 80-", "a 7-point",
 * "a 1.5-point", "a 110-". English uses "an" when the number is SAID with a leading vowel sound:
 * eight / eighty / eight hundred …, eleven, eighteen (and eleven/eighteen hundred …).
 */
export function aan(n) {
  const s = String(n).trim().replace(/,/g, '');
  if (/^[+\-−]/.test(s)) return 'a'; // "a +0.1 margin", "a −8.9 differential" — spoken "plus"/"minus"
  const ip = s.split('.')[0];
  if (!/^\d+$/.test(ip)) return 'a';
  if (ip.startsWith('8')) return 'an';
  if (ip === '11' || ip === '18') return 'an';
  if (ip.length === 4 && (ip.startsWith('11') || ip.startsWith('18'))) return 'an'; // eleven hundred, eighteen hundred
  if ((ip.length === 5 || ip.length === 8) && (ip.startsWith('11') || ip.startsWith('18'))) return 'an'; // eleven thousand …
  return 'a';
}

/** Clock text from a play-by-play marker: "Q2 47.2" -> "0:47", "Q2 3:46" -> "3:46". */
export function clockOf(marker) {
  const m = String(marker || '').match(/^(Q\d|OT\d?)\s+(.+)$/);
  const c = m ? m[2] : String(marker || '');
  if (/^\d+(\.\d+)?$/.test(c)) return `0:${String(Math.floor(Number(c))).padStart(2, '0')}`;
  return c;
}
export function periodOf(marker) {
  const m = String(marker || '').match(/^Q(\d)/);
  return m ? Number(m[1]) : null;
}
export const QUARTER = ['', 'first', 'second', 'third', 'fourth'];
