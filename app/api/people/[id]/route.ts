import { NextResponse } from "next/server"
import { hasDatabase, withTransaction } from "@/lib/db"
import { errorResponse, getPerson, parseId, renamePerson, softDeletePerson } from "@/lib/mutations"
import { assertRateLimit } from "@/lib/rate-limit"
import { renamePersonSchema } from "@/lib/schemas"
import type { MutationResponse } from "@/lib/types"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

function respond(body: MutationResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

const demo = () =>
  respond({ ok: false, error: "Demo mode: no database configured, so nothing can be saved yet." }, 503)

/** Rename a person. See renamePerson(). */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!hasDatabase()) {
    return demo()
  }
  const raw = await req.json().catch(() => null)
  if (typeof raw !== "object" || raw === null) {
    return respond({ ok: false, error: "Invalid request body" }, 400)
  }
  const parsed = renamePersonSchema.safeParse(raw)
  if (!parsed.success) {
    return respond({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400)
  }

  try {
    await assertRateLimit(req)
    const id = parseId((await ctx.params).id)
    await withTransaction((q) => renamePerson(q, id, parsed.data.name))
    return respond({ ok: true })
  } catch (err) {
    return errorResponse(err, "PATCH /api/people/[id]")
  }
}

/** Soft-delete a person. See softDeletePerson(). */
export async function DELETE(req: Request, ctx: Ctx) {
  if (!hasDatabase()) {
    return demo()
  }
  try {
    await assertRateLimit(req)
    const id = parseId((await ctx.params).id)
    await withTransaction(async (q) => {
      await getPerson(q, id)
      await softDeletePerson(q, id)
    })
    return respond({ ok: true })
  } catch (err) {
    return errorResponse(err, "DELETE /api/people/[id]")
  }
}
