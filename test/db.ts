/**
 * Test database harness. Connects to TEST_DATABASE_URL, creates a throwaway
 * schema, applies db/schema.sql into it, and runs every test transaction with
 * search_path pointed there. The schema is dropped at the end, so any Postgres
 * works: a Neon branch, a local server, or a Docker container. Nothing in the
 * public schema is touched.
 *
 * Refuses to run against the production DATABASE_URL.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { config as loadEnv } from "dotenv"
import { Pool, type QueryResultRow } from "pg"
import type { Q } from "../lib/mutations"

loadEnv({ path: ".env.test.local", quiet: true })
loadEnv({ path: ".env.local", quiet: true })

export type TestDb = {
  /** Run `fn` in a transaction scoped to the test schema; rolls back on throw. */
  tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T>
  /** Empty every table. */
  reset: () => Promise<void>
  /** Drop the schema and disconnect. */
  close: () => Promise<void>
}

export async function openTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a Neon branch or a local Postgres (see README, Testing).",
    )
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is the production DATABASE_URL. Use a Neon branch instead.")
  }

  const pool = new Pool({ connectionString: url, max: 1 })
  const client = await pool.connect()
  // Generated, so safe to interpolate.
  const schema = `sustain_test_${process.pid}_${Date.now().toString(36)}`

  const tx = async <T>(fn: (q: Q) => Promise<T>): Promise<T> => {
    await client.query("BEGIN")
    try {
      // SET LOCAL survives PgBouncer's transaction pooling, a session SET wouldn't.
      await client.query(`SET LOCAL search_path TO ${schema}`)
      const q = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => {
        // Multi-statement text (schema.sql) needs the simple protocol, i.e. no params array.
        const res = params.length ? await client.query<R>(text, params) : await client.query<R>(text)
        return res.rows
      }
      const out = await fn(q)
      await client.query("COMMIT")
      return out
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {})
      throw err
    }
  }

  await client.query(`CREATE SCHEMA ${schema}`)
  const ddl = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8")
  await tx(async (q) => {
    await q(ddl)
  })

  return {
    tx,
    reset: () =>
      tx(async (q) => {
        await q("TRUNCATE attendances, people, rate_limits RESTART IDENTITY CASCADE")
      }),
    close: async () => {
      await client.query(`DROP SCHEMA ${schema} CASCADE`)
      client.release()
      await pool.end()
    },
  }
}
