import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Maximize2, Search } from 'lucide-react'
import { links, tags, title, type Note } from '../deso'
import { isSmooth, useI18n } from '../i18n'
import type { MenuItem } from './ContextMenu'
import { layout, type Edge, type P } from '../layout'

const W = 232, H = 118, R = 14
const PALETTE = ['--m1', '--m2', '--m3', '--m4', '--m5', '--m6', '--m7']
const NAMES = { en: ['Accent', 'Rose', 'Sage', 'Azure', 'Amethyst', 'Copper', 'Teal'], ru: ['Акцент', 'Роза', 'Шалфей', 'Лазурь', 'Аметист', 'Медь', 'Бирюза'] }
const AUTO = PALETTE.slice(1) // gold already means current / selected
type View = { x: number; y: number; k: number }
type Drag = { kind: 'pan' | 'node'; name?: string; sx: number; sy: number; origin: Record<string, P>; ov: View; moved: boolean; ctrl: boolean }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const css = (v: string) => `var(${v})`
/** Cubic link from the source's out-port (right) to the target's in-port (left). */
const curve = (x1: number, y1: number, x2: number, y2: number, tree = false) => {
  if (tree) { const c = Math.max(50, Math.abs(y2 - y1) / 2); return `M${x1} ${y1} C${x1} ${y1 + c}, ${x2} ${y2 - c}, ${x2} ${y2}` }
  const c = Math.max(70, Math.abs(x2 - x1) / 2)
  return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`
}

interface Props {
  notes: Note[]; current: string; project: string; onOpen: (n: string) => void; onNew: (n: string) => void
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void; onCopy: (n: string) => void; onDelete: (n: string) => void
}

export default function CircuitGraph({ notes, current, project, onOpen, onNew, onMenu, onCopy, onDelete }: Props) {
  const { t: tr, lang } = useI18n()
  const [pos, setPos] = useState<Record<string, P>>({})
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [hover, setHover] = useState('')
  const [pinned, setPinned] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const markKey = `desovault.marks.${project}`
  const [marks, setMarks] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem(markKey) ?? '{}') } catch { return {} } })
  useEffect(() => { localStorage.setItem(markKey, JSON.stringify(marks)) }, [marks, markKey])
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  const names = useMemo(() => new Set(notes.map((n) => n.name)), [notes])
  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => tags(n.content)))].sort(), [notes])
  const edges = useMemo(() => notes.flatMap((n) => links(n.content).filter((t) => names.has(t) && t !== n.name).map((to) => ({ from: n.name, to }))), [notes, names])
  const [tree, setTree] = useState(() => { try { return localStorage.getItem('desovault.tree') === '1' } catch { return false } })
  const auto = useMemo(() => layout(notes.map((n) => n.name), edges, tree), [notes, edges, tree])
  const target = (n: string): P => pos[n] ?? auto[n] ?? { x: 0, y: 0 }
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

  // ---- motion: camera and nodes ease toward their targets, one rAF loop for both ----
  const viewT = useRef<View>({ x: 80, y: 300, k: 0.9 })
  const viewC = useRef<View>({ ...viewT.current })
  const posC = useRef<Record<string, P>>({})
  const targets = useRef<Record<string, P>>({})
  const raf = useRef(0)
  const [, setFrame] = useState(0)
  const redraw = () => setFrame((f) => f + 1)
  const tick = () => {
    raf.current = 0
    const smooth = isSmooth(), a = 0.16
    let moving = false
    const v = viewC.current, vt = viewT.current
    if (!smooth || Math.abs(vt.x - v.x) + Math.abs(vt.y - v.y) + Math.abs(vt.k - v.k) * 400 < 0.3) viewC.current = { ...vt }
    else { viewC.current = { x: v.x + (vt.x - v.x) * a, y: v.y + (vt.y - v.y) * a, k: v.k + (vt.k - v.k) * a }; moving = true }
    for (const [n, t] of Object.entries(targets.current)) {
      const p = posC.current[n]
      if (!p || !smooth || Math.abs(t.x - p.x) + Math.abs(t.y - p.y) < 0.3) posC.current[n] = t
      else { posC.current[n] = { x: p.x + (t.x - p.x) * a, y: p.y + (t.y - p.y) * a }; moving = true }
    }
    redraw()
    if (moving) raf.current = requestAnimationFrame(tick)
  }
  const kick = () => { if (!raf.current) raf.current = requestAnimationFrame(tick) }
  useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0 }, []) // reset, or StrictMode's remount leaves kick() dead
  const shown = notes.filter((n) => !hidden.has(n.name))
  // new targets after every render (layout, hide/show, drag); new notes appear in place, existing ones glide
  useEffect(() => {
    const next = Object.fromEntries(shown.map((n) => [n.name, target(n.name)]))
    const changed = Object.entries(next).some(([n, p]) => { const c = posC.current[n]; return !c || c.x !== p.x || c.y !== p.y })
    targets.current = next
    for (const n of Object.keys(next)) posC.current[n] ??= next[n]
    if (changed) kick()
  })
  const at = (n: string) => posC.current[n] ?? target(n)
  const view = viewC.current

  const shownEdges = edges.filter((e) => !hidden.has(e.from) && !hidden.has(e.to))
  const focus = hover || pinned
  // each neighbour of the focused note gets its own colour (its mark if it has one), shared by the card and its link
  const hue = useMemo(() => {
    const m = new Map<string, string>()
    if (!focus) return m
    ;[...family(focus)].filter((n) => n !== focus).sort().forEach((n, i) => m.set(n, marks[n] ?? AUTO[i % AUTO.length]))
    return m
  }, [focus, edges, marks])

  const needle = q.trim().toLowerCase()
  const filtering = !!(needle || tag)
  const matches = (n: Note) =>
    (!tag || tags(n.content).includes(tag)) &&
    (!needle || title(n).toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle) ||
      tags(n.content).some((t) => t.toLowerCase().includes(needle.replace(/^#/, ''))))
  const hit = useMemo(() => new Set(notes.filter(matches).map((n) => n.name)), [notes, needle, tag])

  const fit = (only: string[] = shown.map((n) => n.name)) => {
    const r = svg.current?.getBoundingClientRect()
    if (!r || !r.width || !only.length) return
    const ps = only.map(target)
    const x0 = Math.min(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y))
    const x1 = Math.max(...ps.map((p) => p.x)) + W, y1 = Math.max(...ps.map((p) => p.y)) + H
    const k = Math.min(1.15, Math.max(0.2, Math.min((r.width - 160) / (x1 - x0), (r.height - 200) / (y1 - y0))))
    viewT.current = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k + 10 }
    kick()
  }
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !notes.length) return
    fitted.current = true
    // first frame: start slightly zoomed out so the graph settles in
    requestAnimationFrame(() => { fit(); viewC.current = { ...viewT.current, k: viewT.current.k * 0.85 }; kick() })
  }, [notes.length])

  // non-passive wheel listener so zoom can preventDefault; zoom eases toward the target around the cursor
  useEffect(() => {
    const el = svg.current!
    const h = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = viewT.current
      const k = Math.min(2.5, Math.max(0.2, v.k * Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.002)))
      viewT.current = { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }
      kick()
    }
    el.addEventListener('wheel', h, { passive: false })
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSel(new Set()); setPinned('') } }
    window.addEventListener('keydown', esc)
    return () => { el.removeEventListener('wheel', h); window.removeEventListener('keydown', esc) }
  }, [])

  const toggleTree = () => {
    const v = !tree
    try { localStorage.setItem('desovault.tree', v ? '1' : '0') } catch { /* private mode */ }
    setTree(v); setPos({})
    setTimeout(() => fit(), 50) // after the new layout is rendered
  }
  const reset = () => { setPos({}); setPinned(''); requestAnimationFrame(() => fit()) }
  const hideOnly = (keep: Set<string>) => { setHidden(new Set(notes.map((n) => n.name).filter((n) => !keep.has(n)))); requestAnimationFrame(() => fit([...keep])) }
  const hide = (s: Set<string>) => { setHidden((h) => new Set([...h, ...s])); setSel((x) => new Set([...x].filter((n) => !s.has(n)))) }
  const mark = (ns: Iterable<string>, c: string | null) => setMarks((m) => { const x = { ...m }; for (const n of ns) c ? (x[n] = c) : delete x[n]; return x })

  const down = (e: React.PointerEvent, name?: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    // dragging a selected note moves the whole selection
    const group = name ? (sel.has(name) ? [...sel] : [name]) : []
    viewT.current = { ...viewC.current } // grabbing stops any camera glide
    drag.current = {
      kind: name ? 'node' : 'pan', name, sx: e.clientX, sy: e.clientY, ov: { ...viewC.current }, moved: false, ctrl: e.ctrlKey || e.metaKey,
      origin: Object.fromEntries(group.map((n) => [n, at(n)])),
    }
  }
  const move = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true
    if (!g.moved) return
    if (g.kind === 'pan') { viewT.current = viewC.current = { ...g.ov, x: g.ov.x + dx, y: g.ov.y + dy }; redraw(); return }
    const moved = Object.fromEntries(Object.entries(g.origin).map(([n, o]) => [n, { x: o.x + dx / g.ov.k, y: o.y + dy / g.ov.k }]))
    Object.assign(posC.current, moved) // the dragged cards follow the pointer exactly
    setPos((p) => ({ ...p, ...moved }))
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
  const showAll: MenuItem[] = hidden.size ? [{ label: tr('showAll', { n: hidden.size }), onClick: () => { setHidden(new Set()); requestAnimationFrame(() => fit(notes.map((n) => n.name))) } }] : []

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
  const nodeMenu = (e: React.MouseEvent, n: string) => {
    const group = sel.has(n) ? [...sel] : [n] // a mark on a selected note colours the whole selection
    onMenu(e, [
      { label: tr('openEditor'), onClick: () => onOpen(n) },
      { label: tr('copyLink'), onClick: () => onCopy(n) },
      { label: tr('markColor') + (group.length > 1 ? ` (${group.length})` : ''), sep: true,
        swatches: PALETTE.map((c, i) => ({ color: c, name: NAMES[lang][i], on: marks[n] === c, onClick: () => mark(group, marks[n] === c ? null : c) })) },
      ...(marks[n] ? [{ label: tr('clearMark'), onClick: () => mark(group, null) }] : []),
      { label: tr('focusNeighbors'), onClick: () => setPinned(n), sep: true },
      { label: tr('focusZoom'), onClick: () => { setPinned(n); fit([...family(n)].filter((x) => !hidden.has(x))) } },
      { label: tr('selectFamily'), onClick: () => setSel((s) => new Set([...s, ...family(n)])) },
      { label: tr('onlyFamily'), onClick: () => hideOnly(family(n)) },
      { label: tr('hideFamily'), onClick: () => { const f = family(n); f.delete(n); hide(f) } },
      { label: tr('hideNote'), onClick: () => hide(new Set([n])) },
      ...(sel.has(n) ? selItems(true) : []),
      ...showAll,
      { label: tr('deleteNote'), danger: true, onClick: () => onDelete(n), sep: true },
    ])
  }

  const other = (e: Edge) => (e.from === focus ? e.to : e.to === focus ? e.from : '')
  // highlighted edges last, so they draw on top
  const ordered = [...shownEdges].sort((a, b) => +!!other(a) - +!!other(b))
  const used = PALETTE.filter((c) => Object.entries(marks).some(([n, m]) => m === c && names.has(n)))

  return (
    <div className="relative w-full h-full bg-bg overflow-hidden">
      <svg ref={svg} className={`${shown.length > 60 ? 'fast ' : ''}w-full h-full cursor-grab active:cursor-grabbing select-none`} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}
        onContextMenu={canvasMenu}>
        <defs>
          <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <circle cx="1" cy="1" r="0.9" fill="var(--grid-line)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
          {ordered.map((e) => {
            const a = at(e.from), b = at(e.to)
            const x1 = tree ? a.x + W / 2 : a.x + W, y1 = tree ? a.y + H : a.y + H / 2
            const x2 = tree ? b.x + W / 2 : b.x - 9, y2 = tree ? b.y - 9 : b.y + H / 2
            const d = curve(x1, y1, x2, y2, tree)
            const nb = other(e)
            const color = nb ? css(hue.get(nb)!) : marks[e.from] ? css(marks[e.from]) : 'var(--line2)'
            const dim = filtering ? !(hit.has(e.from) && hit.has(e.to)) : !!focus && !nb
            return (
              <g key={e.from + '>' + e.to} className="g-edge" style={{ opacity: dim ? 0.08 : nb ? 1 : marks[e.from] ? 0.7 : 0.9 }}>
                <title>{`${e.from} → ${e.to}`}</title>
                <path d={d} fill="none" stroke={color} strokeWidth={nb ? 2 : 1.3} strokeLinecap="round" />
                {nb && <path d={d} fill="none" stroke="var(--bg)" strokeOpacity=".55" strokeWidth="2" strokeDasharray="3 21" className="pulse" />}
                <path d={tree ? `M${x2 - 5} ${y2 - 1} L${x2} ${y2 + 8} L${x2 + 5} ${y2 - 1} Z` : `M${x2 - 1} ${y2 - 5} L${x2 + 8} ${y2} L${x2 - 1} ${y2 + 5} Z`} fill={color} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
              </g>
            )
          })}
          {shown.map((n) => {
            const p = at(n.name)
            const body = n.content.split('\n').filter((l) => l && !/^[#?!]/.test(l)).slice(0, 2)
            const nt = tags(n.content)
            const { i, o } = deg.get(n.name)!
            const match = filtering && hit.has(n.name)
            const dim = filtering ? !match : !!focus && n.name !== focus && !hue.has(n.name)
            const picked = sel.has(n.name)
            const ring = hue.get(n.name) ?? marks[n.name]
            const gold = picked || match || n.name === current || n.name === focus
            const stroke = gold ? 'var(--accent)' : ring ? css(ring) : 'var(--line)'
            return (
              <g key={n.name} transform={`translate(${p.x} ${p.y})`} className="g-node cursor-pointer" style={{ opacity: dim ? 0.18 : 1 }}
                onPointerDown={(e) => down(e, n.name)} onContextMenu={(e) => nodeMenu(e, n.name)}
                onPointerEnter={() => setHover(n.name)} onPointerLeave={() => setHover('')}>
                <g className="node-in">
                  <rect className="card" width={W} height={H} rx={R} fill={picked ? 'var(--panel)' : 'var(--surface)'} stroke={stroke} strokeWidth={gold || hue.has(n.name) ? 1.5 : 1} />
                  {ring && <circle cx="20" cy="24" r="4.5" fill={css(ring)} />}
                  <text x={ring ? 32 : 18} y="30" fontSize="15" fontWeight="600" fill="var(--fg)">{clip(title(n), ring ? 24 : 27)}</text>
                  {picked && <circle cx={W - 20} cy="24" r="4" fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
                  {picked && <circle cx={W - 20} cy="24" r="1.6" fill="var(--accent)" />}
                  {body.map((l, j) => <text key={j} x="18" y={56 + j * 16} fontSize="12" fill="var(--mut)">{clip(l, 32)}</text>)}
                  {nt.slice(0, 2).map((t, j) => <text key={t} x={18 + j * 66} y={H - 16} fontSize="11" fill="var(--mut)">{clip('#' + t, 9)}</text>)}
                  <text x={W - 16} y={H - 16} fontSize="12" fontWeight="500" textAnchor="end" fill="var(--mut)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <tspan>← {i}</tspan><tspan dx="10" fill={o ? 'var(--accent)' : 'var(--mut)'}>{o} →</tspan>
                  </text>
                  <circle cx={tree ? W / 2 : 0} cy={tree ? 0 : H / 2} r="4.5" fill="var(--bg)" stroke={i ? 'var(--mut)' : 'var(--line2)'} strokeWidth="1.3" />
                  <circle cx={tree ? W / 2 : W} cy={tree ? H : H / 2} r="4.5" fill={o ? 'var(--accent)' : 'var(--line2)'} />
                </g>
              </g>
            )
          })}
        </g>
      </svg>

      <div className="anim-rise absolute top-4 inset-x-0 mx-auto w-[34rem] max-w-[90%] flex items-center gap-3 pl-4 pr-3 py-2 rounded-full bg-surface/95 border border-line shadow-float focus-within:border-accent">
        <Search size={14} className="text-dim shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('graphSearch')}
          className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-dim" />
        {filtering && <span className="anim-fade text-micro text-dim tabular-nums">{hit.size}/{notes.length}</span>}
      </div>
      {allTags.length > 0 && (
        <div className="anim-rise absolute top-[4.25rem] inset-x-0 mx-auto w-fit max-w-[80%] flex flex-wrap justify-center gap-1.5" style={{ animationDelay: '80ms' }}>
          {allTags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? '' : t)}
              className={`btn-press px-2.5 py-0.5 rounded-full text-micro border bg-surface ${tag === t ? 'border-accent text-accent' : 'border-line text-dim hover:text-mut hover:border-line2'}`}>#{t}</button>
          ))}
        </div>
      )}

      <div className="anim-rise absolute bottom-4 right-4 w-72 rounded-2xl border border-line bg-surface/95 shadow-float text-micro" style={{ animationDelay: '120ms' }}>
        <div className="flex items-baseline justify-between px-4 pt-3.5">
          <span className="text-base font-semibold">{tr('graph')}</span>
          <span className="text-mut tabular-nums">{shown.length} · {shownEdges.length}</span>
        </div>
        <p className="px-4 pt-1.5 text-dim leading-relaxed">{tr('legendHint')}</p>
        <div className="px-4 pt-2.5 flex items-center gap-1.5">
          {PALETTE.map((c) => <span key={c} className="w-3 h-3 rounded-full" style={{ background: css(c) }} />)}
        </div>
        {used.length > 0 && (
          <div className="px-4 pt-2.5 flex flex-wrap gap-1.5">
            {used.map((c) => {
              const ns = Object.keys(marks).filter((n) => marks[n] === c && names.has(n))
              return (
                <button key={c} onClick={() => setSel(new Set(ns))} title={tr('selectFamily')}
                  className="btn-press flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-line hover:border-line2 text-mut">
                  <span className="w-2 h-2 rounded-full" style={{ background: css(c) }} />{ns.length}
                </button>
              )
            })}
          </div>
        )}
        <p className="px-4 pt-2.5 text-dim">{tr('ctrlHint')}</p>
        <div className="flex items-center gap-3 mx-4 mt-3 py-2.5 border-t border-line text-dim tabular-nums">
          {sel.size > 0 && <button onClick={() => setSel(new Set())} className="anim-fade text-accent hover:text-fg">{sel.size} {tr('selected')} ×</button>}
          {hidden.size > 0 && <button onClick={() => { setHidden(new Set()); requestAnimationFrame(() => fit(notes.map((n) => n.name))) }} title={tr('showAll', { n: hidden.size })}
            className="anim-fade flex items-center gap-1 hover:text-accent"><Eye size={12} />{hidden.size}</button>}
          <button onClick={toggleTree} title="Family Tree / Circuit"
            className={`btn-press px-2 py-1 rounded-lg border ${tree ? 'border-accent text-accent' : 'border-line text-mut hover:text-accent'}`}>{tree ? 'Family Tree' : 'Circuit'}</button>
          <button onClick={() => fit()} title={tr('fitView')}
            className="btn-press ml-auto p-1.5 rounded-lg text-mut hover:text-accent hover:bg-panel"><Maximize2 size={13} /></button>
        </div>
      </div>
    </div>
  )
}
