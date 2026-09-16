/**
 * Shared server-side logic for creating / editing entries, with the festival
 * rules enforced in one place. Used by the /api/attendances and /api/people
 * route handlers. Everything here runs inside a caller-provided transaction.
 */
import { NextResponse } from "next/server"
import type { QueryResultRow } from "pg"
import { isFestivalYear, previousFestivalYear, yearLabel } from "./config"
import { pgConstraint, pgErrorCode } from "./db"
import { tidyName } from "./names"
import type { AddAttendanceRequest, PersonRef, UpdateAttendanceRequest } from "./types"

export type Q = <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>
export type PersonRow = { id: number; name: string }
export type AttendanceRow = { id: number; person_id: number; year: number; invited_by_id: number | null }
/** The attendance row of a guest, as seen from their host. */
export type GuestRow = { id: number; person_id: number }

/** An error whose message is safe and useful to show the person filling in the form. */
export class UserError extends Error {
  status: number
  constructor(message: string, status = 409) {
    super(message)
    this.status = status
  }
}

export const nameTaken = (name: string) =>
  `There's already a “${name}” on the tree. If that's you, pick them from the list; if not, add an initial or nickname (e.g. “${name} K”).`

/** Find an existing (not deleted) person by id, or create one by (unique) name. */
export async function resolvePerson(q: Q, ref: PersonRef): Promise<PersonRow> {
  if ("id" in ref) {
    return getPerson(q, ref.id)
  }
  const name = tidyName(ref.name)
  const clash = await q<PersonRow>(
    "SELECT id, name FROM people WHERE lower(name) = lower($1) AND deleted_at IS NULL",
    [name],
  )
  if (clash[0]) {
    throw new UserError(nameTaken(clash[0].name))
  }
  const rows = await q<PersonRow>("INSERT INTO people (name) VALUES ($1) RETURNING id, name", [name])
  return rows[0]
}

export async function getPerson(q: Q, id: number): Promise<PersonRow> {
  const rows = await q<PersonRow>("SELECT id, name FROM people WHERE id = $1 AND deleted_at IS NULL", [id])
  if (!rows[0]) {
    throw new UserError("That person isn't on the tree any more. Refresh and try again.", 404)
  }
  return rows[0]
}

export async function getAttendance(q: Q, id: number): Promise<AttendanceRow> {
  const rows = await q<AttendanceRow>(
    "SELECT id, person_id, year, invited_by_id FROM attendances WHERE id = $1",
    [id],
  )
  if (!rows[0]) {
    throw new UserError("That entry doesn't exist any more. Refresh and try again.", 404)
  }
  return rows[0]
}

/**
 * Rule checks for putting `person` in `year` brought by `inviter`, ignoring
 * the attendance row `excludeId` (the row being edited, if any).
 */
export async function assertRules(
  q: Q,
  args: { person: PersonRow; year: number; inviter: PersonRow | null; excludeId?: number },
): Promise<void> {
  const { person, year, inviter, excludeId = -1 } = args

  if (inviter && inviter.id === person.id) {
    throw new UserError("You can't bring yourself. Nice try.", 400)
  }

  const dup = await q<{ id: number; invited_by_id: number | null }>(
    "SELECT id, invited_by_id FROM attendances WHERE person_id = $1 AND year = $2 AND id <> $3",
    [person.id, year, excludeId],
  )
  if (dup[0]) {
    const who = dup[0].invited_by_id != null ? await getPerson(q, dup[0].invited_by_id) : null
    throw new UserError(
      `${person.name} is already on the tree for ${yearLabel(year)}` +
        (who ? ` (brought by ${who.name}).` : ". Edit that entry instead."),
    )
  }

  if (inviter) {
    const taken = await q<PersonRow>(
      `SELECT p.id, p.name
         FROM attendances a JOIN people p ON p.id = a.person_id
        WHERE a.invited_by_id = $1 AND a.year = $2 AND a.id <> $3`,
      [inviter.id, year, excludeId],
    )
    if (taken[0]) {
      throw new UserError(
        `${inviter.name} already brought ${taken[0].name} in ${yearLabel(year)}. One guest per person per year!`,
      )
    }
    await assertNotBothWays(q, { guest: person, inviter, year })
    await assertDirection(q, { guest: person, inviter, year, excludeId })
  }
}

/**
 * You either come as someone's guest or bring one, never both in the same
 * year. `guest` is the person being brought by `inviter` in `year`.
 */
