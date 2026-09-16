"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { editionNumber } from "@/lib/config"
import { nameKey, tidyName } from "@/lib/names"
import type { Attendance, Person, Pick } from "@/lib/types"

export type { Pick }

type Props = {
  people: Person[]
  attendances: Attendance[]
  value: Pick | null
  onChange: (value: Pick | null) => void
  placeholder?: string
  /** Hide this person from the results (e.g. you can't bring yourself). */
  excludeId?: number | null
  /** Offer a "nobody brought me" option. */
  allowNone?: boolean
  noneLabel?: string
  autoFocus?: boolean
}

type Hit = {
  person: Person
  years: number[]
  broughtBy: string[]
  brought: string[]
}

/** "Y2–Y6, Y8" style summary of attended editions. */
export function summarizeYears(years: number[]): string {
  if (years.length === 0) {
    return "no years yet"
  }
  const eds = [...new Set(years.map(editionNumber))].sort((a, b) => a - b)
  const parts: string[] = []
  let start = eds[0]
  let prev = eds[0]
  for (let i = 1; i <= eds.length; i++) {
    const e = eds[i]
    if (e === prev + 1) {
      prev = e
      continue
    }
    parts.push(start === prev ? `Y${start}` : `Y${start}–Y${prev}`)
    start = e
    prev = e
  }
  return parts.join(", ")
}

/**
 * Type-ahead for choosing an existing person or creating a new one. Names are
 * unique, so matches show attended years and who brought / was brought by them
 * to confirm it's the right person, and an exact-name clash blocks "add new".
 */
export default function PersonPicker({
  people,
  attendances,
  value,
  onChange,
  placeholder = "Type a name…",
  excludeId = null,
  allowNone = false,
  noneLabel = "Nobody — I got in on my own",
  autoFocus = false,
}: Props) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) {
      return []
    }
    const out: Hit[] = []
    for (const p of people) {
      if (p.id === excludeId) {
        continue
      }
      const full = p.name.toLowerCase()
      if (!(full.startsWith(needle) || full.split(/\s+/).some((w) => w.startsWith(needle)))) {
        continue
      }
      const years: number[] = []
      const broughtBy = new Set<string>()
      const brought = new Set<string>()
      for (const a of attendances) {
        if (a.personId === p.id) {
          years.push(a.year)
          if (a.invitedById != null) {
            broughtBy.add(nameById.get(a.invitedById) ?? "?")
          }
        } else if (a.invitedById === p.id) {
          brought.add(nameById.get(a.personId) ?? "?")
        }
      }
      out.push({ person: p, years, broughtBy: [...broughtBy], brought: [...brought] })
    }
    out.sort((a, b) => {
      const ax = a.person.name.toLowerCase() === needle ? 0 : 1
      const bx = b.person.name.toLowerCase() === needle ? 0 : 1
      if (ax !== bx) {
        return ax - bx
      }
      return a.person.name.localeCompare(b.person.name) || a.person.id - b.person.id
    })
    return out.slice(0, 8)
  }, [q, people, attendances, nameById, excludeId])

  const typed = tidyName(q)
  const exact = typed ? people.find((p) => nameKey(p.name) === nameKey(typed)) : undefined
  const canCreate = typed.length > 0 && !exact
  // Menu rows in order: hits, then "create", then "none".
  const rowCount = hits.length + (canCreate ? 1 : 0) + (allowNone ? 1 : 0)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const choose = (pick: Pick) => {
    onChange(pick)
    setQ("")
    setActive(0)
    setOpen(false)
  }

  const activateRow = (i: number) => {
    if (i < hits.length) {
      return choose({ kind: "existing", id: hits[i].person.id })
    }
    let j = hits.length
    if (canCreate) {
      if (i === j) {
        return choose({ kind: "new", name: typed })
      }
      j++
    }
    if (allowNone && i === j) {
      return choose({ kind: "none" })
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(rowCount - 1, a + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === "Enter") {
      if (rowCount > 0) {
        e.preventDefault()
        activateRow(active)
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  // ----- render: chosen value -----
  if (value) {
    let label: React.ReactNode
    let cls = ""
    if (value.kind === "existing") {
      const p = people.find((x) => x.id === value.id)
      const years = attendances.filter((a) => a.personId === value.id).map((a) => a.year)
      label = p ? (
        <>
          {p.name}
          <small>{summarizeYears(years)}</small>
        </>
      ) : (
        "(unknown)"
      )
    } else if (value.kind === "new") {
      cls = "new"
      label = value.name
    } else {
      cls = "none"
      label = noneLabel
    }
    return (
      <div className="picker">
        <div className={`chip ${cls}`}>
          <span className="who">{label}</span>
          <button
            type="button"
            className="btn tiny"
            onClick={() => {
              onChange(null)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            aria-label="Change"
          >
            change
          </button>
        </div>
      </div>
    )
  }

  // ----- render: search input -----
  return (
    <div className="picker" ref={rootRef}>
      <input
        ref={inputRef}
        className="field"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={q}
        maxLength={60}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0) // new results, so highlight the first one again
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && (typed || allowNone) ? (
        <ul className="menu" id={listId} role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.person.id}
              role="option"
              aria-selected={active === i}
              className={active === i ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => activateRow(i)}
            >
              {h.person.name}
              <span className="meta">
                {summarizeYears(h.years)}
                {h.broughtBy.length ? ` · brought by ${h.broughtBy.join(", ")}` : ""}
                {h.brought.length ? ` · brought ${h.brought.join(", ")}` : ""}
              </span>
            </li>
          ))}
          {canCreate ? (
            <li
              role="option"
              aria-selected={active === hits.length}
              className={`create ${active === hits.length ? "active" : ""}`}
              onMouseEnter={() => setActive(hits.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => activateRow(hits.length)}
            >
              + {hits.length ? "None of these — add" : "Add"} “{typed}” as a new person
            </li>
          ) : null}
          {exact && exact.id !== excludeId ? (
            <li className="empty">
              “{exact.name}” is taken. Not you? Add an initial, e.g. “{exact.name} K”.
            </li>
          ) : null}
          {exact && exact.id === excludeId ? (
            <li className="empty">That&apos;s you — you can&apos;t bring yourself.</li>
          ) : null}
          {allowNone ? (
            <li
              role="option"
              aria-selected={active === rowCount - 1}
              className={`none-opt ${active === rowCount - 1 ? "active" : ""}`}
              onMouseEnter={() => setActive(rowCount - 1)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => activateRow(rowCount - 1)}
            >
              {noneLabel}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
