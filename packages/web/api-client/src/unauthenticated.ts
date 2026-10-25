import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

/**
 * Counts the api responses with status 401 since the registry started. Every 401 bumps it, so a
 * subscriber sees one change per `unauthenticated` event. Kept alive so no event is lost while
 * nothing is subscribed.
 */
export const unauthenticated: Atom.Writable<number> = Atom.make(0).pipe(Atom.keepAlive);

/** Emits one `unauthenticated` event. */
export const emit = (registry: AtomRegistry.AtomRegistry): void =>
  registry.update(unauthenticated, (count) => count + 1);

/**
 * Calls `listener` on every `unauthenticated` event, for example to send the user to the login
 * page. Returns the function that stops listening.
 */
export const onUnauthenticated = (
  registry: AtomRegistry.AtomRegistry,
  listener: () => void,
): (() => void) => {
  // The registry may also notify when it first computes the atom, so only an increase is an event.
  let last = registry.get(unauthenticated);
  return registry.subscribe(unauthenticated, (count) => {
    if (count > last) listener();
    last = count;
  });
};
