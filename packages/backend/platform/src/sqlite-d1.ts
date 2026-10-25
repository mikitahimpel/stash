import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type * as D1Database from "./d1-database.ts";

// A D1 binding over an in-memory `node:sqlite` database, for tests. D1 is SQLite, so SQL, FTS5 and
// constraint behavior match. Only the methods `D1Database.D1Binding` needs are implemented.

const toSqlite = (value: unknown): SQLInputValue => {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint" || value instanceof Uint8Array) return value;
  throw new TypeError(`D1_TYPE_ERROR: unsupported value type ${typeof value}`);
};

const fromSqlite = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );

class SqliteStatement implements D1Database.D1BindingStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: ReadonlyArray<SQLInputValue> = [],
  ) {}

  bind(...values: Array<unknown>): SqliteStatement {
    return new SqliteStatement(this.db, this.sql, values.map(toSqlite));
  }

  /** Synchronous core, so `batch` can run every statement inside one transaction. */
  execute(): D1Database.D1BindingResult {
    const statement: StatementSync = this.db.prepare(this.sql);
    if (statement.columns().length === 0) {
      const { changes, lastInsertRowid } = statement.run(...this.params);
      return {
        results: [],
        meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) },
      };
    }
    const results = statement.all(...this.params).map(fromSqlite);
    return { results, meta: { changes: 0, last_row_id: 0 } };
  }

  async all(): Promise<D1Database.D1BindingResult> {
    return this.execute();
  }

  async first(): Promise<Record<string, unknown> | null> {
    const results = this.execute().results ?? [];
    return (results[0] as Record<string, unknown> | undefined) ?? null;
  }

  async run(): Promise<D1Database.D1BindingResult> {
    return this.execute();
  }
}

export interface SqliteD1 extends D1Database.D1Binding {
  close(): void;
}

/** A fresh, empty in-memory database. */
export const make = (): SqliteD1 => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    prepare: (sql) => new SqliteStatement(db, sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          if (!(statement instanceof SqliteStatement)) {
            throw new TypeError("batch only accepts statements from the same database");
          }
          return statement.execute();
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exec: async (sql) => {
      db.exec(sql);
    },
    close: () => db.close(),
  };
};
