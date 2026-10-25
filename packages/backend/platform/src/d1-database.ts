import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A value D1 can bind to a `?` placeholder. Booleans are stored as `1` / `0`. */
export type Value = string | number | boolean | null | Uint8Array;

/** A row as D1 returns it, before decoding. */
export type Row = Readonly<Record<string, unknown>>;

/** One SQL statement with its positional parameters. */
export interface Statement {
  readonly sql: string;
  readonly params: ReadonlyArray<Value>;
}

/** Builds a statement from SQL with `?` placeholders. */
export const statement = (sql: string, ...params: ReadonlyArray<Value>): Statement => ({
  sql,
  params,
});

/**
 * Builds a statement from a template literal. Every interpolation becomes a bound `?` parameter,
 * never SQL text: sql`SELECT * FROM links WHERE id = ${id}`.
 */
export const sql = (strings: TemplateStringsArray, ...params: ReadonlyArray<Value>): Statement =>
  statement(strings.join("?"), ...params);

/** What a write reports. */
export interface RunResult {
  readonly changes: number;
  readonly lastRowId: number;
}

export type DatabaseOperation = "all" | "first" | "run" | "batch" | "exec" | "decode";

/** A D1 call failed or a row did not match its schema. Parameters are never included. */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly operation: DatabaseOperation;
  readonly sql: string;
  readonly cause: unknown;
}> {}

/**
 * The part of the D1 binding this package uses. `D1Database` satisfies it, and the test shim in
 * `./testing` implements it.
 */
export interface D1Binding {
  prepare(query: string): D1BindingStatement;
  batch(statements: Array<D1BindingStatement>): Promise<Array<D1BindingResult>>;
  exec(query: string): Promise<unknown>;
}

export interface D1BindingStatement {
  bind(...values: Array<unknown>): D1BindingStatement;
  all(): Promise<D1BindingResult>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<D1BindingResult>;
}

export interface D1BindingResult {
  readonly results?: Array<unknown>;
  readonly meta: { readonly changes: number; readonly last_row_id: number };
}

/** The D1 database. */
export class Database extends Context.Service<
  Database,
  {
    /** Every row the statement returns. */
    readonly all: (statement: Statement) => Effect.Effect<ReadonlyArray<Row>, DatabaseError>;
    /** The first row, if any. */
    readonly first: (statement: Statement) => Effect.Effect<Option.Option<Row>, DatabaseError>;
    /** Runs a write. */
    readonly run: (statement: Statement) => Effect.Effect<RunResult, DatabaseError>;
    /** Runs the statements in one transaction: all of them apply, or none. */
    readonly batch: (
      statements: ReadonlyArray<Statement>,
    ) => Effect.Effect<ReadonlyArray<RunResult>, DatabaseError>;
    /** Runs raw SQL that may hold several statements, without parameters (schema setup). */
    readonly exec: (sql: string) => Effect.Effect<void, DatabaseError>;
  }
>()("@stash/backend-platform/Database") {}

const toRunResult = (result: D1BindingResult): RunResult => ({
  changes: result.meta.changes,
  lastRowId: result.meta.last_row_id,
});

/** Wraps a D1 binding. */
export const make = (d1: D1Binding): Database["Service"] => {
  const prepare = (s: Statement) => d1.prepare(s.sql).bind(...s.params);
  const call = <A>(operation: DatabaseOperation, sql: string, f: () => Promise<A>) =>
    Effect.tryPromise({
      try: f,
      catch: (cause) => new DatabaseError({ operation, sql, cause }),
    });
  return {
    all: (s) =>
      call("all", s.sql, () => prepare(s).all()).pipe(
        Effect.map((result) => (result.results ?? []) as ReadonlyArray<Row>),
      ),
    first: (s) =>
      call("first", s.sql, () => prepare(s).first()).pipe(Effect.map(Option.fromNullishOr)),
    run: (s) => call("run", s.sql, () => prepare(s).run()).pipe(Effect.map(toRunResult)),
    batch: (statements) =>
      statements.length === 0
        ? Effect.succeed([])
        : call("batch", statements.map((s) => s.sql).join(";\n"), () =>
            d1.batch(statements.map(prepare)),
          ).pipe(Effect.map((results) => results.map(toRunResult))),
    exec: (sql) => call("exec", sql, () => d1.exec(sql)).pipe(Effect.asVoid),
  };
};

/** The live service over a D1 binding. */
export const layer = (d1: D1Binding): Layer.Layer<Database> => Layer.succeed(Database)(make(d1));

const decodeRow =
  <S extends Schema.Constraint>(schema: S, s: Statement) =>
  (row: Row): Effect.Effect<S["Type"], DatabaseError, S["DecodingServices"]> =>
    Schema.decodeUnknownEffect(schema)(row).pipe(
      Effect.mapError((cause) => new DatabaseError({ operation: "decode", sql: s.sql, cause })),
    );

/** Runs the statement and decodes every row with `schema`. */
export const query =
  <S extends Schema.Constraint>(schema: S) =>
  (
    s: Statement,
  ): Effect.Effect<ReadonlyArray<S["Type"]>, DatabaseError, Database | S["DecodingServices"]> =>
    Database.use((db) => db.all(s)).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, decodeRow(schema, s))),
    );

/** Runs the statement and decodes the first row with `schema`, if there is one. */
export const queryFirst =
  <S extends Schema.Constraint>(schema: S) =>
  (
    s: Statement,
  ): Effect.Effect<Option.Option<S["Type"]>, DatabaseError, Database | S["DecodingServices"]> =>
    Database.use((db) => db.first(s)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (row) => Effect.asSome(decodeRow(schema, s)(row)),
        }),
      ),
    );