async function assertNotBothWays(
  q: Q,
  args: { guest: PersonRow; inviter: PersonRow; year: number },
): Promise<void> {
  const { guest, inviter, year } = args
  const guestBrought = await q<PersonRow>(
    `SELECT p.id, p.name FROM attendances a JOIN people p ON p.id = a.person_id
      WHERE a.invited_by_id = $1 AND a.year = $2`,
    [guest.id, year],
  )
  if (guestBrought[0]) {
    throw new UserError(
      `${guest.name} brought ${guestBrought[0].name} in ${yearLabel(year)}, so nobody could have brought ${guest.name} that year.`,
    )
  }
  const inviterBroughtBy = await q<PersonRow>(
    `SELECT p.id, p.name FROM attendances a JOIN people p ON p.id = a.invited_by_id
      WHERE a.person_id = $1 AND a.year = $2`,
    [inviter.id, year],
  )
  if (inviterBroughtBy[0]) {
    throw new UserError(
      `${inviter.name} was brought by ${inviterBroughtBy[0].name} in ${yearLabel(year)}, so they couldn't bring a guest that year.`,
    )
  }
}

/**
 * Someone who was already coming before the inviter's first year can't have
 * been brought by them. Catches the common mistake of entering the invite
 * backwards. `excludeId` is the guest's row being edited, if any.
 */
async function assertDirection(
  q: Q,
  args: { guest: PersonRow; inviter: PersonRow; year: number; excludeId?: number },
): Promise<void> {
  const { guest, inviter, year, excludeId = -1 } = args
  const [g] = await q<{ min: number | null }>(
    "SELECT min(year)::int AS min FROM attendances WHERE person_id = $1 AND id <> $2",
    [guest.id, excludeId],
  )
  const [i] = await q<{ min: number | null }>(
    "SELECT min(year)::int AS min FROM attendances WHERE person_id = $1",
    [inviter.id],
  )
  const guestFirst = g?.min ?? null
  // The inviter is recorded as attending `year` too, so that caps their first year.
  const inviterFirst = Math.min(i?.min ?? year, year)
  if (guestFirst != null && guestFirst < inviterFirst) {
    throw new UserError(
      `${guest.name} was already on the tree in ${yearLabel(guestFirst)}, before ${inviter.name}'s first year (${yearLabel(inviterFirst)}). ` +
        `Did you mean ${guest.name} brought ${inviter.name}? If ${inviter.name} really went earlier, add those years first.`,
    )
  }
}

/** The attendance row of whoever `personId` brought in `year`, if anyone. */
export async function guestOf(q: Q, personId: number, year: number): Promise<GuestRow | null> {
  const rows = await q<GuestRow>(
    "SELECT id, person_id FROM attendances WHERE invited_by_id = $1 AND year = $2",
    [personId, year],
  )
  return rows[0] ?? null
}

/**
 * Record (or clear, with null) who `person` brought in `year`. A previous
 * guest keeps their attendance but is no longer marked as brought by anyone.
 */
export async function setGuest(
  q: Q,
  person: PersonRow,
  year: number,
  guest: PersonRow | null,
): Promise<void> {
  const cur = await guestOf(q, person.id, year)
  if (cur && guest && cur.person_id === guest.id) {
    return // unchanged
  }

  if (cur) {
    await q("UPDATE attendances SET invited_by_id = NULL WHERE id = $1", [cur.id])
  }
  if (!guest) {
    return
  }

  if (guest.id === person.id) {
    throw new UserError("You can't bring yourself. Nice try.", 400)
  }

  const existing = await q<{ id: number; invited_by_id: number | null }>(
    "SELECT id, invited_by_id FROM attendances WHERE person_id = $1 AND year = $2",
    [guest.id, year],
  )
  if (existing[0]?.invited_by_id != null) {
    const who = await getPerson(q, existing[0].invited_by_id)
    throw new UserError(
      `${guest.name} is already on the tree for ${yearLabel(year)}, brought by ${who.name}. Edit their entry if that's wrong.`,
    )
  }
  await assertNotBothWays(q, { guest, inviter: person, year })
  await assertDirection(q, { guest, inviter: person, year, excludeId: existing[0]?.id })

  if (existing[0]) {
    await q("UPDATE attendances SET invited_by_id = $1 WHERE id = $2", [person.id, existing[0].id])
  } else {
    await q("INSERT INTO attendances (person_id, year, invited_by_id) VALUES ($1, $2, $3)", [
      guest.id,
      year,
      person.id,
    ])
  }
  await ensureAttended(q, person.id, year)
}

/**
 * When a host's year changes, the guest they brought moves with it. If the
 * guest already has a plain "nobody brought me" row in the new year, that row
 * is claimed instead of creating a duplicate.
 */
