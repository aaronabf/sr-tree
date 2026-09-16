import { NextResponse } from "next/server"
import { hasDatabase, withTransaction } from "@/lib/db"
import { addAttendance, errorResponse } from "@/lib/mutations"
import { assertRateLimit } from "@/lib/rate-limit"
import { addAttendanceSchema } from "@/lib/schemas"
import type { AddAttendanceResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

function respond(body: AddAttendanceResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/** Add a (person, year, brought-by) entry. See addAttendance() for the rules. */
export async function POST(req: Request) {
  if (!hasDatabase()) {
    return respond(
      { ok: false, error: "Demo mode: no database configured, so nothing can be saved yet." },
      503,
    )
  }

  const raw = await req.json().catch(() => null)
  if (typeof raw !== "object" || raw === null) {
    return respond({ ok: false, error: "Invalid request body" }, 400)
  }
  const parsed = addAttendanceSchema.safeParse(raw)
  if (!parsed.success) {
    return respond({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400)
  }

  try {
    await assertRateLimit(req)
    const result = await withTransaction((q) => addAttendance(q, parsed.data))
    return respond({ ok: true, ...result })
  } catch (err) {
    return errorResponse(err, "POST /api/attendances")
  }
}
