import { useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Maximize2, Search } from 'lucide-react'
import { links, tags, title, type Note } from '../deso'
import { useI18n } from '../i18n'
import type { MenuItem } from './ContextMenu'

const W = 220, H = 110
type P = { x: number; y: number }
type Drag = { kind: 'pan' | 'node'; name?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }

const HOME = { x: 40, y: 80, k: 0.9 }
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Straight link between the facing sides of two cards: [x1, y1, x2, y2]. */
function ends(a: P, b: P): [number, number, number, number] {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) * H >= Math.abs(dy) * W) return [dx >= 0 ? a.x + W : a.x, a.y + H / 2, dx >= 0 ? b.x : b.x + W, b.y + H / 2]
  return [a.x + W / 2, dy >= 0 ? a.y + H : a.y, b.x + W / 2, dy >= 0 ? b.y : b.y + H]
}

interface Props {
  notes: Note[]; current: string; onOpen: (n: string) => void; onNew: (n: string) => void
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void; onCopy: (n: string) => void; onDelete: (n: string) => void
}

export default function CircuitGraph({ notes, current, onOpen, onNew, onMenu, onCopy, onDelete }: Props) {
  const { t: tr } = useI18n()
  const [pos, setPos] = useState<Record<string, P>>({})
  const [view, setView] = useState(HOME)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [hover, setHover] = useState('')
  const [pinned, setPinned] = useState('')
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  const at = (n: string, i: number): P => {
    if (pos[n]) return pos[n]
    const cols = Math.ceil(Math.sqrt(notes.length))
    return { x: (i % cols) * 340, y: Math.floor(i / cols) * 220 }
  }
  const idx = useMemo(() => new Map(notes.map((n, i) => [n.name, i])), [notes])
  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => tags(n.content)))].sort(), [notes])

  // unordered pairs, so mutual links draw once
  const edges = useMemo(() => {
    const m = new Map<string, { a: string; b: string }>()
    for (const n of notes)
      for (const t of links(n.content)) {
        if (!idx.has(t) || t === n.name) continue
        m.set([n.name, t].sort().join('|'), { a: n.name, b: t })
      }
    return [...m.values()]
  }, [notes, idx])

  const pulse = edges.length <= 150
  const focus = hover || pinned || current
  const near = useMemo(() => {
    const s = new Set<string>([focus])
    for (const e of edges) { if (e.a === focus) s.add(e.b); if (e.b === focus) s.add(e.a) }
    return s
  }, [edges, focus])

  const needle = q.trim().toLowerCase()
  const filtering = !!(needle || tag)
  const matches = (n: Note) =>
    (!tag || tags(n.content).includes(tag)) &&
    (!needle || title(n).toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle) ||
      tags(n.content).some((t) => t.toLowerCase().includes(needle.replace(/^#/, ''))))
  const hit = useMemo(() => new Set(notes.filter(matches).map((n) => n.name)), [notes, needle, tag])

  // non-passive wheel listener so zoom can preventDefault
  useEffect(() => {
    const el = svg.current!
    const h = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.1 : 0.9)))
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }
      })
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  const reset = () => { setView(HOME); setPos({}); setPinned('') }
  const down = (e: React.PointerEvent, name?: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    const o = name ? at(name, idx.get(name)!) : view
    drag.current = { kind: name ? 'node' : 'pan', name, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false }
  }
  const move = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true
    if (g.kind === 'pan') setView((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }))
    else setPos((p) => ({ ...p, [g.name!]: { x: g.ox + dx / view.k, y: g.oy + dy / view.k } }))
  }
  const up = () => {
    const g = drag.current
    drag.current = null
    if (g?.kind === 'node' && !g.moved) onOpen(g.name!)
  }

  return (
    <div className="relative w-full h-full bg-bg">
      <svg ref={svg} className="w-full h-full cursor-grab select-none" onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}
        onContextMenu={(e) => {
          const r = svg.current!.getBoundingClientRect(), x = (e.clientX - r.left - view.x) / view.k, y = (e.clientY - r.top - view.y) / view.k
          onMenu(e, [
            { label: tr('newNoteHere'), onClick: () => {
              let i = 1
              while (notes.some((n) => n.name === `untitled-${i}`)) i++
              const name = `untitled-${i}`
              setPos((p) => ({ ...p, [name]: { x: x - W / 2, y: y - H / 2 } }))
              onNew(name)
            } },
            { label: tr('resetView'), onClick: reset },
          ])
        }}>
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <circle cx="1" cy="1" r="0.8" fill="#27272a" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} fontFamily="Inter, system-ui, sans-serif">
          {edges.map((e) => {
            const on = e.a === focus || e.b === focus
            const dim = filtering ? !(hit.has(e.a) && hit.has(e.b)) : !!focus && !on
            const [x1, y1, x2, y2] = ends(at(e.a, idx.get(e.a)!), at(e.b, idx.get(e.b)!))
            return (
              <g key={e.a + e.b} opacity={dim ? 0.2 : 1} shapeRendering="crispEdges">
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? '#52525b' : '#27272a'} strokeWidth="1" />
                {/* data pulse: dashes travel from the linking note to its target; static on very large graphs unless focused */}
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? '#f4f4f5' : '#71717a'} strokeWidth="1.5" strokeDasharray="2 18"
                  className={pulse || on ? 'pulse' : ''} />
                <rect x={x1 - 2.5} y={y1 - 2.5} width="5" height="5" fill="#3f3f46" />
                <rect x={x2 - 2.5} y={y2 - 2.5} width="5" height="5" fill={on ? '#f4f4f5' : '#71717a'} />
              </g>
            )
          })}
          {notes.map((n, i) => {
            const p = at(n.name, i)
            const body = n.content.split('\n').filter((l) => l && !/^[#?!]/.test(l)).slice(0, 2)
            const nt = tags(n.content)
            const match = filtering && hit.has(n.name)
            const dim = filtering ? !match : !!focus && !near.has(n.name)
            const sel = n.name === current || n.name === hover
            return (
              <g key={n.name} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" opacity={dim ? 0.3 : 1}
                onPointerDown={(e) => down(e, n.name)}
                onContextMenu={(e) => onMenu(e, [
                  { label: tr('openEditor'), onClick: () => onOpen(n.name) },
                  { label: tr('copyLink'), onClick: () => onCopy(n.name) },
                  { label: tr('focusNeighbors'), onClick: () => setPinned(n.name) },
                  { label: tr('deleteNote'), danger: true, onClick: () => onDelete(n.name) },
                ])}
                onPointerEnter={() => setHover(n.name)} onPointerLeave={() => setHover('')}>
                <rect width={W} height={H} rx="10" fill="#18181b" stroke={match || sel ? '#f4f4f5' : '#27272a'} strokeWidth={match || sel ? 1.5 : 1} />
                <text x="14" y="26" fontSize="13" fontWeight="600" fill="#f4f4f5">{clip(title(n), 26)}</text>
                {body.map((l, j) => <text key={j} x="14" y={46 + j * 15} fontSize="11" fill="#a1a1aa">{clip(l, 30)}</text>)}
                {nt.slice(0, 3).map((t, j) => (
                  <g key={t} transform={`translate(${14 + j * 56} ${H - 30})`}>
                    <rect width="50" height="18" rx="9" fill="#27272a" />
                    <text x="25" y="12.5" fontSize="10" fill="#a1a1aa" textAnchor="middle">{clip('#' + t, 8)}</text>
                  </g>
                ))}
                <text x={W - 12} y={H - 13} fontSize="10" fill="#71717a" textAnchor="end">{links(n.content).length} links</text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[28rem] max-w-[90%] flex flex-col gap-2 items-center">
        <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/95 border border-line focus-within:border-line2">
          <Search size={14} className="text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('graphSearch')}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-dim" />
          {filtering && <span className="text-[11px] text-dim">{hit.size}/{notes.length}</span>}
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {allTags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? '' : t)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] border transition-colors ${tag === t ? 'bg-fg text-bg border-fg' : 'bg-surface/95 text-mut border-line hover:border-line2'}`}>
              #{t}
            </button>
          ))}
        </div>
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] text-dim"><Link2 size={12} />{edges.length} {tr('connections')}</span>
        <button onClick={reset} title={tr('resetView')}
          className="p-2 rounded-md bg-surface border border-line text-mut hover:text-fg hover:border-line2"><Maximize2 size={14} /></button>
      </div>
    </div>
  )
}
