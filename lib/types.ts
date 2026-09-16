import type { z } from "zod"
import type {
  addAttendanceSchema,
  personRefSchema,
  renamePersonSchema,
  updateAttendanceSchema,
} from "./schemas"

export type Person = {
  id: number
  /** Unique (case-insensitive). Usually a first name, plus an initial when needed. */
  name: string
}

export type Attendance = {
  id: number
  personId: number
  year: number
  invitedById: number | null
}

export type GraphData = {
  people: Person[]
  attendances: Attendance[]
  /** True when DATABASE_URL is missing and demo data is being served. */
  demo: boolean
}

/** What the type-ahead hands back: an existing person, a new name, or "nobody". */
export type Pick = { kind: "existing"; id: number } | { kind: "new"; name: string } | { kind: "none" }

// Request bodies are inferred from the zod schemas in ./schemas so the client
// and the API can't drift apart.
export type PersonRef = z.infer<typeof personRefSchema>
export type AddAttendanceRequest = z.infer<typeof addAttendanceSchema>
export type UpdateAttendanceRequest = z.infer<typeof updateAttendanceSchema>
export type RenamePersonRequest = z.infer<typeof renamePersonSchema>

export type AddAttendanceResponse =
  { ok: true; personId: number; inviterId: number | null } | { ok: false; error: string }

export type MutationResponse = { ok: true } | { ok: false; error: string }
