"use client"

import { useEffect, useRef } from "react"
import {
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force"
import { hierarchy, tree } from "d3-hierarchy"
import { select } from "d3-selection"
import { drag, type D3DragEvent } from "d3-drag"
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from "d3-zoom"
import "d3-transition"
import { festivalYearsAsc, yearColor, yearLabel } from "@/lib/config"
import type { GraphData } from "@/lib/types"

export type CenterRequest = { id: number; nonce: number }

type Props = {
  data: GraphData
  selectedId: number | null
  /** null = every year visible */
  activeYears: Set<number> | null
  centerOn: CenterRequest | null
  onSelect: (id: number | null) => void
}

type GNode = SimulationNodeDatum & {
  id: number
  name: string
  out: number
  firstYear: number
  root: boolean
  years: Set<number>
  r: number
  /** Layout target (tidy-tree x, year-row y). */
  tx: number
  ty: number
  pinned: boolean
}

type GLink = {
  id: number
  year: number
  source: GNode
  target: GNode
  /** The invite that places `target` in the tree (their first year). */
  primary: boolean
}

type Row = { year: number; y: number }

/** Append to the array under `key`, creating it on first use. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    list.push(value)
  } else {
    map.set(key, [value])
  }
}

const ROW_H = 150 // vertical distance between year rows
const NODE_W = 92 // horizontal slot per leaf in the tidy tree

/**
 * Invite lineage drawn as a layered family tree: each row is a festival year,
 * people sit in the row of the year they first came, and a tidy-tree layout
 * puts everyone under whoever brought them. A light force simulation keeps
 * nodes from overlapping and makes them draggable; drag pins a node, double
 * click unpins it. React owns the <svg>; d3 owns everything inside it.
 */
export default function InviteGraph({ data, selectedId, activeYears, centerOn, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<GNode, undefined> | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<Map<number, GNode>>(new Map())
  const fittedRef = useRef(false)
  const userZoomedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // ----- one-time: zoom + background click -----
  useEffect(() => {
    const svgEl = svgRef.current
    const wrapEl = wrapRef.current
    if (!svgEl || !wrapEl) {
      return
    }
    const svg = select(svgEl)
    const viewport = svg.select<SVGGElement>("g.viewport")
    const wrap = select(wrapEl)

    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.06, 6])
      .on("zoom", (event) => {
        if (event.sourceEvent) {
          userZoomedRef.current = true
        }
        viewport.attr("transform", event.transform.toString())
        wrap.classed("zoomed", event.transform.k >= 1.25)
      })
    svg.call(z)
    zoomRef.current = z

    svg.on("click", (event: MouseEvent) => {
      const t = event.target as Element
      if (t === svgEl || t.classList.contains("bg")) {
        onSelectRef.current(null)
      }
    })

    // Until the viewer pans/zooms themselves, keep the whole tree in view when
    // the window (or phone orientation) changes size.
    const ro = new ResizeObserver(() => {
      if (userZoomedRef.current || nodesRef.current.size === 0) {
        return
      }
      fitToView(svgEl, z, [...nodesRef.current.values()])
    })
    ro.observe(wrapEl)

    return () => {
      ro.disconnect()
      svg.on(".zoom", null).on("click", null)
    }
  }, [])

  // ----- build / update graph when data changes -----
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) {
      return
    }
    const svg = select(svgEl)
    const viewport = svg.select<SVGGElement>("g.viewport")

    const { nodes, links, rows } = buildLayout(data, nodesRef.current)
    nodesRef.current = new Map(nodes.map((n) => [n.id, n]))
    const yearsPresent = [...new Set(links.map((l) => l.year))].sort()

    // ---- defs: one arrowhead per year ----
    svg
      .select("defs")
      .selectAll<SVGMarkerElement, number>("marker.arrow")
      .data(yearsPresent, (d) => String(d))
      .join((enter) => {
        const m = enter
          .append("marker")
          .attr("class", "arrow")
          .attr("viewBox", "-1 -5 10 10")
          .attr("refX", 8)
          .attr("refY", 0)
          .attr("markerWidth", 8)
          .attr("markerHeight", 8)
          .attr("markerUnits", "userSpaceOnUse")
          .attr("orient", "auto")
        m.append("path").attr("d", "M0,-4L8,0L0,4Z")
        return m
      })
      .attr("id", (d) => `arrow-${d}`)
      .select("path")
      .attr("fill", (d) => yearColor(d))

    // ---- year rows ----
    const rowSel = viewport
      .select("g.rows")
      .selectAll<SVGGElement, Row>("g.row")
      .data(rows, (d) => String(d.year))
      .join((enter) => {
        const g = enter.append("g").attr("class", "row")
        g.append("line")
        g.append("text").attr("dy", -6)
        return g
      })
    rowSel.select("text").text((d) => yearLabel(d.year).toUpperCase())

    // ---- links ----
    const linkSel = viewport
      .select("g.links")
      .selectAll<SVGPathElement, GLink>("path")
      .data(links, (d) => String(d.id))
      .join("path")
      .attr("class", (d) => `link ${d.primary ? "" : "secondary"}`)
      .attr("stroke", (d) => yearColor(d.year))
      .style("color", (d) => yearColor(d.year))
      .attr("marker-end", (d) => `url(#arrow-${d.year})`)
    linkSel.selectAll("title").remove()
    linkSel.append("title").text((d) => `${d.source.name} brought ${d.target.name} · ${yearLabel(d.year)}`)

    const labelSel = viewport
      .select("g.link-labels")
      .selectAll<SVGTextElement, GLink>("text")
      .data(links, (d) => String(d.id))
      .join("text")
      .attr("class", "link-label")
      .attr("text-anchor", "middle")
      .attr("dy", -3)
      .text((d) => String(d.year))

    // ---- nodes ----
    const nodeSel = viewport
      .select("g.nodes")
      .selectAll<SVGGElement, GNode>("g.node")
      .data(nodes, (d) => String(d.id))
      .join((enter) => {
        const g = enter.append("g").attr("class", "node")
        g.append("circle").attr("class", "halo")
        g.append("circle").attr("class", "core")
        g.append("text").attr("text-anchor", "middle")
        return g
      })

    nodeSel.classed("root", (d) => d.root).classed("pinned", (d) => d.pinned)
    nodeSel
      .select<SVGCircleElement>("circle.core")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => yearColor(d.firstYear))
    nodeSel
      .select<SVGCircleElement>("circle.halo")
      .attr("r", (d) => d.r + 5)
      .attr("stroke", (d) => yearColor(d.firstYear))
    nodeSel
      .select<SVGTextElement>("text")
      .attr("dy", (d) => d.r + 16)
      .text((d) => d.name)
    nodeSel.selectAll("title").remove()
    nodeSel
      .append("title")
      .text(
        (d) =>
          `${d.name}\n${[...d.years].sort().map(yearLabel).join("\n") || "no years"}${d.root ? "\nOG" : ""}`,
      )

    nodeSel.on("click", (event: MouseEvent, d) => {
      event.stopPropagation()
      onSelectRef.current(d.id)
    })

    // ---- simulation: settle toward layout targets without overlapping ----
    simRef.current?.stop()
    const sim = forceSimulation<GNode>(nodes)
      .alphaDecay(0.04)
      .force("x", forceX<GNode>((d) => d.tx).strength(0.35))
      .force("y", forceY<GNode>((d) => d.ty).strength(1))
      .force(
        "collide",
        forceCollide<GNode>((d) => d.r + 24)
          .strength(0.9)
          .iterations(3),
      )
    simRef.current = sim

    const tick = () => {
      let minX = Infinity
      let maxX = -Infinity
      for (const n of nodes) {
        minX = Math.min(minX, n.x ?? 0)
        maxX = Math.max(maxX, n.x ?? 0)
      }
      if (!Number.isFinite(minX)) {
        minX = -200
        maxX = 200
      }
      rowSel
        .attr("transform", (d) => `translate(0,${d.y})`)
        .select("line")
        .attr("x1", minX - 170)
        .attr("x2", maxX + 170)
      rowSel.select("text").attr("x", minX - 176)

      linkSel.attr("d", (l) => linkPath(l.source, l.target))
      labelSel
        .attr("x", (l) => linkMid(l.source, l.target)[0])
        .attr("y", (l) => linkMid(l.source, l.target)[1])
      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    }
    sim.on("tick", tick)

    // ---- drag: pins the node; double-click unpins ----
    nodeSel.call(
      drag<SVGGElement, GNode>()
        .clickDistance(4)
        .on("start", (event: D3DragEvent<SVGGElement, GNode, GNode>, d) => {
          if (!event.active) {
            sim.alphaTarget(0.2).restart()
          }
          d.fx = d.x
          d.fy = d.y
        })
        .on("drag", (event: D3DragEvent<SVGGElement, GNode, GNode>, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on("end", (event: D3DragEvent<SVGGElement, GNode, GNode>, d) => {
          if (!event.active) {
            sim.alphaTarget(0)
          }
          d.pinned = true
          select(event.sourceEvent?.target?.closest?.("g.node") ?? null).classed("pinned", true)
        }),
    )
    nodeSel.on("dblclick", function (event: MouseEvent, d) {
      event.stopPropagation()
      d.fx = null
      d.fy = null
      d.pinned = false
      select(this).classed("pinned", false)
      sim.alpha(0.3).restart()
    })

    if (!fittedRef.current && nodes.length > 0) {
      // Settle synchronously so the first frame already looks like a tree.
      sim.tick(90)
      tick()
      fitToView(svgEl, zoomRef.current, nodes)
      fittedRef.current = true
    } else {
      sim.alpha(0.6)
    }
    sim.restart()

    return () => {
      sim.stop()
    }
  }, [data])

  // ----- highlight selection + year filter -----
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) {
      return
    }
    const viewport = select(svgEl).select<SVGGElement>("g.viewport")

    // Lineage: everyone up the chain of inviters and everyone downstream.
    const lineage = new Set<number>()
    if (selectedId != null) {
      const up = new Map<number, number[]>()
      const down = new Map<number, number[]>()
      for (const a of data.attendances) {
        if (a.invitedById == null) {
          continue
        }
        push(up, a.personId, a.invitedById)
        push(down, a.invitedById, a.personId)
      }
      lineage.add(selectedId)
      for (const dir of [up, down]) {
        const stack = [selectedId]
        const seen = new Set<number>([selectedId])
        while (stack.length) {
          const cur = stack.pop()!
          for (const n of dir.get(cur) ?? []) {
            if (!seen.has(n)) {
              seen.add(n)
              lineage.add(n)
              stack.push(n)
            }
          }
        }
      }
    }

    const nodeVisible = (d: GNode) =>
      activeYears == null || d.years.size === 0 || [...d.years].some((y) => activeYears.has(y))
    const linkVisible = (l: GLink) => activeYears == null || activeYears.has(l.year)
    const lit = (l: GLink) => selectedId != null && lineage.has(l.source.id) && lineage.has(l.target.id)

    viewport
      .selectAll<SVGGElement, GNode>("g.node")
      .classed("selected", (d) => d.id === selectedId)
      .classed("dim", (d) => !nodeVisible(d) || (selectedId != null && !lineage.has(d.id)))
    viewport
      .selectAll<SVGPathElement, GLink>("g.links path")
      .classed("lit", (l) => linkVisible(l) && lit(l))
      .classed("dim", (l) => !linkVisible(l) || (selectedId != null && !lit(l)))
    viewport
      .selectAll<SVGTextElement, GLink>("g.link-labels text")
      .classed("dim", (l) => !linkVisible(l) || (selectedId != null && !lit(l)))
    viewport
      .selectAll<SVGGElement, Row>("g.row")
      .classed("dim", (r) => activeYears != null && !activeYears.has(r.year))
  }, [data, selectedId, activeYears])

  // ----- fly to a node -----
  useEffect(() => {
    if (!centerOn || !svgRef.current || !zoomRef.current) {
      return
    }
    const node = nodesRef.current.get(centerOn.id)
    if (!node || node.x == null || node.y == null) {
      return
    }
    const svgEl = svgRef.current
    const { width, height } = svgEl.getBoundingClientRect()
    const k = Math.max(1.3, zoomTransform(svgEl).k)
    const t = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(k)
      .translate(-node.x, -node.y)
    select(svgEl).transition().duration(650).call(zoomRef.current.transform, t)
  }, [centerOn])

  return (
    <div className="graph" ref={wrapRef}>
      <svg ref={svgRef} role="img" aria-label="Invite family tree, one row per festival year">
        <defs />
        <rect className="bg" width="100%" height="100%" fill="transparent" />
        <g className="viewport">
          <g className="rows" />
          <g className="links" />
          <g className="link-labels" />
          <g className="nodes" />
        </g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ layout */

function buildLayout(data: GraphData, prev: Map<number, GNode>) {
  // Per-person facts.
  const outCount = new Map<number, number>()
  const yearsOf = new Map<number, Set<number>>()
  const firstInvite = new Map<number, { year: number; by: number }>()
  for (const a of [...data.attendances].sort((x, y) => x.year - y.year)) {
    const ys = yearsOf.get(a.personId) ?? new Set<number>()
    ys.add(a.year)
    yearsOf.set(a.personId, ys)
    if (a.invitedById != null) {
      outCount.set(a.invitedById, (outCount.get(a.invitedById) ?? 0) + 1)
      if (!firstInvite.has(a.personId)) {
        firstInvite.set(a.personId, { year: a.year, by: a.invitedById })
      }
    }
  }

  const thisYear = new Date().getFullYear()
  const nodes: GNode[] = data.people.map((p) => {
    const years = yearsOf.get(p.id) ?? new Set<number>()
    const firstYear = years.size ? Math.min(...years) : thisYear
    const out = outCount.get(p.id) ?? 0
    const root = years.size > 0 && !firstInvite.has(p.id)
    const old = prev.get(p.id)
    return {
      id: p.id,
      name: p.name,
      out,
      firstYear,
      root,
      years,
      r: 8 + 2.2 * Math.sqrt(out) + (root ? 2 : 0),
      tx: 0,
      ty: 0,
      pinned: old?.pinned ?? false,
      x: old?.x,
      y: old?.y,
      fx: old?.fx ?? null,
      fy: old?.fy ?? null,
      vx: 0,
      vy: 0,
    }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Rows: every festival year from the first to the last one seen.
  const seenYears = new Set(nodes.map((n) => n.firstYear))
  const allYears = [...new Set([...festivalYearsAsc(), ...seenYears])].sort((a, b) => a - b)
  const lo = Math.min(...seenYears, allYears[0])
  const hi = Math.max(...seenYears, allYears[0])
  const rowYears = allYears.filter((y) => y >= lo && y <= hi)
  const rowIndex = new Map(rowYears.map((y, i) => [y, i]))
  const rows: Row[] = rowYears.map((year) => ({ year, y: (rowIndex.get(year) ?? 0) * ROW_H }))

  // Tree parent = whoever brought you in your first year. Only allow parents
  // that come earlier in (firstYear, id) order so the structure is acyclic.
  const parentOf = new Map<number, number>()
  for (const n of nodes) {
    const fi = firstInvite.get(n.id)
    if (!fi) {
      continue
    }
    const p = byId.get(fi.by)
    if (!p) {
      continue
    }
    if (p.firstYear < n.firstYear || (p.firstYear === n.firstYear && p.id < n.id)) {
      parentOf.set(n.id, p.id)
    }
  }
  const children = new Map<number, GNode[]>()
  const roots: GNode[] = []
  for (const n of nodes) {
    const pid = parentOf.get(n.id)
    if (pid == null) {
      roots.push(n)
    } else {
      push(children, pid, n)
    }
  }
  const order = (a: GNode, b: GNode) => a.firstYear - b.firstYear || a.name.localeCompare(b.name)
  roots.sort(order)
  for (const list of children.values()) {
    list.sort(order)
  }

  type TreeDatum = { node: GNode | null; kids: TreeDatum[] }
  const toDatum = (n: GNode): TreeDatum => ({ node: n, kids: (children.get(n.id) ?? []).map(toDatum) })
  const virtualRoot: TreeDatum = { node: null, kids: roots.map(toDatum) }
  const h = hierarchy(virtualRoot, (d) => d.kids)
  const laid = tree<TreeDatum>()
    .nodeSize([NODE_W, ROW_H])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.4))(h)

  for (const t of laid.descendants()) {
    if (!t.data.node) {
      continue
    }
    const n = t.data.node
    n.tx = t.x
    n.ty = (rowIndex.get(n.firstYear) ?? 0) * ROW_H
    if (n.x == null || n.y == null) {
      n.x = n.tx
      n.y = n.ty
    }
  }

  const links: GLink[] = []
  for (const a of data.attendances) {
    if (a.invitedById == null) {
      continue
    }
    const s = byId.get(a.invitedById)
    const t = byId.get(a.personId)
    if (!s || !t) {
      continue
    }
    const fi = firstInvite.get(t.id)
    links.push({
      id: a.id,
      year: a.year,
      source: s,
      target: t,
      primary: fi?.year === a.year && fi.by === s.id,
    })
  }

  return { nodes, links, rows }
}

/* ------------------------------------------------------------------ paths */

function linkPath(s: GNode, t: GNode): string {
  const sx = s.x ?? 0
  const sy = s.y ?? 0
  const tx = t.x ?? 0
  const ty = t.y ?? 0
  const dy = ty - sy
  if (Math.abs(dy) > 24) {
    const dir = Math.sign(dy)
    const y0 = sy + dir * (s.r + 1)
    const y1 = ty - dir * (t.r + 4)
    const my = (y0 + y1) / 2
    return `M${sx},${y0}C${sx},${my} ${tx},${my} ${tx},${y1}`
  }
  // Same row: a shallow arc that dips below the row.
  const dir = Math.sign(tx - sx) || 1
  const x0 = sx + dir * (s.r + 1)
  const x1 = tx - dir * (t.r + 4)
  const mx = (x0 + x1) / 2
  const bulge = Math.min(70, Math.abs(x1 - x0) / 3) + 20
  return `M${x0},${sy}C${mx},${sy + bulge} ${mx},${ty + bulge} ${x1},${ty}`
}

function linkMid(s: GNode, t: GNode): [number, number] {
  const sx = s.x ?? 0
  const sy = s.y ?? 0
  const tx = t.x ?? 0
  const ty = t.y ?? 0
  if (Math.abs(ty - sy) > 24) {
    return [(sx + tx) / 2, (sy + ty) / 2]
  }
  const bulge = Math.min(70, Math.abs(tx - sx) / 3) + 20
  return [(sx + tx) / 2, sy + bulge * 0.75]
}

function fitToView(svgEl: SVGSVGElement, z: ZoomBehavior<SVGSVGElement, unknown> | null, nodes: GNode[]) {
  if (!z || nodes.length === 0) {
    return
  }
  const { width, height } = svgEl.getBoundingClientRect()
  if (!width || !height) {
    return
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x ?? 0)
    maxX = Math.max(maxX, n.x ?? 0)
    minY = Math.min(minY, n.y ?? 0)
    maxY = Math.max(maxY, n.y ?? 0)
  }
  // On phones the bottom of the stage is covered by the collapsed form and the
  // year chips, so fit into the top part only.
  const narrow = width < 760
  const usableH = narrow ? height * 0.58 : height
  const padX = narrow ? 120 : 260 // room for the row labels on the left
  const padY = narrow ? 40 : 80
  const bw = Math.max(1, maxX - minX + padX * 2)
  const bh = Math.max(1, maxY - minY + padY * 2)
  const k = Math.min(1.3, width / bw, usableH / bh)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const t = zoomIdentity
    .translate(width / 2, usableH / 2)
    .scale(k)
    .translate(-cx, -cy)
  select(svgEl).call(z.transform, t)
}
