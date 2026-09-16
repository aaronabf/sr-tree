/**
 * Apply db/schema.sql to DATABASE_URL. Idempotent.
 *   npm run db:migrate
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { config as loadEnv } from "dotenv"
import { Pool } from "pg"

loadEnv({ path: ".env.local", quiet: true })
loadEnv({ quiet: true })

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.")
    process.exit(1)
  }
  const sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8")
  const pool = new Pool({ connectionString: url, max: 1 })
  try {
    await pool.query(sql)
    console.log("✔ schema applied")
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
