import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Schema from "effect/Schema";

/** A query the user searched for, and when (epoch milliseconds). */
export const Entry = Schema.Struct({
  query: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  at: Schema.Finite,
});
export type Entry = typeof Entry.Type;

/** The `KeyValueStore` key that holds the list. */
export const storageKey = "stash:recent-searches";

/** How many searches are kept. The oldest goes first. */
export const maxEntries = 8;

/** The longest query kept: the search contract's limit. */
export const maxQueryLength = 500;

/**
 * The searches made on this device, newest first. They stay in the browser (the platform
 * `KeyValueStore`) and are never sent anywhere. A store that can't be read is an empty list, and
 * one that can't be written loses nothing but the history.
 */
export class RecentSearches extends Context.Service<
  RecentSearches,
  {
    readonly list: Effect.Effect<ReadonlyArray<Entry>>;
    /**
     * Puts `query` (trimmed) first, replacing an earlier entry that differs only by case, and
     * drops the oldest past `maxEntries`. A blank query changes nothing. Answers the new list.
     */
    readonly add: (query: string) => Effect.Effect<ReadonlyArray<Entry>>;
    /** Answers the new list. */
    readonly remove: (query: string) => Effect.Effect<ReadonlyArray<Entry>>;
    readonly clear: Effect.Effect<void>;
  }
>()("@stash/web-platform/RecentSearches") {}

const Stored = Schema.fromJsonString(Schema.Array(Entry));
const decode = Schema.decodeUnknownOption(Stored);
const encode = Schema.encodeSync(Stored);

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export const make: Effect.Effect<RecentSearches["Service"], never, KeyValueStore.KeyValueStore> =
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;
    const list = store.get(storageKey).pipe(
      Effect.map((stored) =>
        stored === undefined ? [] : Option.getOrElse(decode(stored), () => []),
      ),
      Effect.orElseSucceed((): ReadonlyArray<Entry> => []),
    );
    const write = (entries: ReadonlyArray<Entry>) =>
      store.set(storageKey, encode(entries)).pipe(Effect.ignore, Effect.as(entries));
    return {
      list,
      add: (query) => {
        const text = query.trim().slice(0, maxQueryLength);
        if (text === "") return list;
        return Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          const rest = (yield* list).filter((entry) => !same(entry.query, text));
          return yield* write([{ query: text, at }, ...rest].slice(0, maxEntries));
        });
      },
      remove: (query) =>
        list.pipe(
          Effect.flatMap((entries) => write(entries.filter((entry) => !same(entry.query, query)))),
        ),
      clear: store.remove(storageKey).pipe(Effect.ignore),
    };
  });

/** The service. Provide a `KeyValueStore` (`./live` uses `localStorage`). */
export const layer: Layer.Layer<RecentSearches, never, KeyValueStore.KeyValueStore> =
  Layer.effect(RecentSearches)(make);
