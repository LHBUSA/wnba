// Pure identity + image-verification rules for the photo providers (used by s11_provider_ids.mjs and
// the coverage audit; unit-tested in tests/photo-mapping.test.mjs). No I/O here.

export const WNBA_CDN = {
  full: (id) => `https://cdn.wnba.com/headshots/wnba/latest/1040x760/${encodeURIComponent(id)}.png`,
  square: (id) => `https://cdn.wnba.com/headshots/wnba/latest/260x190/${encodeURIComponent(id)}.png`
};
export const ESPN_FULL = (id) => `https://a.espncdn.com/i/headshots/wnba/players/full/${id}.png`;
export const ESPN_SQUARE = (id) => `https://a.espncdn.com/combiner/i?img=/i/headshots/wnba/players/full/${id}.png&w=350&h=254`;

/** Exact-match key: diacritics folded, case folded, punctuation dropped, whitespace collapsed. No fuzzy matching. */
export function normName(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`‐-―-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** name key -> [person] over primary names and aliases (each person once per key). */
export function indexWikidataPeople(people = []) {
  const idx = new Map();
  for (const p of people) {
    for (const k of new Set([p.primary_full_name, ...(p.aliases || [])].map(normName).filter(Boolean))) {
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(p);
    }
  }
  return idx;
}

/**
 * One ESPN athlete -> { outcome: mapped|ambiguous|rejected, reason, wnba_id, evidence }.
 * `espn`: { id, fullName, displayName, dob }; `roster_dob`: DOB from the live roster (cross-check);
 * `ledger`: the Commons ledger entry (its own name+DOB Wikidata match) or null.
 */
export function decideWnbaId({ espn, roster_dob = null, ledger = null, index }) {
  const out = (outcome, reason, extra = {}) => ({ espn_id: String(espn?.id ?? ''), outcome, reason, wnba_id: null, ...extra });
  if (!espn?.id) return out('rejected', 'no_espn_athlete_record');
  const dob = espn.dob || null;
  if (dob && roster_dob && roster_dob !== dob) return out('ambiguous', 'espn_dob_disagrees_with_roster_dob', { evidence: { dob, roster_dob } });
  if (!dob) return out('ambiguous', 'no_espn_dob');
  const keys = [...new Set([espn.fullName, espn.displayName].map(normName).filter(Boolean))];
  const byName = new Map();
  for (const k of keys) for (const p of index.get(k) || []) byName.set(p.wikidata_qid, p);
  const named = [...byName.values()];
  if (!named.length) return out('rejected', 'no_wikidata_person_with_exact_name', { evidence: { names: keys, dob } });
  const exact = named.filter((p) => p.birth_date_precision === 'day' && p.birth_date === dob);
  if (!exact.length) return out('rejected', 'wikidata_name_match_but_dob_differs', { evidence: { names: keys, dob, candidates: named.map((p) => ({ qid: p.wikidata_qid, dob: p.birth_date, precision: p.birth_date_precision })) } });
  if (exact.length > 1) return out('ambiguous', 'multiple_wikidata_people_same_name_and_dob', { evidence: { qids: exact.map((p) => p.wikidata_qid) } });
  const p = exact[0];
  const p3588 = [...new Set(p.external_ids?.P3588 || (p.wnba_com_id ? [p.wnba_com_id] : []))];
  if (p3588.length !== 1 || !/^\d+$/.test(p3588[0])) return out('ambiguous', 'wikidata_p3588_not_single_numeric', { evidence: { qid: p.wikidata_qid, p3588 } });
  const w = p3588[0];
  if (ledger?.wnba_com_id && String(ledger.wnba_com_id) !== w) return out('rejected', 'conflicts_with_commons_ledger_wnba_id', { evidence: { qid: p.wikidata_qid, wikidata: w, ledger: ledger.wnba_com_id } });
  if (ledger?.wikidata_qid && ledger.wikidata_qid !== p.wikidata_qid) return out('rejected', 'conflicts_with_commons_ledger_qid', { evidence: { qid: p.wikidata_qid, ledger: ledger.wikidata_qid } });
  return {
    espn_id: String(espn.id), outcome: 'mapped', reason: 'exact_name_and_dob', wnba_id: w,
    evidence: { qid: p.wikidata_qid, name: p.primary_full_name, dob, name_keys: keys, ledger_agrees: ledger?.wnba_com_id ? true : null }
  };
}

/** Width/height from PNG, WebP or JPEG bytes, else null. */
export function imageDims(b) {
  if (!b || b.length < 30) return null;
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {
    const t = b.slice(12, 16).toString();
    if (t === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (t === 'VP8L') { const n = b.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; }
    if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Why a probed image is not a usable headshot, or '' when it is. `r`: { status, mime, bytes, sha256, dims }.
 * `expect`: exact [w, h]; `silhouette`: the provider's generic image probed from a missing id.
 */
export function isPlaceholder(r, { expect = null, silhouette = null, minBytes = 2000 } = {}) {
  if (!r || r.status !== 200) return `http_${r?.status ?? 0}`;
  if (!/^image\/(png|jpeg|webp)/.test(r.mime || '')) return 'not_image';
  if (!r.dims) return 'unreadable';
  if (silhouette?.sha256 && r.sha256 === silhouette.sha256) return 'silhouette';
  if (expect && (r.dims[0] !== expect[0] || r.dims[1] !== expect[1])) return `dims_${r.dims.join('x')}`;
  if (r.bytes < minBytes) return 'too_small';
  return '';
}
