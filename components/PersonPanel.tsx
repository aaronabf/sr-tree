"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useConfirm } from "./ConfirmDialog"
import PersonPicker from "./PersonPicker"
import { mutate, toRef } from "@/lib/api-client"
import { festivalYears, yearColor, yearLabel } from "@/lib/config"
import type {
  AddAttendanceRequest,
  Attendance,
  GraphData,
  PersonRef,
  Pick,
  RenamePersonRequest,
  UpdateAttendanceRequest,
} from "@/lib/types"

type Props = {
  personId: number
  data: GraphData
  onSelect: (id: number) => void
  /** Called after any successful edit so the tree can reload. */
  onChanged: () => Promise<void> | void
}

type Editing = { kind: "row"; attendanceId: number } | { kind: "new" } | null

export default function PersonPanel({ personId, data, onSelect, onChanged }: Props) {
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [editing, setEditing] = useState<Editing>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm()
  // The parent keys this component by personId, so all of the above resets
  // when switching people.

  // Errors render at the bottom of a scrolling window body; bring them on screen.
  const errRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (err) {
      errRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [err])

  const info = useMemo(() => {
    const person = data.people.find((p) => p.id === personId)
    if (!person) {
      return null
    }

    const mine = data.attendances.filter((a) => a.personId === personId).sort((a, b) => a.year - b.year)
    const brought = data.attendances.filter((a) => a.invitedById === personId).sort((a, b) => a.year - b.year)

    // Generation: 0 for people nobody brought; otherwise 1 + generation of the
    // person who brought them in their first year. Guards against cycles.
    const firstInviter = new Map<number, number | null>()
    for (const a of [...data.attendances].sort((x, y) => x.year - y.year)) {
      if (!firstInviter.has(a.personId)) {
        firstInviter.set(a.personId, a.invitedById)
      }
    }
    const generation = (id: number, seen = new Set<number>()): number => {
      const inv = firstInviter.get(id)
      if (inv == null || seen.has(id)) {
        return 0
      }
      seen.add(id)
      return 1 + generation(inv, seen)
    }

    // Descendants: everyone downstream of this person via any-year invites.
    const kids = new Map<number, Set<number>>()
    for (const a of data.attendances) {
      if (a.invitedById == null) {
        continue
      }
      const s = kids.get(a.invitedById) ?? new Set<number>()
      s.add(a.personId)
      kids.set(a.invitedById, s)
    }
    const seen = new Set<number>()
    const stack = [personId]
    while (stack.length) {
      const cur = stack.pop()!
      for (const k of kids.get(cur) ?? []) {
        if (!seen.has(k) && k !== personId) {
          seen.add(k)
          stack.push(k)
        }
      }
    }

    return {
      person,
      mine,
      brought,
      generation: generation(personId),
      descendants: seen.size,
      firstYear: mine[0]?.year ?? null,
    }
  }, [data, personId])

  if (!info) {
    return <p className="muted">This person isn&apos;t on the tree any more.</p>
  }

  const { person, mine, brought, generation, descendants, firstYear } = info
  const nameOf = (id: number) => data.people.find((p) => p.id === id)?.name ?? "?"

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setErr(null)
    const e = await fn()
    setBusy(false)
    if (e) {
      setErr(e)
      return false
    }
    await onChanged()
    return true
  }

  const saveName = async () => {
    const body: RenamePersonRequest = { name: nameDraft.trim() }
    if (!body.name) {
      return setErr("Name can't be empty.")
    }
    if (await run(() => mutate(`/api/people/${person.id}`, "PATCH", body))) {
      setRenaming(false)
    }
  }

  const deletePerson = async () => {
    const yearsNote = mine.length
      ? `Their ${mine.length === 1 ? "year" : `${mine.length} years`} will be removed from the tree.`
      : "They have no years recorded."
    const broughtNote = brought.length
      ? ` The ${brought.length === 1 ? "person" : `${brought.length} people`} they brought will stay, marked as brought by nobody.`
      : ""
    const ok = await confirm({
      title: "Delete person",
      message: `Delete ${person.name} from the tree?\n\n${yearsNote}${broughtNote}\n\nAn admin can restore them if this was a mistake.`,
      confirmLabel: "Delete",
      danger: true,
    })
    if (!ok) {
      return
    }
    // On success the tree reloads without this person and the panel closes itself.
    await run(() => mutate(`/api/people/${person.id}`, "DELETE"))
  }

  return (
    <div>
      {renaming ? (
        <div className="editor">
          <label className="label" htmlFor="rename">
            Rename
          </label>
          <input
            id="rename"
            className="field"
            value={nameDraft}
            maxLength={60}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void saveName()
              }
              if (e.key === "Escape") {
                setRenaming(false)
              }
            }}
          />
          <div className="hint">Names are unique. Add an initial or use a nickname if yours is taken.</div>
          <div className="row-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void saveName()}>
              Save
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="person-head">
          <h2 className="person-name">{person.name}</h2>
          <button
            type="button"
            className="btn tiny"
            title="Rename"
            onClick={() => {
              setNameDraft(person.name)
              setRenaming(true)
              setEditing(null)
              setErr(null)
            }}
          >
            rename
          </button>
          <button
            type="button"
            className="btn tiny danger"
            title="Delete this person"
            disabled={busy}
            onClick={() => void deletePerson()}
          >
            delete
          </button>
        </div>
      )}

      <dl className="person-stats">
        <dt>First year</dt>
        <dd>{firstYear != null ? yearLabel(firstYear) : "—"}</dd>
        <dt>Years</dt>
        <dd>{mine.length}</dd>
        <dt>Generation</dt>
        <dd>{generation === 0 ? "OG (gen 0)" : `gen ${generation}`}</dd>
        <dt>Brought</dt>
        <dd>
          {brought.length} {brought.length === 1 ? "person" : "people"}
          {descendants > brought.length ? ` · ${descendants} downstream` : ""}
        </dd>
      </dl>

      <div className="label">History</div>
      {mine.length === 0 ? <p className="muted">No years recorded yet.</p> : null}
      {mine.map((a) => {
        const gave = brought.find((b) => b.year === a.year)
        const isEditing = editing?.kind === "row" && editing.attendanceId === a.id
        return (
          <div key={a.id}>
            <div className="year-row">
              <span className="year-pill" style={{ background: yearColor(a.year) }}>
                {yearLabel(a.year)}
              </span>
              <span className="year-text">
                {a.invitedById != null ? (
                  <>
                    brought by{" "}
                    <button type="button" className="linkname" onClick={() => onSelect(a.invitedById!)}>
                      {nameOf(a.invitedById)}
                    </button>
                  </>
                ) : a.year === firstYear ? (
                  <span className="muted">got in on their own</span>
                ) : (
                  <span className="muted">came back</span>
                )}
                {gave ? (
                  <>
                    {" · brought "}
                    <button type="button" className="linkname" onClick={() => onSelect(gave.personId)}>
                      {nameOf(gave.personId)}
                    </button>
                  </>
                ) : a.invitedById == null ? (
                  // Only meaningful on a year they weren't brought: you can't
                  // bring a guest the same year someone brought you.
                  <span className="muted"> · brought nobody</span>
                ) : null}
              </span>
              {!isEditing ? (
                <button
                  type="button"
                  className="btn tiny"
                  title="Edit this year"
                  onClick={() => {
                    setEditing({ kind: "row", attendanceId: a.id })
                    setRenaming(false)
                    setErr(null)
                  }}
                >
                  edit
                </button>
              ) : null}
            </div>
            {isEditing ? (
              <RowEditor
                key={a.id}
                data={data}
                personId={personId}
                row={a}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={async (year, inviter, guest) => {
                  const body: UpdateAttendanceRequest = { year, inviter, guest }
                  if (await run(() => mutate(`/api/attendances/${a.id}`, "PATCH", body))) {
                    setEditing(null)
                  }
                }}
                onDelete={async () => {
                  const ok = await confirm({
                    title: "Delete year",
                    message: `Remove ${person.name}'s ${yearLabel(a.year)} entry?`,
                    confirmLabel: "Delete",
                    danger: true,
                  })
                  if (!ok) {
                    return
                  }
                  if (await run(() => mutate(`/api/attendances/${a.id}`, "DELETE"))) {
                    setEditing(null)
                  }
                }}
              />
            ) : null}
          </div>
        )
      })}

      {editing?.kind === "new" ? (
        <RowEditor
          data={data}
          personId={personId}
          row={null}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (year, inviter, guest) => {
            const body: AddAttendanceRequest = { person: { id: personId }, year, inviter, guest }
            if (await run(() => mutate("/api/attendances", "POST", body))) {
              setEditing(null)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="btn block"
          disabled={busy}
          onClick={() => {
            setEditing({ kind: "new" })
            setRenaming(false)
            setErr(null)
          }}
        >
          + Add a year for {person.name}
        </button>
      )}

      {err ? (
        <div ref={errRef} className="msg err" role="alert">
          {err}
        </div>
      ) : null}

      {dialog}
    </div>
  )
}

