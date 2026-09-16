/**
 * Festival rules against a real Postgres. Run with `npm test`; needs
 * TEST_DATABASE_URL (see README, Testing). Years are fixed in the past so the
 * "has it happened yet" check never gets in the way.
 *
 * Note the API's convention: `{ name }` always creates a new person, so an
 * existing person must be referenced as `{ id }` (see `ref` below).
 */
import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"
import {
  addAttendance,
  deleteAttendance,
  getPerson,
  type Q,
  renamePerson,
  softDeletePerson,
  updateAttendance,
  UserError,
} from "../lib/mutations"
import { countRequest } from "../lib/rate-limit"
import { openTestDb, type TestDb } from "./db"

let db: TestDb
before(async () => {
  db = await openTestDb()
})
after(async () => {
  // db is undefined if `before` failed (no TEST_DATABASE_URL); don't mask that error.
  await db?.close()
})
beforeEach(() => db.reset())

type Row = { person: string; year: number; by: string | null }

/** Every attendance as (person, year, brought by), oldest first. */
const rows = (q: Q) =>
  q<Row>(
    `SELECT p.name AS person, a.year, h.name AS by
       FROM attendances a
       JOIN people p ON p.id = a.person_id
       LEFT JOIN people h ON h.id = a.invited_by_id
      ORDER BY a.year, p.name`,
  )

const rowId = (q: Q, name: string, year: number) =>
  q<{ id: number }>(
    "SELECT a.id FROM attendances a JOIN people p ON p.id = a.person_id WHERE p.name = $1 AND a.year = $2",
    [name, year],
  ).then((r) => r[0].id)

const personId = (q: Q, name: string) =>
  q<{ id: number }>("SELECT id FROM people WHERE name = $1", [name]).then((r) => r[0].id)

/** `{ id }` reference to an existing person, by name. */
const ref = (name: string) => db.tx((q) => personId(q, name)).then((id) => ({ id }))

/** Assert `fn` throws a UserError whose message matches `re`. */
async function rejects(fn: () => Promise<unknown>, re: RegExp, status?: number) {
  try {
    await fn()
  } catch (err) {
    assert.ok(err instanceof UserError, `expected a UserError, got ${String(err)}`)
    assert.match(err.message, re)
    if (status !== undefined) {
      assert.equal(err.status, status)
    }
    return
  }
  assert.fail("expected an error")
}

