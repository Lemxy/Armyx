import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Maximize2, Search } from 'lucide-react'
import { links, tags, title, type Note } from '../deso'
import { useI18n } from '../i18n'
import type { MenuItem } from './ContextMenu'
import { layout, type Edge, type P } from '../layout'

const W = 220, H = 110
type Drag = { kind: 'pan' | 'node'; name?: string; sx: number; sy: number; origin: Record<string, P>; ox: number; oy: number; moved: boolean; ctrl: boolean }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Cubic link from the source's out-port (right) to the target's in-port (left). */
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const c = Math.max(60, Math.abs(x2 - x1) / 2)
  return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`
}

interface Props {
  notes: Note[]; current: string; onOpen: (n: string) => void; onNew: (n: string) => void
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void; onCopy: (n: string) => void; onDelete: (n: string) => void
}

export default function CircuitGraph({ notes, current, onOpen, onNew, onMenu, onCopy, onDelete }: Props) {
  const { t: tr } = useI18n()
  const [pos, setPos] = useState<Record<string, P>>({})
  const [view, setView] = useState({ x: 80, y: 300, k: 0.9 })
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [hover, setHover] = useState('')
  const [pinned, setPinned] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  const names = useMemo(() => new Set(notes.map((n) => n.name)), [notes])
  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => tags(n.content)))].sort(), [notes])
  const edges = useMemo(() => notes.flatMap((n) => links(n.content).filter((t) => names.has(t) && t !== n.name).map((to) => ({ from: n.name, to }))), [notes, names])
  const auto = useMemo(() => layout(notes.map((n) => n.name), edges), [notes, edges])
  const at = (n: string): P => pos[n] ?? auto[n] ?? { x: 0, y: 0 }
  const deg = useMemo(() => {
    const m = new Map<string, { i: number; o: number }>([...names].map((n) => [n, { i: 0, o: 0 }]))
    for (const e of edges) { m.get(e.from)!.o++; m.get(e.to)!.i++ }
    return m
  }, [edges, names])
  const family = (n: string) => {
    const s = new Set([n])
    for (const e of edges) { if (e.from === n) s.add(e.to); if (e.to === n) s.add(e.from) }
    return s
  }

  const shown = notes.filter((n) => !hidden.has(n.name))
  const shownEdges = edges.filter((e) => !hidden.has(e.from) && !hidden.has(e.to))
  const focus = hover || pinned
  const near = useMemo(() => (focus ? family(focus) : new Set<string>()), [edges, focus])

  const needle = q.trim().toLowerCase()
  const filtering = !!(needle || tag)
  const matches = (n: Note) =>
    (!tag || tags(n.content).includes(tag)) &&
    (!needle || title(n).toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle) ||
      tags(n.content).some((t) => t.toLowerCase().includes(needle.replace(/^#/, ''))))
  const hit = useMemo(() => new Set(notes.filter(matches).map((n) => n.name)), [notes, needle, tag])

  const fit = (only = shown) => {
    const r = svg.current?.getBoundingClientRect()
    if (!r || !only.length) return
    const ps = only.map((n) => at(n.name))
    const x0 = Math.min(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y))
    const x1 = Math.max(...ps.map((p) => p.x)) + W, y1 = Math.max(...ps.map((p) => p.y)) + H
    const k = Math.min(1.2, Math.max(0.2, Math.min((r.width - 120) / (x1 - x0), (r.height - 160) / (y1 - y0))))
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k + 20 })
  }
  const fitted = useRef(false)
  useEffect(() => { if (!fitted.current && notes.length) { fitted.current = true; requestAnimationFrame(() => fit()) } }, [notes.length])

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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSel(new Set()); setPinned('') } }
    window.addEventListener('keydown', esc)
    return () => { el.removeEventListener('wheel', h); window.removeEventListener('keydown', esc) }
  }, [])

  const reset = () => { setPos({}); setPinned(''); setTimeout(() => fit(), 0) }
  const hideOnly = (keep: Set<string>) => setHidden(new Set(notes.map((n) => n.name).filter((n) => !keep.has(n))))
  const hide = (s: Set<string>) => { setHidden((h) => new Set([...h, ...s])); setSel((x) => new Set([...x].filter((n) => !s.has(n)))) }

  const down = (e: React.PointerEvent, name?: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    // dragging a selected note moves the whole selection
    const group = name ? (sel.has(name) ? [...sel] : [name]) : []
    drag.current = {
      kind: name ? 'node' : 'pan', name, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, ctrl: e.ctrlKey || e.metaKey,
      origin: Object.fromEntries(group.map((n) => [n, at(n)])),
    }
  }
  const move = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true
    if (!g.moved) return
    if (g.kind === 'pan') setView((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }))
    else setPos((p) => ({ ...p, ...Object.fromEntries(Object.entries(g.origin).map(([n, o]) => [n, { x: o.x + dx / view.k, y: o.y + dy / view.k }])) }))
  }
  const up = () => {
    const g = drag.current
    drag.current = null
    if (!g || g.moved) return
    if (g.kind === 'pan') return setSel(new Set())
    if (g.ctrl) setSel((s) => { const x = new Set(s); x.has(g.name!) ? x.delete(g.name!) : x.add(g.name!); return x })
    else onOpen(g.name!)
  }

  const selItems = (sep: boolean): MenuItem[] => sel.size ? [
    { label: tr('onlySelected', { n: sel.size }), onClick: () => hideOnly(sel), sep },
    { label: tr('hideSelected', { n: sel.size }), onClick: () => hide(sel) },
    { label: tr('clearSel'), onClick: () => setSel(new Set()) },
  ] : []
  const showAll: MenuItem[] = hidden.size ? [{ label: tr('showAll', { n: hidden.size }), onClick: () => setHidden(new Set()) }] : []

  const canvasMenu = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect(), x = (e.clientX - r.left - view.x) / view.k, y = (e.clientY - r.top - view.y) / view.k
    onMenu(e, [
      { label: tr('newNoteHere'), onClick: () => {
        let i = 1
        while (names.has(`untitled-${i}`)) i++
        const name = `untitled-${i}`
        setPos((p) => ({ ...p, [name]: { x: x - W / 2, y: y - H / 2 } }))
        onNew(name)
      } },
      ...showAll,
      ...selItems(true),
      { label: tr('fitView'), onClick: () => fit(), sep: true },
      { label: tr('resetView'), onClick: reset },
    ])
  }
  const nodeMenu = (e: React.MouseEvent, n: string) => onMenu(e, [
    { label: tr('openEditor'), onClick: () => onOpen(n) },
    { label: tr('copyLink'), onClick: () => onCopy(n) },
    { label: tr('focusNeighbors'), onClick: () => setPinned(n), sep: true },
    { label: tr('selectFamily'), onClick: () => setSel((s) => new Set([...s, ...family(n)])) },
    { label: tr('onlyFamily'), onClick: () => { const f = family(n); hideOnly(f); setTimeout(() => fit(notes.filter((x) => f.has(x.name))), 0) } },
    { label: tr('hideFamily'), onClick: () => { const f = family(n); f.delete(n); hide(f) } },
    { label: tr('hideNote'), onClick: () => hide(new Set([n])) },
    ...(sel.has(n) ? selItems(true) : []),
    ...showAll,
    { label: tr('deleteNote'), danger: true, onClick: () => onDelete(n), sep: true },
  ])

  // highlighted edges last, so they draw on top
  const lit = (e: Edge) => (focus ? e.from === focus ? 2 : e.to === focus ? 1 : 0 : 0)
  const ordered = [...shownEdges].sort((a, b) => lit(a) - lit(b))

  return (
    <div className="relative w-full h-full bg-bg font-mono">
      <svg ref={svg} className="w-full h-full cursor-grab active:cursor-grabbing select-none" onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}
        onContextMenu={canvasMenu}>
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <circle cx="1" cy="1" r="1" fill="var(--grid-line)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} fontFamily="'JetBrains Mono', Consolas, monospace">
          {ordered.map((e) => {
            const a = at(e.from), b = at(e.to)
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 8, y2 = b.y + H / 2
            const d = curve(x1, y1, x2, y2)
            const l = lit(e)
            const color = l === 2 ? 'var(--accent)' : l === 1 ? 'var(--edge-in)' : 'var(--line2)'
            const dim = filtering ? !(hit.has(e.from) && hit.has(e.to)) : !!focus && !l
            return (
              <g key={e.from + '>' + e.to} opacity={dim ? 0.12 : 1}>
                <title>{`${e.from} → ${e.to}`}</title>
                <path d={d} fill="none" stroke="transparent" strokeWidth="10" />
                <path d={d} fill="none" stroke={color} strokeWidth={l ? 1.6 : 1} />
                {l > 0 && <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeDasharray="2 18" className="pulse" />}
                <path d={`M${x2} ${y2 - 4.5} L${x2 + 8} ${y2} L${x2} ${y2 + 4.5} Z`} fill={color} />
              </g>
            )
          })}
          {shown.map((n) => {
            const p = at(n.name)
            const body = n.content.split('\n').filter((l) => l && !/^[#?!]/.test(l)).slice(0, 2)
            const nt = tags(n.content)
            const { i, o } = deg.get(n.name)!
            const match = filtering && hit.has(n.name)
            const dim = filtering ? !match : !!focus && !near.has(n.name)
            const picked = sel.has(n.name)
            const on = picked || match || n.name === current || n.name === focus
            return (
              <g key={n.name} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" opacity={dim ? 0.25 : 1}
                onPointerDown={(e) => down(e, n.name)} onContextMenu={(e) => nodeMenu(e, n.name)}
                onPointerEnter={() => setHover(n.name)} onPointerLeave={() => setHover('')}>
                <rect width={W} height={H} fill={picked ? 'var(--panel)' : 'var(--surface)'} stroke={on ? 'var(--accent)' : 'var(--line)'} strokeWidth={picked ? 1.5 : 1} />
                {/* header rule: gold for the open note */}
                <rect width={W} height="2" fill={n.name === current ? 'var(--accent)' : 'transparent'} />
                <line x1="0" x2={W} y1="34" y2="34" stroke="var(--line)" />
                <text x="14" y="23" fontSize="16" fontWeight="600" fill="var(--fg)" fontFamily="'Cormorant Garamond', Georgia, serif">{clip(title(n), 24)}</text>
                {picked && <rect x={W - 18} y="13" width="7" height="7" fill="var(--accent)" />}
                {body.map((l, j) => <text key={j} x="14" y={54 + j * 15} fontSize="10.5" fill="var(--mut)">{clip(l, 31)}</text>)}
                {nt.slice(0, 2).map((t, j) => <text key={t} x={14 + j * 64} y={H - 12} fontSize="9.5" fill="var(--dim)">{clip('#' + t, 10)}</text>)}
                <text x={W - 12} y={H - 12} fontSize="9.5" textAnchor="end">
                  <tspan fill={i ? 'var(--edge-in)' : 'var(--dim)'}>←{i}</tspan><tspan dx="8" fill={o ? 'var(--accent)' : 'var(--dim)'}>{o}→</tspan>
                </text>
                {/* ports: hollow = in (left), solid = out (right) */}
                <rect x="-4" y={H / 2 - 4} width="8" height="8" fill="var(--bg)" stroke={i ? 'var(--edge-in)' : 'var(--line2)'} />
                <rect x={W - 4} y={H / 2 - 4} width="8" height="8" fill={o ? 'var(--accent)' : 'var(--line2)'} />
              </g>
            )
          })}
        </g>
      </svg>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[30rem] max-w-[90%] flex items-center gap-3 px-3 py-2 bg-surface border border-line focus-within:border-accent">
        <Search size={12} className="text-accent shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('graphSearch')}
          className="w-36 shrink-0 bg-transparent outline-none text-xs placeholder:text-dim" />
        {filtering && <span className="text-micro text-dim tabular-nums">{hit.size}/{notes.length}</span>}
        <div className="flex flex-wrap gap-x-2.5 border-l border-line pl-3 min-w-0">
          {allTags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? '' : t)}
              className={`text-micro ${tag === t ? 'text-accent font-medium' : 'text-dim hover:text-mut'}`}>#{t}</button>
          ))}
        </div>
      </div>
      <div className="absolute bottom-3 right-3 w-64 border border-line bg-surface text-micro">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-line">
          <span className="font-serif text-sm font-semibold tracking-wide text-accent">DesoVault</span>
          <span className="text-dim tabular-nums">{shown.length} · {shownEdges.length}</span>
        </div>
        <div className="px-3 py-2 flex flex-col gap-1.5 text-mut">
          <span className="flex items-center gap-2"><svg width="28" height="8"><path d="M0 4 H20" stroke="var(--accent)" strokeWidth="1.6" /><path d="M20 0 L28 4 L20 8 Z" fill="var(--accent)" /></svg>{tr('legendOut')}</span>
          <span className="flex items-center gap-2"><svg width="28" height="8"><path d="M0 4 H20" stroke="var(--edge-in)" strokeWidth="1.6" /><path d="M20 0 L28 4 L20 8 Z" fill="var(--edge-in)" /></svg>{tr('legendIn')}</span>
          <span className="text-dim">{tr('ctrlHint')}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-line text-dim tabular-nums">
          {sel.size > 0 && <button onClick={() => setSel(new Set())} className="text-accent hover:text-fg">{sel.size} {tr('selected')} ×</button>}
          {hidden.size > 0 && <button onClick={() => setHidden(new Set())} title={tr('showAll', { n: hidden.size })}
            className="flex items-center gap-1 hover:text-accent"><Eye size={11} />{hidden.size}</button>}
          <button onClick={() => fit()} title={tr('fitView')}
            className="ml-auto p-1 border border-line2 text-mut hover:text-accent hover:border-accent"><Maximize2 size={11} /></button>
        </div>
      </div>
    </div>
  )
}
