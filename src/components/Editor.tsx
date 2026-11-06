import { useRef, useState } from 'react'
import { savings, type Note } from '../deso'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function highlight(src: string) {
  return esc(src)
    .split('\n')
    .map((l) => {
      const inline = l
        .replace(/(-&gt;)?@[\w-]+/g, '<span class="text-fg">$&</span>')
        .replace(/(^|\s)(#[A-Za-z][\w-]*)/g, '$1<span class="text-mut">$2</span>')
      if (/^# /.test(l)) return `<span class="text-fg font-semibold">${inline}</span>`
      if (/^[?!]/.test(l)) return `<span class="text-dim">${inline}</span>`
      if (/^\+(?!&gt;)\S/.test(l)) return `<span class="text-emerald-300">${inline}</span>`
      if (/^-(?!&gt;)\S/.test(l)) return `<span class="text-rose-300">${inline}</span>`
      return inline
    })
    .join('\n')
}

const shared = 'absolute inset-0 m-0 p-6 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words overflow-y-scroll'

type Ac = { start: number; q: string; x: number; y: number }

export default function Editor({ note, notes, onChange }: { note: Note; notes: Note[]; onChange: (c: string) => void }) {
  const pre = useRef<HTMLPreElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const [ac, setAc] = useState<Ac | null>(null)
  const [sel, setSel] = useState(0)
  const hits = ac ? notes.filter((n) => n.name !== note.name && n.name.includes(ac.q.toLowerCase())).slice(0, 8) : []

  // Caret pixel position: a hidden mirror with identical layout, measured at the @.
  const detect = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart)
    const m = before.match(/(?:^|[^\w@-])@([\w-]*)$/)
    if (!m || !mirror.current) return setAc(null)
    const start = before.length - m[1].length - 1
    mirror.current.textContent = el.value.slice(0, start)
    const mark = document.createElement('span')
    mark.textContent = '@'
    mirror.current.appendChild(mark)
    setAc({ start, q: m[1], x: mark.offsetLeft, y: mark.offsetTop - el.scrollTop + 24 })
    setSel(0)
  }
  const pick = (name: string) => {
    const el = ta.current!, end = el.selectionStart
    onChange(el.value.slice(0, ac!.start) + '@' + name + el.value.slice(end))
    const caret = ac!.start + name.length + 1
    setAc(null)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret) })
  }
  const keys = (e: React.KeyboardEvent) => {
    if (!ac || !hits.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(hits[sel].name) }
    else if (e.key === 'Escape') { e.preventDefault(); setAc(null) }
  }
  const s = savings(note.content)
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 h-9 text-xs border-b border-line flex items-center justify-between text-dim">
        <span>{note.name}.deso</span>
        <span>{s.d} tok vs {s.m} md · <span className="text-mut">{s.pct}% saved</span></span>
      </div>
      <div className="relative flex-1 min-h-0">
        <pre ref={pre} aria-hidden className={`${shared} pointer-events-none text-fg/80`}
          dangerouslySetInnerHTML={{ __html: highlight(note.content) + ' ' }} />
        <div ref={mirror} aria-hidden className={`${shared} invisible pointer-events-none`} />
        <textarea ref={ta} value={note.content} spellCheck={false}
          onChange={(e) => { onChange(e.target.value); detect(e.target) }}
          onKeyDown={keys} onClick={(e) => detect(e.currentTarget)} onBlur={() => setAc(null)}
          onScroll={(e) => { if (pre.current) pre.current.scrollTop = e.currentTarget.scrollTop; setAc(null) }}
          className={`${shared} bg-transparent text-transparent caret-fg resize-none outline-none`} />
        {ac && hits.length > 0 && (
          <ul role="listbox" style={{ left: Math.min(ac.x, 400), top: ac.y }}
            className="absolute z-10 w-56 py-1 rounded-lg bg-[#18181b] border border-[#27272a] text-[13px]">
            {hits.map((n, i) => (
              <li key={n.name} role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); pick(n.name) }}
                className={`px-3 py-1 cursor-pointer ${i === sel ? 'bg-[#27272a] text-fg' : 'text-mut'}`}>@{n.name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
