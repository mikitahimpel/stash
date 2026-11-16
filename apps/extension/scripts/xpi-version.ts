// Pure helpers of `package-xpi.ts`, kept free of Node APIs so the extension's tests cover them.

/**
 * A version for a signed build. AMO refuses a version it signed before, so each signing gets a
 * fresh one that also sorts after the last: `1.<YYYYMMDD>.<minute of the UTC day>`. Firefox
 * rejects leading zeros in version parts, which this never produces.
 */
export const signedVersion = (at: Date): string => {
  const day = at.getUTCFullYear() * 10_000 + (at.getUTCMonth() + 1) * 100 + at.getUTCDate();
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  return `1.${day}.${minute}`;
};

/** `manifest.json` text with its `version` replaced. */
export const withVersion = (manifest: string, version: string): string => {
  const parsed = JSON.parse(manifest) as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, version }, null, 2)}\n`;
};
