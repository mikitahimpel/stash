// Where a sign-in returns to. Only a path on the web origin counts: `/settings`, or the MCP
// sign-in's `/authorize/session?state=…`. Anything else (`//host`, `https://…`, a backslash that a
// browser reads as a slash, control characters) is the start page, so no sign-in can be made to
// send someone to another site.

/** The path itself when it is safe, else `/`. */
export const sanitize = (value: string | undefined): string => {
  if (value === undefined || value === "" || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // oxlint-disable-next-line no-control-regex -- control characters are what is refused here
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    // Resolving against a placeholder origin must keep it: then the path cannot leave the site.
    const url = new URL(value, "https://origin.invalid");
    return url.origin === "https://origin.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
};

/** `path` with `name=value` added to its query, before any `#hash`. */
export const withParam = (path: string, name: string, value: string): string => {
  const url = new URL(path, "https://origin.invalid");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
};