function RowEditor({
  data,
  personId,
  row,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  data: GraphData
  personId: number
  row: Attendance | null
  busy: boolean
  onSave: (year: number, inviter: PersonRef | null, guest: PersonRef | null) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel: () => void
}) {
  // A row can hold a year that's no longer pickable (next year, before it was
  // announced); keep it in the list so the editor still shows and saves it.
  const base = festivalYears()
  const years = row && !base.includes(row.year) ? [row.year, ...base].sort((a, b) => b - a) : base
  const [year, setYear] = useState<number>(
    row?.year ?? years.find((y) => y <= new Date().getFullYear()) ?? years[0],
  )
  const [inviter, setInviter] = useState<Pick | null>(
    row ? (row.invitedById != null ? { kind: "existing", id: row.invitedById } : { kind: "none" }) : null,
  )
  // Who they brought that year, i.e. the guest's own attendance row pointing at them.
  const gave = row ? data.attendances.find((a) => a.invitedById === personId && a.year === row.year) : null
  // null = picker open, waiting for a choice (after "change").
  const [guest, setGuest] = useState<Pick | null>(
    gave ? { kind: "existing", id: gave.personId } : { kind: "none" },
  )

  const bothWays = inviter != null && inviter.kind !== "none" && guest != null && guest.kind !== "none"
  const guestMoves =
    row != null &&
    gave != null &&
    year !== row.year &&
    guest?.kind === "existing" &&
    guest.id === gave.personId
  const nameOf = (id: number) => data.people.find((p) => p.id === id)?.name ?? "?"

  // A year after their earliest other year is a return visit, so "nobody
  // brought them" means they just came back, not that they're an OG.
  const otherYears = data.attendances
    .filter((a) => a.personId === personId && a.id !== row?.id)
    .map((a) => a.year)
  const returning = otherYears.length > 0 && year > Math.min(...otherYears)

  return (
    <div className="editor">
      <label className="label">Year</label>
      <select className="field" value={year} onChange={(e) => setYear(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {yearLabel(y)}
          </option>
        ))}
      </select>
      <label className="label">Who brought them that year?</label>
      <PersonPicker
        people={data.people}
        attendances={data.attendances}
        value={inviter}
        onChange={setInviter}
        placeholder="Their name…"
        excludeId={personId}
        allowNone
        noneLabel={returning ? "Nobody — they just came back" : "Nobody — got in on their own"}
      />
      {returning && inviter === null ? (
        <div className="hint">
          Already on the tree from an earlier year? Pick &ldquo;Nobody&rdquo; if they came back on their own.
        </div>
      ) : null}
      <label className="label">Who did they bring that year?</label>
      <PersonPicker
        people={data.people}
        attendances={data.attendances}
        value={guest}
        onChange={setGuest}
        placeholder="Their guest's name…"
        excludeId={personId}
        allowNone
        noneLabel="Nobody"
      />
      {bothWays ? (
        <div className="hint">
          You can&apos;t be brought and bring a guest in the same year. Set one of them to
          &ldquo;Nobody&rdquo;.
        </div>
      ) : null}
      {guestMoves && gave ? (
        <div className="hint">
          {nameOf(gave.personId)} moves to {yearLabel(year)} with them.
        </div>
      ) : null}
      <div className="row-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy || inviter === null || guest === null || bothWays}
          onClick={() => void onSave(year, toRef(inviter!), toRef(guest!))}
        >
          Save
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {onDelete ? (
          <button type="button" className="btn danger" disabled={busy} onClick={() => void onDelete()}>
            Delete
          </button>
        ) : null}
      </div>
    </div>
  )
}