describe("adding", () => {
  it("new guest with a new host: host gets that year and the year before", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2024, inviter: { name: "Host" } }))
    assert.deepEqual(await db.tx(rows), [
      { person: "Host", year: 2023, by: null },
      { person: "Guest", year: 2024, by: "Host" },
      { person: "Host", year: 2024, by: null },
    ])
  })

  it("skips the cancelled year when pencilling in the host", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2021, inviter: { name: "Host" } }))
    const years = (await db.tx(rows)).filter((r) => r.person === "Host").map((r) => r.year)
    assert.deepEqual(years, [2019, 2021])
  })

  it("host with earlier years is not pencilled in again", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Host" }, year: 2018, inviter: null }))
    const host = await ref("Host")
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2024, inviter: host }))
    const years = (await db.tx(rows)).filter((r) => r.person === "Host").map((r) => r.year)
    assert.deepEqual(years, [2018, 2024])
  })

  it("got in on their own is a single row", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "OG" }, year: 2014, inviter: null }))
    assert.deepEqual(await db.tx(rows), [{ person: "OG", year: 2014, by: null }])
  })

  it("the guest field records who they brought", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    assert.deepEqual(await db.tx(rows), [
      { person: "Host", year: 2023, by: null },
      { person: "Guest", year: 2024, by: "Host" },
      { person: "Host", year: 2024, by: null },
    ])
  })

  it("completes a 'nobody yet' row in place instead of duplicating it", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2024, inviter: null }))
    const guest = await ref("Guest")
    await db.tx((q) => addAttendance(q, { person: guest, year: 2024, inviter: { name: "Host" } }))
    const guestRows = (await db.tx(rows)).filter((r) => r.person === "Guest")
    assert.deepEqual(guestRows, [{ person: "Guest", year: 2024, by: "Host" }])
  })

  it("one guest per host per year", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "First" }, year: 2024, inviter: { name: "Host" } }))
    const host = await ref("Host")
    await rejects(
      () => db.tx((q) => addAttendance(q, { person: { name: "Second" }, year: 2024, inviter: host })),
      /Host already brought First in Year 10 \(2024\)/,
    )
  })

  it("one entry per person per year", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2024, inviter: { name: "Host" } }))
    const guest = await ref("Guest")
    await rejects(
      () => db.tx((q) => addAttendance(q, { person: guest, year: 2024, inviter: { name: "Other" } })),
      /Guest is already on the tree for Year 10 \(2024\) \(brought by Host\)/,
    )
  })

  it("you can't bring yourself", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Solo" }, year: 2023, inviter: null }))
    const solo = await ref("Solo")
    await rejects(
      () => db.tx((q) => addAttendance(q, { person: solo, year: 2024, inviter: solo })),
      /can't bring yourself/,
      400,
    )
  })

  it("you can't be brought and bring a guest in the same year", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2024, inviter: { name: "Host" } }))
    const guest = await ref("Guest")
    await rejects(
      () => db.tx((q) => addAttendance(q, { person: { name: "Third" }, year: 2024, inviter: guest })),
      /Guest was brought by Host in Year 10 \(2024\), so they couldn't bring a guest/,
    )
  })

  it("someone newer than you can't have brought you", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Veteran" }, year: 2022, inviter: null }))
    const veteran = await ref("Veteran")
    await rejects(
      () => db.tx((q) => addAttendance(q, { person: veteran, year: 2024, inviter: { name: "Newbie" } })),
      /Veteran was already on the tree in Year 8 \(2022\), before Newbie's first year.*Did you mean Veteran brought Newbie/,
    )
    // Nothing leaked: Newbie was rolled back with the failed transaction.
    assert.deepEqual(await db.tx(rows), [{ person: "Veteran", year: 2022, by: null }])
  })

  it("names are unique, case-insensitively, with a helpful message", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Alice" }, year: 2023, inviter: null }))
    await rejects(
      () => db.tx((q) => addAttendance(q, { person: { name: "  alice " }, year: 2024, inviter: null })),
      /already a “Alice” on the tree.*“Alice K”/,
    )
  })
})

describe("editing", () => {
  it("changing the year moves the guest along", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    await db.tx((q) => updateAttendance(q, id, { year: 2025 }))
    assert.deepEqual(await db.tx(rows), [
      { person: "Host", year: 2023, by: null },
      { person: "Guest", year: 2025, by: "Host" },
      { person: "Host", year: 2025, by: null },
    ])
  })

  it("moving onto the guest's plain row claims it rather than duplicating", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    const guest = await ref("Guest")
    await db.tx((q) => addAttendance(q, { person: guest, year: 2025, inviter: null }))
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    await db.tx((q) => updateAttendance(q, id, { year: 2025 }))
    const guestRows = (await db.tx(rows)).filter((r) => r.person === "Guest")
    assert.deepEqual(guestRows, [{ person: "Guest", year: 2025, by: "Host" }])
  })

  it("moving is refused when someone else brought the guest in the new year", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    // Other needs an earlier year than Guest, or the newer-host rule fires first.
    await db.tx((q) => addAttendance(q, { person: { name: "Other" }, year: 2019, inviter: null }))
    const guest = await ref("Guest")
    const other = await ref("Other")
    await db.tx((q) => addAttendance(q, { person: guest, year: 2025, inviter: other }))
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    await rejects(
      () => db.tx((q) => updateAttendance(q, id, { year: 2025 })),
      /Guest is already on the tree for Year 11 \(2025\), brought by Other/,
    )
  })

  it("setting the guest to nobody releases them but keeps their year", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    await db.tx((q) => updateAttendance(q, id, { guest: null }))
    const guestRows = (await db.tx(rows)).filter((r) => r.person === "Guest")
    assert.deepEqual(guestRows, [{ person: "Guest", year: 2024, by: null }])
  })

  it("swapping the guest releases the old one and attaches the new one", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Old" } }),
    )
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    await db.tx((q) => updateAttendance(q, id, { guest: { name: "New" } }))
    const guests = (await db.tx(rows)).filter((r) => r.year === 2024 && r.person !== "Host")
    assert.deepEqual(guests, [
      { person: "New", year: 2024, by: "Host" },
      { person: "Old", year: 2024, by: null },
    ])
  })

  it("flipping the direction in one save is caught by the newer-host rule", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    const guest = await ref("Guest")
    await rejects(
      () => db.tx((q) => updateAttendance(q, id, { inviter: guest, guest: null })),
      /Host was already on the tree in Year 9 \(2023\), before Guest's first year/,
    )
  })

  it("a future year can't be picked when changing the year", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Solo" }, year: 2023, inviter: null }))
    const id = await db.tx((q) => rowId(q, "Solo", 2023))
    await rejects(() => db.tx((q) => updateAttendance(q, id, { year: 2099 })), /hasn't happened yet/, 400)
  })

  it("renaming keeps names unique among live people only", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Alice" }, year: 2023, inviter: null }))
    await db.tx((q) => addAttendance(q, { person: { name: "Bob" }, year: 2023, inviter: null }))
    const bob = (await ref("Bob")).id
    await rejects(() => db.tx((q) => renamePerson(q, bob, "alice")), /already a “Alice”/)
    const alice = (await ref("Alice")).id
    await db.tx((q) => softDeletePerson(q, alice))
    await db.tx((q) => renamePerson(q, bob, "Alice"))
    assert.equal((await db.tx((q) => getPerson(q, bob))).name, "Alice")
  })
})

