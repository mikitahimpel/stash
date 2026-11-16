// What the web app learns about the `.xpi` it serves: whether Mozilla signed it. `package-xpi`
// writes it next to the file (`stash-extension.xpi` → `stash-extension.json`), and the Connect
// page's Zen guide reads it to show the install steps that work for that file.

/** The info file beside `xpi`. */
export const infoPath = (xpi: string): string => xpi.replace(/\.xpi$/, "") + ".json";

/** Its contents. */
export const infoJson = (signed: boolean): string => `${JSON.stringify({ signed })}\n`;
