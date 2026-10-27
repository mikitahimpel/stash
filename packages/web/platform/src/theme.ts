import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

/** What the user picked. `system` follows the OS (`prefers-color-scheme`). */
export type Preference = "system" | "light" | "dark";

/** The color scheme on screen. */
export type Scheme = "light" | "dark";

export const preferences: ReadonlyArray<Preference> = ["system", "light", "dark"];

export const defaultPreference: Preference = "system";

/** The `KeyValueStore` key that holds the preference. */
export const storageKey = "stash:theme";

export interface State {
  readonly preference: Preference;
  /** The scheme on screen: the preference, or the OS scheme when the preference is `system`. */
  readonly scheme: Scheme;
}

/**
 * The light / dark theme. It keeps the preference in the platform `KeyValueStore` and sets the
 * `dark` class on `<html>` whenever the scheme on screen is dark.
 */
export class Theme extends Context.Service<
  Theme,
  {
    readonly current: Effect.Effect<State>;
    /** Stores the preference and applies it right away. */
    readonly setPreference: (preference: Preference) => Effect.Effect<void>;
    /** Emits the current state first, then every change. Repeated states are dropped. */
    readonly changes: Stream.Stream<State>;
  }
>()("@stash/web-platform/Theme") {}

/**
 * What the theme needs from the page: the OS scheme, and a way to show a scheme. The live layer
 * reads `matchMedia` and toggles the class on `<html>`; the in-memory one (`./testing`) keeps both
 * in memory.
 */
export interface Host {
  readonly systemScheme: Effect.Effect<Scheme>;
  /** Emits every change of the OS scheme. */
  readonly systemChanges: Stream.Stream<Scheme>;
  readonly apply: (scheme: Scheme) => Effect.Effect<void>;
}

// What the service keeps: the preference and the OS scheme, so `system` can follow the OS.
interface Inner {
  readonly preference: Preference;
  readonly system: Scheme;
}

const isPreference = (value: unknown): value is Preference =>
  preferences.some((preference) => preference === value);

const resolve = (preference: Preference, system: Scheme): Scheme =>
  preference === "system" ? system : preference;

/**
 * Builds the service on `host`: reads the stored preference (`system` when there is none or it
 * can't be read), applies it, and follows the OS scheme while the scope is open. A preference that
 * can't be stored still applies for the session.
 */
export const make = (
  host: Host,
): Effect.Effect<Theme["Service"], never, KeyValueStore.KeyValueStore | Scope.Scope> =>
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;
    const stored = yield* store.get(storageKey).pipe(Effect.orElseSucceed(() => undefined));
    const preference = isPreference(stored) ? stored : defaultPreference;
    const system = yield* host.systemScheme;
    const state = yield* SubscriptionRef.make<Inner>({ preference, system });
    const current = Effect.map(SubscriptionRef.get(state), (s) => ({
      preference: s.preference,
      scheme: resolve(s.preference, s.system),
    }));
    const update = (f: (s: Inner) => Inner) =>
      SubscriptionRef.updateAndGet(state, f).pipe(
        Effect.flatMap((s) => host.apply(resolve(s.preference, s.system))),
      );

    yield* host.apply(resolve(preference, system));
    yield* host.systemChanges.pipe(
      Stream.runForEach((scheme) => update((s) => ({ ...s, system: scheme }))),
      Effect.forkScoped,
    );

    return {
      current,
      setPreference: (preference) =>
        Effect.andThen(
          store.set(storageKey, preference).pipe(Effect.ignore),
          update((s) => ({ ...s, preference })),
        ),
      changes: SubscriptionRef.changes(state).pipe(
        Stream.map((s) => ({ preference: s.preference, scheme: resolve(s.preference, s.system) })),
        Stream.changesWith((a, b) => a.preference === b.preference && a.scheme === b.scheme),
      ),
    };
  });

const darkQuery = "(prefers-color-scheme: dark)";

const schemeOf = (query: { readonly matches: boolean }): Scheme =>
  query.matches ? "dark" : "light";

/** The page itself: `matchMedia` for the OS scheme, the `dark` class on `<html>` to show one. */
export const browserHost: Host = {
  systemScheme: Effect.sync(() => schemeOf(window.matchMedia(darkQuery))),
  systemChanges: Stream.callback<Scheme>((queue) => {
    const query = window.matchMedia(darkQuery);
    const emit = () => Queue.offerUnsafe(queue, schemeOf(query));
    return Effect.acquireRelease(
      Effect.sync(() => query.addEventListener("change", emit)),
      () => Effect.sync(() => query.removeEventListener("change", emit)),
    );
  }),
  apply: (scheme) =>
    Effect.sync(() => {
      document.documentElement.classList.toggle("dark", scheme === "dark");
    }),
};

/** The live service. Provide a `KeyValueStore` (`./live` uses `localStorage`). */
export const layer: Layer.Layer<Theme, never, KeyValueStore.KeyValueStore> = Layer.effect(Theme)(
  make(browserHost),
);
