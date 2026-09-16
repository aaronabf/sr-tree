/**
 * Request body schemas. The single source of truth for what the API accepts;
 * the request types in ./types are inferred from these.
 */
import { z } from "zod"
import { FIRST_YEAR, lastSelectableYear, SKIPPED_YEARS } from "./config"

export const nameSchema = z.string().trim().min(1, "Name is required").max(60, "Name is too long")

/** Either an existing person (by id) or a brand-new one (by name). */
export const personRefSchema = z.union([
  z.object({ id: z.number().int().positive() }),
  z.object({ name: nameSchema }),
])

/** Any year the festival ran, whether or not it can currently be picked. */
export const festivalYearSchema = z
  .number()
  .int()
  .min(FIRST_YEAR, `Sustain-Release started in ${FIRST_YEAR}`)
  .max(2100, "That year hasn't happened yet")
  .refine((y) => !SKIPPED_YEARS.has(y), "There was no festival that year")

/** A year that can be entered right now (next year only once it's announced). */
export const yearSchema = festivalYearSchema.refine(
  (y) => y <= lastSelectableYear(),
  "That year hasn't happened yet",
)

/** POST /api/attendances */
export const addAttendanceSchema = z.object({
  person: personRefSchema,
  /** The year `person` was invited / attended. */
  year: yearSchema,
  /** null => "nobody invited me / got in on my own" */
  inviter: personRefSchema.nullable(),
  /** Who `person` brought that year. Omit to leave alone; null => nobody. */
  guest: personRefSchema.nullable().optional(),
})

/**
 * PATCH /api/attendances/[id]. Omit a field to leave it alone; inviter null =
 * "on my own", guest null = "brought nobody". If the year changes and the
 * guest is left alone, the guest moves to the new year too. The year is only
 * checked against "has it happened yet" when it actually changes, so a row
 * that already holds next year can still be edited.
 */
export const updateAttendanceSchema = z.object({
  year: festivalYearSchema.optional(),
  inviter: personRefSchema.nullable().optional(),
  guest: personRefSchema.nullable().optional(),
})

/** PATCH /api/people/[id] */
export const renamePersonSchema = z.object({ name: nameSchema })
