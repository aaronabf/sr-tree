import { NextResponse } from "next/server"
import { hasDatabase, withTransaction } from "@/lib/db"
import { deleteAttendance, errorResponse, parseId, updateAttendance } from "@/lib/mutations"
import { assertRateLimit } from "@/lib/rate-limit"
import { updateAttendanceSchema } from "@/lib/schemas"
import type { MutationResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

function respond(body: MutationResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

const demo = () =>
  respond({ ok: false, error: "Demo mode: no database configured, so nothing can be saved yet." }, 503)

/** Change the year, who brought them, and/or who they brought. See updateAttendance(). */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!hasDatabase()) {
    return demo()
  }
  const raw = await req.json().catch(() => null)
  if (typeof raw !== "object" || raw === null) {
    return respond({ ok: false, error: "Invalid request body" }, 400)
  }
  const parsed = updateAttendanceSchema.safeParse(raw)
  if (!parsed.success) {
    return respond({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400)
  }
  const { year, inviter, guest } = parsed.data
  if (year === undefined && inviter === undefined && guest === undefined) {
    return respond({ ok: false, error: "Nothing to change." }, 400)
  }

  try {
    await assertRateLimit(req)
    const id = parseId((await ctx.params).id)
    await withTransaction((q) => updateAttendance(q, id, parsed.data))
    return respond({ ok: true })
  } catch (err) {
    return errorResponse(err, "PATCH /api/attendances/[id]")
  }
}

/** Remove one entry. See deleteAttendance(). */
export async function DELETE(req: Request, ctx: Ctx) {
  if (!hasDatabase()) {
    return demo()
  }
  try {
    await assertRateLimit(req)
    const id = parseId((await ctx.params).id)
    await withTransaction((q) => deleteAttendance(q, id))
    return respond({ ok: true })
  } catch (err) {
    return errorResponse(err, "DELETE /api/attendances/[id]")
  }
}
