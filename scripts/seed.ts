/**
 * Populate an EMPTY database with the fictional demo lineage from lib/demo.ts.
 *   npm run db:seed            # refuses if any people already exist
 *   npm run db:seed -- --force # wipes people + attendances first
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { config as loadEnv } from "dotenv"
import { Pool } from "pg"
import { buildDemoGraph } from "../lib/demo"

loadEnv({ path: ".env.local", quiet: true })
loadEnv({ quiet: true })

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL is not set.")
    process.exit(1)
  }
  const force = process.argv.includes("--force")
  const pool = new Pool({ connectionString: url, max: 1 })
  const client = await pool.connect()
  try {
    await client.query(readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8"))
    const { rows } = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM people")
    if (Number(rows[0].n) > 0 && !force) {
      console.error(`Database already has ${rows[0].n} people. Re-run with --force to wipe and reseed.`)
      process.exit(1)
    }

    const demo = buildDemoGraph()
    await client.query("BEGIN")
    if (force) {
      await client.query("TRUNCATE attendances, people RESTART IDENTITY CASCADE")
    }
    // Insert with explicit ids so attendance references line up, then bump the sequences.
    for (const p of demo.people) {
      await client.query("INSERT INTO people (id, name) VALUES ($1, $2)", [p.id, p.name])
    }
    for (const a of demo.attendances) {
      await client.query("INSERT INTO attendances (person_id, year, invited_by_id) VALUES ($1, $2, $3)", [
        a.personId,
        a.year,
        a.invitedById,
      ])
    }
    await client.query("SELECT setval('people_id_seq', (SELECT max(id) FROM people))")
    await client.query("COMMIT")
    console.log(`✔ seeded ${demo.people.length} people, ${demo.attendances.length} attendances`)
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
