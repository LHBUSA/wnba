/**
 * lib/brand.js — customer-facing data-source branding (network standard "DATA · PropSports").
 * The mapping lives in workers/shared/customer-brand.js so the SPA, wnba-web SSR, wnba-api and wnba-news
 * apply one rule. API provenance (/v1/sources, trust page, captures) keeps the upstream provider; UI copy and
 * public JSON show PropSports. Qualifiers such as "not the league's official injury report" are kept verbatim.
 */
export { customerSource, customerText, customerDoc, DATA_BRAND, DATA_LINE } from '../../workers/shared/customer-brand.js';
