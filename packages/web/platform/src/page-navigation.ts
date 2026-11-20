/**
 * Leaves the app for `url` with a full page load: a server route on this host (the Google
 * sign-in, the MCP sign-in's return) or another site (Google's sign-in page). Not for app pages:
 * those go through the router.
 */
export const navigateTo = (url: string): void => {
  window.location.assign(url);
};
