"use client"

import { useEffect, useRef, useState } from "react"
import PersonPicker from "./PersonPicker"
import { request, toRef } from "@/lib/api-client"
import { defaultYear, festivalYears, yearLabel } from "@/lib/config"
import type { AddAttendanceRequest, AddAttendanceResponse, GraphData, Pick } from "@/lib/types"

type Props = {
  data: GraphData
  onAdded: (personId: number) => void
}

export default function AddForm({ data, onAdded }: Props) {
  const [me, setMe] = useState<Pick | null>(null)
  const [year, setYear] = useState<number>(defaultYear())
  const [inviter, setInviter] = useState<Pick | null>(null)
  // Optional; defaults to "nobody" so the common case stays three steps.
  const [guest, setGuest] = useState<Pick | null>({ kind: "none" })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  // The form is taller than the window body, so a message at the bottom can
  // land out of view. Bring it on screen whenever one appears.
  const msgRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (msg) {
      msgRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [msg])

  const years = festivalYears()
  const bothWays = inviter != null && inviter.kind !== "none" && guest != null && guest.kind !== "none"

  /** Why the form can't be sent yet, or null. Shown on submit rather than disabling the button. */
  const problem = (): string | null => {
    if (!me || me.kind === "none") {
      return "Step 1: pick your name, or add yourself as a new person."
    }
    if (!inviter) {
      return "Step 3: say who brought you that year, or pick “Nobody”."
    }
    if (!guest) {
      return "Step 4: say who you brought that year, or pick “Nobody”."
    }
    if (bothWays) {
      return "You can't be brought and bring a guest in the same year. Set step 3 or step 4 to “Nobody”."
    }
    return null
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) {
      return
    }
    const why = problem()
    if (why || !me || !inviter || !guest) {
      setMsg({ kind: "err", text: why ?? "Something's missing above." })
      return
    }
    const person = toRef(me)
    if (!person) {
      setMsg({ kind: "err", text: "Step 1: pick your name, or add yourself as a new person." })
      return
    }

    setBusy(true)
    setMsg(null)
    const body: AddAttendanceRequest = { person, year, inviter: toRef(inviter), guest: toRef(guest) }
    const res = await request<AddAttendanceResponse & { ok: true }>("/api/attendances", "POST", body)
    setBusy(false)
    if (!res.ok) {
      setMsg({ kind: "err", text: res.error })
      return
    }
    setMsg({
      kind: "ok",
      text: `Saved. You're on the tree for ${yearLabel(year)}. Went another year? Add it too.`,
    })
    // Keep "who are you" so a second year is one click away.
    setMe({ kind: "existing", id: res.personId })
    setInviter(null)
    setGuest({ kind: "none" })
    onAdded(res.personId)
  }

  const meId = me?.kind === "existing" ? me.id : null

  // If they're already on the tree for an earlier year, this is a return visit:
  // "nobody brought me" means they came back, not that they're an OG.
  const meYears = meId != null ? data.attendances.filter((a) => a.personId === meId).map((a) => a.year) : []
  const returning = meYears.length > 0 && year > Math.min(...meYears)

  return (
    <form onSubmit={submit} noValidate>
      <label className="label">1. Who are you?</label>
      <PersonPicker
        people={data.people}
        attendances={data.attendances}
        value={me}
        onChange={(v) => {
          setMe(v)
          setMsg(null)
        }}
        placeholder="Your name…"
      />
      {!me ? (
        <div className="hint">
          First name is fine. Names are unique, so if there&apos;s already an Alice who isn&apos;t you, go by
          &ldquo;Alice K&rdquo; or a nickname. Already listed? Pick yourself.
        </div>
      ) : null}

      <label className="label" htmlFor="year">
        {returning ? "2. Which year did you go?" : "2. Which year were you invited?"}
      </label>
      <select id="year" className="field" value={year} onChange={(e) => setYear(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {yearLabel(y)}
          </option>
        ))}
      </select>
      <div className="hint">
        {returning
          ? "You're already on the tree from an earlier year, so this is a return visit. Add each year separately."
          : "The year you went as someone's guest. Went more than once? Add each year separately."}
      </div>

      <label className="label">3. Who brought you that year?</label>
      <PersonPicker
        people={data.people}
        attendances={data.attendances}
        value={inviter}
        onChange={(v) => {
          setInviter(v)
          setMsg(null)
        }}
        placeholder="Their name…"
        excludeId={meId}
        allowNone
        noneLabel={returning ? "Nobody — I just came back" : "Nobody — I got in on my own"}
      />
      {!inviter ? (
        <div className="hint">
          {returning
            ? "Came back on your own and brought nobody? Pick “Nobody”. Otherwise type who brought you."
            : "Not on the tree yet? Type their name and add them. We'll pencil them in for the year before too; they can fix their history later."}
        </div>
      ) : null}

      <label className="label">4. Who did you bring that year?</label>
      <PersonPicker
        people={data.people}
        attendances={data.attendances}
        value={guest}
        onChange={(v) => {
          setGuest(v)
          setMsg(null)
        }}
        placeholder="Your guest's name…"
        excludeId={meId}
        allowNone
        noneLabel="Nobody"
      />
      {bothWays ? (
        <div className="hint">
          You can&apos;t be brought and bring a guest in the same year. Set one of them to
          &ldquo;Nobody&rdquo;.
        </div>
      ) : null}

      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? "Saving…" : "Add me to the tree"}
      </button>

      {msg ? (
        <div ref={msgRef} className={`msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </div>
      ) : null}
      {data.demo ? (
        <div className="msg err" role="status">
          Demo mode: no database connected, so entries won&apos;t save.
        </div>
      ) : null}
    </form>
  )
}
