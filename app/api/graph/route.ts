import { NextResponse } from "next/server"
import { hasDatabase, query } from "@/lib/db"
import { buildDemoGraph } from "@/lib/demo"
import type { Attendance, GraphData, Person } from "@/lib/types"

export const dynamic = "force-dynamic"

type PersonRow = { id: number; name: string }
type AttendanceRow = { id: number; person_id: number; year: number; invited_by_id: number | null }

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json(buildDemoGraph(), {
      headers: { "Cache-Control": "no-store" },
    })
  }

  // Soft-deleted people are hidden, along with their years. Their invite links
  // are cut when they're deleted, but the CASE guards against any stragglers.
  const [personRows, attendanceRows] = await Promise.all([
    query<PersonRow>("SELECT id, name FROM people WHERE deleted_at IS NULL ORDER BY id"),
    query<AttendanceRow>(
      `SELECT a.id, a.person_id, a.year,
              CASE WHEN h.deleted_at IS NULL THEN a.invited_by_id END AS invited_by_id
         FROM attendances a
         JOIN people p ON p.id = a.person_id AND p.deleted_at IS NULL
         LEFT JOIN people h ON h.id = a.invited_by_id
        ORDER BY a.year, a.id`,
    ),
  ])

  const people: Person[] = personRows.map((r) => ({ id: r.id, name: r.name }))
  const attendances: Attendance[] = attendanceRows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    year: r.year,
    invitedById: r.invited_by_id,
  }))

  const body: GraphData = { people, attendances, demo: false }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}
