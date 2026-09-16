// Public boundary for the WNBA News Brief engine.
//
// The current taxonomy prevents new commentary/profile coverage from becoming
// standalone PropBetEdge stories. Published briefs, however, are historical
// newsroom records and must not be retroactively unlisted merely because the
// taxonomy later becomes stricter. Keep the audited generator version stable so
// existing coverage reviews are not invalidated as a migration side effect.

export * from './briefs-core.js';