describe("deleting", () => {
  it("refuses to delete a year while that person has a guest, then allows it", async () => {
    await db.tx((q) =>
      addAttendance(q, { person: { name: "Host" }, year: 2024, inviter: null, guest: { name: "Guest" } }),
    )
    const id = await db.tx((q) => rowId(q, "Host", 2024))
    await rejects(
      () => db.tx((q) => deleteAttendance(q, id)),
      /Host brought Guest in Year 10 \(2024\)\. Set "who did they bring" to Nobody first/,
    )
    await db.tx((q) => updateAttendance(q, id, { guest: null }))
    await db.tx((q) => deleteAttendance(q, id))
    assert.deepEqual(await db.tx(rows), [
      { person: "Host", year: 2023, by: null },
      { person: "Guest", year: 2024, by: null },
    ])
  })

  it("deleting a person's last year removes the orphaned person", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Solo" }, year: 2023, inviter: null }))
    const id = await db.tx((q) => rowId(q, "Solo", 2023))
    await db.tx((q) => deleteAttendance(q, id))
    const people = await db.tx((q) => q<{ n: string }>("SELECT count(*)::text AS n FROM people"))
    assert.equal(people[0].n, "0")
  })

  it("soft delete hides the person, cuts links both ways and frees the name", async () => {
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2024, inviter: { name: "Host" } }))
    const guest = await ref("Guest")
    const host = await ref("Host")
    await db.tx((q) => addAttendance(q, { person: guest, year: 2025, inviter: null, guest: { name: "Kid" } }))
    await db.tx((q) => softDeletePerson(q, guest.id))

    await rejects(() => db.tx((q) => getPerson(q, guest.id)), /isn't on the tree any more/, 404)
    const all = await db.tx(rows)
    assert.equal(all.find((r) => r.person === "Kid")?.by, null, "the person they brought is released")
    assert.deepEqual(
      all.filter((r) => r.person === "Guest").map((r) => r.by),
      [null, null],
      "their own rows stay but no longer point at a host",
    )
    // Host's guest slot for 2024 is free again, and the name can be reused.
    await db.tx((q) => addAttendance(q, { person: { name: "Replacement" }, year: 2024, inviter: host }))
    await db.tx((q) => addAttendance(q, { person: { name: "Guest" }, year: 2023, inviter: null }))
  })
})

describe("rate limit", () => {
  it("allows the limit and rejects the next request in the same window", async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "3"
    try {
      const now = Date.now()
      for (let i = 0; i < 3; i++) {
        await db.tx((q) => countRequest("1.2.3.4", q, now))
      }
      await rejects(() => db.tx((q) => countRequest("1.2.3.4", q, now)), /lot of edits/, 429)
      // Another IP and the next window are unaffected.
      await db.tx((q) => countRequest("5.6.7.8", q, now))
      await db.tx((q) => countRequest("1.2.3.4", q, now + 60_000))
    } finally {
      delete process.env.RATE_LIMIT_PER_MINUTE
    }
  })
})
