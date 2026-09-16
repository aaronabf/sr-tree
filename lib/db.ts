import { Pool, type QueryResultRow } from "pg"

// Reuse a single pool across hot reloads / warm serverless invocations.
const globalForPg = globalThis as unknown as { __sustainPool?: Pool }

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set")
  }
  if (!globalForPg.__sustainPool) {
    globalForPg.__sustainPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon's pooled endpoint handles fan-out; keep per-instance connections low.
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return globalForPg.__sustainPool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params)
  return result.rows
}

/** Run `fn` inside a transaction; rolls back on throw. */
export async function withTransaction<T>(
  fn: (
    q: <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>,
  ) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    const q = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) =>
      (await client.query<R>(text, params)).rows
    const out = await fn(q)
    await client.query("COMMIT")
    return out
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Postgres error shape we care about (unique/check violations). */
export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined
}

export function pgConstraint(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "constraint" in err
    ? String((err as { constraint?: unknown }).constraint)
    : undefined
}