export async function moveGuest(q: Q, person: PersonRow, guest: GuestRow, toYear: number): Promise<void> {
  const guestRow = await getPerson(q, guest.person_id)
  const clash = await q<{ id: number; invited_by_id: number | null }>(
    "SELECT id, invited_by_id FROM attendances WHERE person_id = $1 AND year = $2",
    [guestRow.id, toYear],
  )
  let rowId = guest.id
  if (clash[0]) {
    if (clash[0].invited_by_id != null && clash[0].invited_by_id !== person.id) {
      const who = await getPerson(q, clash[0].invited_by_id)
      throw new UserError(
        `${guestRow.name} is already on the tree for ${yearLabel(toYear)}, brought by ${who.name}. ` +
          `Set "who did they bring" to Nobody first, or fix ${guestRow.name}'s entry.`,
      )
    }
    await q("DELETE FROM attendances WHERE id = $1", [guest.id])
    await q("UPDATE attendances SET invited_by_id = $1 WHERE id = $2", [person.id, clash[0].id])
    rowId = clash[0].id
  } else {
    await q("UPDATE attendances SET year = $1 WHERE id = $2", [toYear, guest.id])
  }
  await assertNotBothWays(q, { guest: guestRow, inviter: person, year: toYear })
  await assertDirection(q, { guest: guestRow, inviter: person, year: toYear, excludeId: rowId })
}

/**
 * If you brought someone, you were there too, and you'd been before. A host
 * with nothing earlier than `year` is pencilled in for the previous festival
 * year as well, so they sit in the row above their guest instead of beside
 * them. Guests rarely know their host's real first year; the host can fix it.
 */
export async function ensureAttended(q: Q, personId: number, year: number): Promise<void> {
  await q(
    `INSERT INTO attendances (person_id, year, invited_by_id) VALUES ($1, $2, NULL)
     ON CONFLICT (person_id, year) DO NOTHING`,
    [personId, year],
  )
  const prior = previousFestivalYear(year)
  if (prior == null) {
    return
  }
  const earlier = await q("SELECT 1 FROM attendances WHERE person_id = $1 AND year < $2 LIMIT 1", [
    personId,
    year,
  ])
  if (!earlier[0]) {
    await q(
      `INSERT INTO attendances (person_id, year, invited_by_id) VALUES ($1, $2, NULL)
       ON CONFLICT (person_id, year) DO NOTHING`,
      [personId, prior],
    )
  }
}

/** Remove a person who no longer appears anywhere, so the picker stays clean. */
export async function deleteIfOrphan(q: Q, personId: number): Promise<void> {
  await q(
    `DELETE FROM people p
      WHERE p.id = $1
        AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.invited_by_id = p.id)`,
    [personId],
  )
}

/**
 * Soft-delete: hide the person and cut their invite links both ways, so the
 * people they brought show as "nobody brought them" and their hosts' guest
 * slots free up. Their own years stay in the table so an admin can restore
 * them with `UPDATE people SET deleted_at = NULL WHERE id = ...`.
 */
export async function softDeletePerson(q: Q, personId: number): Promise<void> {
  await q("UPDATE people SET deleted_at = now() WHERE id = $1", [personId])
  await q("UPDATE attendances SET invited_by_id = NULL WHERE invited_by_id = $1 OR person_id = $1", [
    personId,
  ])
}

/* ------------------------------------------------------------ operations */
/* The full write flows, one per route. Routes only parse, rate-limit and call. */

/**
 * Add a (person, year, brought-by) entry, optionally with who they brought.
 * Fills in an existing "nobody yet" row for that year if there is one.
 */
export async function addAttendance(
  q: Q,
  input: AddAttendanceRequest,
): Promise<{ personId: number; inviterId: number | null }> {
  const { person, year, inviter, guest } = input
  const inviterRow = inviter ? await resolvePerson(q, inviter) : null
  const personRow = await resolvePerson(q, person)
  const guestRow = guest ? await resolvePerson(q, guest) : null

  // Clearing their guest first lets "they brought X" turn into "X brought
  // them" in a single save without tripping the one-direction rule.
  if (guest === null) {
    await setGuest(q, personRow, year, null)
  }

  // A row with no inviter yet (auto-created because they brought someone,
  // or entered as "on my own") can be completed in place.
  const existing = await q<{ id: number; invited_by_id: number | null }>(
    "SELECT id, invited_by_id FROM attendances WHERE person_id = $1 AND year = $2",
    [personRow.id, year],
  )
  const blank = existing[0] && existing[0].invited_by_id == null ? existing[0] : null

  if (!(blank && !inviterRow)) {
    await assertRules(q, { person: personRow, year, inviter: inviterRow, excludeId: blank?.id })

    if (blank) {
      await q("UPDATE attendances SET invited_by_id = $1 WHERE id = $2", [inviterRow!.id, blank.id])
    } else {
      await q("INSERT INTO attendances (person_id, year, invited_by_id) VALUES ($1, $2, $3)", [
        personRow.id,
        year,
        inviterRow?.id ?? null,
      ])
    }
    if (inviterRow) {
      await ensureAttended(q, inviterRow.id, year)
    }
  }

  if (guestRow) {
    await setGuest(q, personRow, year, guestRow)
  }

  return { personId: personRow.id, inviterId: inviterRow?.id ?? null }
}

