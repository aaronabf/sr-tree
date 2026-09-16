"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import AddForm from "./AddForm"
import InviteGraph, { type CenterRequest } from "./InviteGraph"
import PersonPanel from "./PersonPanel"
import Win95Window from "./Win95Window"
import { yearColor, yearShort } from "@/lib/config"
import type { GraphData } from "@/lib/types"

const TICKER =
  "★ WHO BROUGHT YOU? ★ ADD YOURSELF TO THE SUSTAIN-RELEASE FAMILY TREE ★ ONE GUEST PER PERSON PER YEAR ★ " +
  "EACH ROW IS A YEAR ★ DRAG THE NODES ★ SCROLL TO ZOOM ★ CLICK A NAME TO SEE THEIR LINEAGE ★ " +
  "BEST VIEWED IN NETSCAPE NAVIGATOR 4.0 ★ SEE YOU IN THE WOODS ★"

const PHONE_QUERY = "(max-width: 760px)"

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

/** True on narrow screens; false during server render. */
function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}

export default function App() {
  const [data, setData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setSelectedId] = useState<number | null>(null)
  const [activeYears, setActiveYears] = useState<Set<number> | null>(null)
  const [centerOn, setCenterOn] = useState<CenterRequest | null>(null)
  const phone = useIsPhone()
  // null until the viewer toggles it. Phones start collapsed so the form
  // doesn't cover the tree.
  const [addMinimizedChoice, setAddMinimizedChoice] = useState<boolean | null>(null)
  const addMinimized = addMinimizedChoice ?? phone

  // If an edit removed the selected person, their panel closes.
  const selectedId = data && picked != null && !data.people.some((p) => p.id === picked) ? null : picked

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/graph", { cache: "no-store" })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      setData((await res.json()) as GraphData)
      setError(null)
    } catch {
      setError("Couldn't load the tree. Refresh to try again.")
    }
  }, [])

  useEffect(() => {
    // Initial fetch. State is set after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const years = useMemo(
    () => (data ? [...new Set(data.attendances.map((a) => a.year))].sort((a, b) => a - b) : []),
    [data],
  )

  const stats = useMemo(() => {
    if (!data) {
      return { heads: 0, invites: 0 }
    }
    const attended = new Set(data.attendances.map((a) => a.personId))
    return {
      heads: attended.size,
      invites: data.attendances.filter((a) => a.invitedById != null).length,
    }
  }, [data])

  // On phones the two windows stack at the bottom and together overflow the
  // screen, so keep only one of them open at a time.
  const select = useCallback(
    (id: number | null) => {
      setSelectedId(id)
      if (id != null && phone) {
        setAddMinimizedChoice(true)
      }
    },
    [phone],
  )

  const focus = useCallback(
    (id: number) => {
      select(id)
      setCenterOn({ id, nonce: Date.now() })
    },
    [select],
  )

  const toggleAddForm = () => {
    if (addMinimized && phone) {
      setSelectedId(null)
    }
    setAddMinimizedChoice(!addMinimized)
  }

  const onAdded = useCallback(
    async (personId: number) => {
      await load()
      focus(personId)
    },
    [load, focus],
  )

  const toggleYear = (y: number) => {
    setActiveYears((prev) => {
      if (prev == null) {
        return new Set([y]) // solo it
      }
      const next = new Set(prev)
      if (next.has(y)) {
        next.delete(y)
      } else {
        next.add(y)
      }
      if (next.size === 0 || next.size === years.length) {
        return null
      }
      return next
    })
  }

  const digits = String(stats.heads).padStart(5, "0").split("")

  return (
    <div className="app">
      <div className="stars" aria-hidden />
      <div className="horizon" aria-hidden />
      <div className="floor" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <h1>SUSTAIN-RELEASE</h1>
          <span className="sub">
            family tree<span className="blink">_</span>
          </span>
        </div>
        <div className="marquee" aria-hidden>
          <span>{TICKER}</span>
        </div>
        {data ? <FindBox data={data} onPick={focus} /> : null}
        <div className="counter" title="People on the tree">
          <span>HEADS</span>
          <span className="digits">
            {digits.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </span>
        </div>
      </header>

      <div className="stage">
        {data ? (
          <InviteGraph
            data={data}
            selectedId={selectedId}
            activeYears={activeYears}
            centerOn={centerOn}
            onSelect={select}
          />
        ) : null}

        {!data && !error ? <div className="loading">LOADING TREE…</div> : null}

        {error ? (
          <div className="empty-state">
            <Win95Window title="ERROR.LOG" icon="⚠️">
              <p>{error}</p>
            </Win95Window>
          </div>
        ) : null}

        {data && data.people.length === 0 ? (
          <div className="empty-state">
            <Win95Window title="README.TXT" icon="📄">
              <p>The tree is empty. Nobody has claimed OG status yet.</p>
              <p>Be the first: add yourself on the left, then tell your crew.</p>
            </Win95Window>
          </div>
        ) : null}

        <div className="hud">
          <div className="dock-left">
            {data ? (
              <Win95Window
                title="ADD_YOURSELF.EXE"
                icon="💾"
                minimized={addMinimized}
                onMinimize={toggleAddForm}
              >
                <AddForm data={data} onAdded={onAdded} />
              </Win95Window>
            ) : null}
          </div>

          <div className="dock-right">
            {data && selectedId != null ? (
              <Win95Window title="PERSON.TXT" icon="📄" onClose={() => setSelectedId(null)}>
                {/* Keyed so edit state resets when switching people. */}
                <PersonPanel
                  key={selectedId}
                  personId={selectedId}
                  data={data}
                  onSelect={focus}
                  onChanged={load}
                />
              </Win95Window>
            ) : null}
          </div>

          <div className="dock-bottom">
            <div className="legend" role="group" aria-label="Filter by year">
              <button
                type="button"
                className="yr all"
                aria-pressed={activeYears == null}
                onClick={() => setActiveYears(null)}
              >
                ALL
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  className="yr"
                  style={{ color: yearColor(y) }}
                  aria-pressed={activeYears == null || activeYears.has(y)}
                  onClick={() => toggleYear(y)}
                  title={activeYears == null ? `Show only ${y}` : `Toggle ${y}`}
                >
                  <span className="sw" aria-hidden />
                  {yearShort(y)}
                </button>
              ))}
            </div>

            <div className="badges">
              {data?.demo ? <span className="badge demo">DEMO DATA · no database connected</span> : null}
              <span className="badge hint-badge">drag nodes · dbl-click to unpin · scroll to zoom</span>
              <span className="badge">{stats.invites} invites</span>
            </div>
          </div>
        </div>
      </div>

      <div className="scanlines" aria-hidden />
      <div className="vignette" aria-hidden />
    </div>
  )
}

function FindBox({ data, onPick }: { data: GraphData; onPick: (id: number) => void }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) {
      return []
    }
    return data.people
      .filter((p) => {
        const full = p.name.toLowerCase()
        return full.startsWith(needle) || full.split(/\s+/).some((w) => w.startsWith(needle))
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [q, data.people])

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

  const pick = (id: number) => {
    onPick(id)
    setQ("")
    setOpen(false)
  }

  return (
    <div className="find" ref={rootRef}>
      <input
        className="field"
        placeholder="find a name…"
        value={q}
        autoComplete="off"
        spellCheck={false}
        aria-label="Find a person"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            pick(hits[0].id)
          }
          if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />
      {open && q.trim() ? (
        <ul className="menu" role="listbox">
          {hits.length === 0 ? <li className="empty">no one by that name</li> : null}
          {hits.map((p) => (
            <li
              key={p.id}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p.id)}
            >
              {p.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
