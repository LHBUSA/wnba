// Eastern-time calendar helpers. The WNBA publishes its slate in ET; "today"
// on PropBetEdge WNBA always means the America/New_York calendar date.

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function etDate(d = new Date()) {
  return fmt.format(d); // YYYY-MM-DD
}

export function etCompact(d = new Date()) {
  return etDate(d).replaceAll('-', '');
}

export function addDays(yyyymmdd, n) {
  const s = String(yyyymmdd).replaceAll('-', '');
  const t = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)) + n);
  const d = new Date(t);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function etHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(d)) % 24;
}

export function isCompactDate(s) {
  return /^\d{8}$/.test(String(s || ''));
}

export function gameEtDate(startUtc) {
  return startUtc ? etCompact(new Date(startUtc)) : null;
}

export function daysBetween(aIso, bIso) {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 86400000;
}
