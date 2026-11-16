/**
 * This page's origin (`https://stash.example.com`): the web app's address, which the Connect
 * guides prefill (the api is same-origin under `/api`). Read on each call.
 */
export const pageOrigin = (): string => window.location.origin;
