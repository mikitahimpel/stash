/**
 * A short check value of a pairing code: its first four characters. The approve page and the
 * extension's settings both show it, so the owner can tell their own extension's request from one
 * another page started. The extension keeps its own copy of this rule (contexts share no logic).
 */
export const checkValue = (code: string): string => code.slice(0, 4);
