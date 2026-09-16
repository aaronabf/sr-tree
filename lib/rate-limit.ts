/**
 * Per-IP rate limit for write requests, backed by Postgres so it holds across
 * serverless instances without another service. One counter per IP per minute.
 *
 * Only active in production by default, since every local request shares one
 * key. RATE_LIMIT=on forces it on (tests, staging); RATE_LIMIT=off disables
 * it anywhere. RATE_LIMIT_PER_MINUTE overrides the limit (default 30).
 */
import { query } from "./db"
import { type Q, UserError } from "./mutations"

const WINDOW_MS = 60_000

/** Writes allowed per IP per window. Adding yourself for a few years is ~5. */
export function rateLimitPerMinute(): number {
  const n = Number(process.env.RATE_LIMIT_PER_MINUTE)
  return Number.isInteger(n) && n > 0 ? n : 30
}

export function rateLimitEnabled(): boolean {
  const flag = process.env.RATE_LIMIT
  if (flag === "off") {
    return false
  }
  if (flag === "on") {
    return true
  }
  return process.env.NODE_ENV === "production"
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    return forwarded.split(",")[0].trim()
  }
  return req.headers.get("x-real-ip") ?? "unknown"
}

/**
 * Count one request against `key`'s current window and throw a 429 UserError
 * once over the limit. `now` and `q` are injectable for tests.
 */
export async function countRequest(key: string, q: Q = query, now = Date.now()): Promise<void> {
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS)
  const rows = await q<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowStart],
  )
  if ((rows[0]?.count ?? 0) > rateLimitPerMinute()) {
    throw new UserError("Whoa, that's a lot of edits at once. Give it a minute and try again.", 429)
  }
  // Housekeeping: drop stale windows now and then so the table stays tiny.
  if (Math.random() < 0.05) {
    await q("DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'")
  }
}

/**
 * Rate-limit a write request by client IP. Runs outside the write transaction
 * on purpose, so rejected attempts still count.
 */
export async function assertRateLimit(req: Request): Promise<void> {
  if (!rateLimitEnabled()) {
    return
  }
  await countRequest(clientIp(req))
}
