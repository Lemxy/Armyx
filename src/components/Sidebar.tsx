import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebounced } from '../debounce'
import { ChevronsUpDown, Plus, RefreshCw, Search } from 'lucide-react'
import { links, savings, tags, type Note } from '../deso'
import { useI18n } from '../i18n'
import { projectLabel } from '../vault'
import type { MenuItem } from './ContextMenu'

const LIMIT = 300 // shortcut: no virtual list; the search box reaches the rest, upgrade when that annoys

interface Props {
  notes: Note[]; current: string; project: string; onSelect: (n: string) => void; onNew: (n: string) => void
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void; onCopy: (n: string) => void; onDelete: (n: string) => void; onProjects: () => void; onRescan?: () => void
}

export default function Sidebar({ notes, current, project, onSelect, onNew, onMenu, onCopy, onDelete, onProjects, onRescan }: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'k')) { e.preventDefault(); search.current?.focus() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); setCreating(true) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const slow = useDebounced(notes)
  const allTags = useMemo(() => [...new Set(slow.flatMap((n) => tags(n.content)))].sort(), [slow])
  const total = useMemo(() => slow.reduce((a, n) => { const s = savings(n.content); return { d: a.d + s.d, m: a.m + s.m } }, { d: 0, m: 0 }), [slow])
  const all = useMemo(() => notes.filter((n) => n.name.includes(q.toLowerCase()) && (!tag || tags(n.content).includes(tag))), [notes, q, tag])
  const shown = all.slice(0, LIMIT) // a scanned project can have thousands of notes; rendering them all is what froze the list

  const submit = () => {
    const n = name.trim().toLowerCase()
    if (!n) return setCreating(false)
    if (!/^[a-z0-9_-]+$/.test(n)) return setErr(t('noteBad'))
    if (notes.some((x) => x.name === n)) return setErr(t('noteExists'))
    onNew(n); setName(''); setErr(''); setCreating(false)
  }

  return (
    <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col text-sm">
      <div className="pt-5 pb-3 px-4 flex flex-col gap-3">
        <div className="flex items-center gap-2.5 px-1 pb-1">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--accent)" strokeWidth="1.2" aria-hidden>
            <path d="M9 1.5 L16.5 9 L9 16.5 L1.5 9 Z" /><path d="M9 5.5 L12.5 9 L9 12.5 L5.5 9 Z" fill="var(--accent)" stroke="none" />
          </svg>
          <span className="font-serif text-[22px] leading-none font-semibold tracking-tight">Deso<span className="text-accent italic font-medium">Vault</span></span>
        </div>
        <button onClick={onProjects} title={project}
          className="btn-press flex items-center gap-2.5 px-3 py-2 rounded-xl bg-field border border-line hover:border-line2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] text-dim leading-tight">{t('project')}</span>
            <span className="block truncate text-fg">{projectLabel(project)}</span>
          </span>
          <ChevronsUpDown size={14} className="text-dim shrink-0" />
        </button>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-field border border-line focus-within:border-accent">
          <Search size={14} className="text-dim shrink-0" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onSelect(shown[0].name); setQ('') } }}
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-dim" />
          <kbd>Ctrl K</kbd>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((x) => (
              <button key={x} onClick={() => setTag(tag === x ? '' : x)}
                className={`btn-press px-2 py-0.5 rounded-full text-micro border ${tag === x ? 'border-accent text-accent bg-accent-dim' : 'border-line text-dim hover:text-mut hover:border-line2'}`}>#{x}</button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-5 pt-2 pb-1.5">
        <span className="text-micro text-dim">{t('notes')}</span>
        <button onClick={() => setCreating(true)} title={`${t('newNote')} (Ctrl N)`}
          className="btn-press p-1 rounded-md text-dim hover:text-accent hover:bg-panel"><Plus size={15} /></button>
      </div>
      {creating && (
        <div className="anim-rise px-3 pb-2 flex flex-col gap-1">
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder={t('noteName')}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setCreating(false); setErr('') } }}
            onBlur={() => !name && setCreating(false)}
            className="px-3 py-2 rounded-xl bg-field border border-accent outline-none placeholder:text-dim" />
          {err && <span className="px-1 text-micro text-status-err">{err}</span>}
        </div>
      )}
      <ul className="flex-1 overflow-auto px-2 pb-2 flex flex-col gap-px">
        {shown.map((n, i) => {
          const on = n.name === current
          const c = links(n.content).length
          return (
            <li key={n.name} className="anim-rise" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
              <button onClick={() => onSelect(n.name)}
                onContextMenu={(e) => onMenu(e, [{ label: t('copyLink'), onClick: () => onCopy(n.name) }, { label: t('deleteNote'), danger: true, onClick: () => onDelete(n.name) }])}
                className={`group w-full flex items-center gap-3 px-3 py-[7px] rounded-lg ${on ? 'bg-panel text-fg' : 'text-mut hover:bg-panel/60 hover:text-fg'}`}>
                <span data-ease className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-accent scale-100' : 'bg-line2 scale-75 group-hover:bg-dim'}`} />
                <span className="truncate flex-1 text-left">{n.name}</span>
                {c > 0 && <span title={t('connections')} className="text-micro text-dim tabular-nums">{c}</span>}
              </button>
            </li>
          )
        })}
        {all.length > shown.length && <li className="px-3 py-2 text-micro text-dim">+{all.length - shown.length} …</li>}
      </ul>
      <div className="flex items-center gap-2 px-5 py-3 border-t border-line text-micro text-dim tabular-nums">
        <span>{t('notesTok', { n: notes.length, k: total.d })}</span>
        {onRescan && <button onClick={onRescan} title={t('rescan')} className="btn-press ml-auto p-1 rounded-md hover:text-fg hover:bg-panel"><RefreshCw size={13} /></button>}
      </div>
    </aside>
  )
}
