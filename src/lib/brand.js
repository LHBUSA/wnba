/**
 * lib/brand.js — customer-facing data-source branding (network standard).
 * API provenance strings keep the upstream provider; UI copy shows PropSports.
 * Only the provider label is replaced: qualifiers such as "not the league's
 * official injury report" are kept verbatim.
 */
const PROVIDER_LABEL = /^ESPN injury feed \(provider\)\./;

export function customerSource(text) {
  return String(text || '').replace(PROVIDER_LABEL, 'PropSports injury feed (provider data).');
}