/** Change the year, who brought them, and/or who they brought for one entry. */
export async function updateAttendance(q: Q, id: number, patch: UpdateAttendanceRequest): Promise<void> {
  const { year: newYear, inviter: inviterReq, guest: guestReq } = patch
  const row = await getAttendance(q, id)
  const person = await getPerson(q, row.person_id)
  const oldYear = row.year
  const year = newYear ?? oldYear
  if (year !== oldYear && !isFestivalYear(year)) {
    throw new UserError("That year hasn't happened yet", 400)
  }

  const inviter =
    inviterReq === undefined
      ? row.invited_by_id != null
        ? await getPerson(q, row.invited_by_id)
        : null
      : inviterReq === null
        ? null
        : await resolvePerson(q, inviterReq)

  // The guest side: who they brought in the year being edited.
  const curGuest = await guestOf(q, person.id, oldYear)
  const newGuest = guestReq ? await resolvePerson(q, guestReq) : null
  const keepGuest = guestReq === undefined || (newGuest != null && curGuest?.person_id === newGuest.id)

  // 1. Detach a guest that's being removed or replaced first, so "they
  //    brought X" can become "X brought them" in a single save.
  if (curGuest && !keepGuest) {
    await q("UPDATE attendances SET invited_by_id = NULL WHERE id = $1", [curGuest.id])
  }

  // 2. Their own row.
  await assertRules(q, { person, year, inviter, excludeId: row.id })
  await q("UPDATE attendances SET year = $1, invited_by_id = $2 WHERE id = $3", [
    year,
    inviter?.id ?? null,
    row.id,
  ])
  if (inviter) {
    await ensureAttended(q, inviter.id, year)
  }
  if (row.invited_by_id != null && row.invited_by_id !== inviter?.id) {
    await deleteIfOrphan(q, row.invited_by_id)
  }

  // 3. The guest: moves with a changed year, or is set fresh.
  if (curGuest && keepGuest && year !== oldYear) {
    await moveGuest(q, person, curGuest, year)
  } else if (newGuest && !keepGuest) {
    await setGuest(q, person, year, newGuest)
  }
}

/**
 * Remove one entry. Refuses while the person is still recorded as bringing
 * someone that year, since the guest's link would otherwise dangle. Tidies
 * away the person if nothing else references them.
 */
export async function deleteAttendance(q: Q, id: number): Promise<void> {
  const row = await getAttendance(q, id)
  const guest = await guestOf(q, row.person_id, row.year)
  if (guest) {
    const [person, who] = await Promise.all([getPerson(q, row.person_id), getPerson(q, guest.person_id)])
    throw new UserError(
      `${person.name} brought ${who.name} in ${yearLabel(row.year)}. Set "who did they bring" to Nobody first, then delete the year.`,
    )
  }
  await q("DELETE FROM attendances WHERE id = $1", [row.id])
  await deleteIfOrphan(q, row.person_id)
  if (row.invited_by_id != null) {
    await deleteIfOrphan(q, row.invited_by_id)
  }
}

/** Rename a person. Names stay unique (case-insensitive) among people still on the tree. */
export async function renamePerson(q: Q, id: number, rawName: string): Promise<void> {
  const name = tidyName(rawName)
  await getPerson(q, id)
  const clash = await q<PersonRow>(
    "SELECT id, name FROM people WHERE lower(name) = lower($1) AND id <> $2 AND deleted_at IS NULL",
    [name, id],
  )
  if (clash[0]) {
    throw new UserError(nameTaken(clash[0].name))
  }
  await q("UPDATE people SET name = $1 WHERE id = $2", [name, id])
}

type ErrorBody = { ok: false; error: string }

/** Map any thrown error to a JSON response with a user-facing message. */
export function errorResponse(err: unknown, where: string): NextResponse<ErrorBody> {
  const respond = (error: string, status: number) =>
    NextResponse.json<ErrorBody>({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } })

  if (err instanceof UserError) {
    return respond(err.message, err.status)
  }

  const code = pgErrorCode(err)
  if (code === "23505") {
    const c = pgConstraint(err)
    if (c === "attendances_one_guest_per_year") {
      return respond("That person already brought someone that year. One guest per person per year!", 409)
    }
    if (c === "people_name_unique_active" || c === "people_name_unique") {
      return respond(
        "Someone with that exact name was just added. Refresh, then pick them or add an initial.",
        409,
      )
    }
    return respond("That entry already exists for that year.", 409)
  }
  if (code === "23514") {
    return respond("That entry doesn't pass the festival rules.", 400)
  }

  console.error(`${where} failed`, err)
  return respond("Something broke on our end. Try again in a sec.", 500)
}

/** Parse a positive integer route param or throw a 404 UserError. */
export function parseId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new UserError("Not found", 404)
  }
  return id
}
