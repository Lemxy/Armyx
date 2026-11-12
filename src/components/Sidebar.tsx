import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebounced } from '../debounce'
import { ChevronsUpDown, FileText, Folder, Plus, RefreshCw, Search, X } from 'lucide-react'
import { links, savings, tags, type Note } from '../deso'
import { useI18n } from '../i18n'
import { projectLabel } from '../vault'
import type { MenuItem } from './ContextMenu'

const LIMIT = 300 // shortcut: no virtual list; the search box reaches the rest, upgrade when that annoys
const TAGS_SHOWN = 8 // the rest hide behind "more": a project can have dozens of tags

interface Props {
  notes: Note[]; current: string; project: string; onSelect: (n: string) => void; onNew: (n: string) => void
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void; onCopy: (n: string) => void; onDelete: (n: string) => void; onProjects: () => void; onRescan?: () => void
}

/** The name with the searched part in the accent colour. */
function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="bg-transparent text-accent font-medium">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export default function Sidebar({ notes, current, project, onSelect, onNew, onMenu, onCopy, onDelete, onProjects, onRescan }: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [allTagsOpen, setAllTagsOpen] = useState(false)
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
  const all = useMemo(() => notes.filter((n) => n.name.includes(q.trim().toLowerCase()) && (!tag || tags(n.content).includes(tag))), [notes, q, tag])
  const shown = all.slice(0, LIMIT) // a scanned project can have thousands of notes; rendering them all is what froze the list
  const filtered = !!q.trim() || !!tag
  const tagList = allTagsOpen ? allTags : allTags.slice(0, TAGS_SHOWN)

  const submit = () => {
    const n = name.trim().toLowerCase()
    if (!n) return setCreating(false)
    if (!/^[a-z0-9_-]+$/.test(n)) return setErr(t('noteBad'))
    if (notes.some((x) => x.name === n)) return setErr(t('noteExists'))
    onNew(n); setName(''); setErr(''); setCreating(false)
  }

  return (
    <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col text-sm">
      <div className="pt-5 pb-3 px-4 flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5 px-1">
          <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="var(--accent)" strokeWidth="1.2" aria-hidden>
            <path d="M9 1.5 L16.5 9 L9 16.5 L1.5 9 Z" /><path d="M9 5.5 L12.5 9 L9 12.5 L5.5 9 Z" fill="var(--accent)" stroke="none" />
          </svg>
          <span className="font-serif text-[22px] leading-none font-semibold tracking-tight">Tau<span className="text-accent italic font-medium">rium</span></span>
        </div>
        <button onClick={onProjects} title={project}
          className="btn-press group flex items-center gap-3 p-2 pr-3 rounded-xl bg-field border border-line hover:border-accent text-left">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent-dim text-accent shrink-0"><Folder size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-micro text-dim leading-tight">{t('project')}</span>
            <span className="block truncate text-fg font-medium">{projectLabel(project)}</span>
          </span>
          <ChevronsUpDown size={14} className="text-dim group-hover:text-fg shrink-0" />
        </button>
        <div className="flex items-center gap-2 pl-3 pr-2 h-10 rounded-xl bg-field border border-line focus-within:border-accent focus-within:shadow-float">
          <Search size={15} className="text-dim shrink-0" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onSelect(shown[0].name); setQ('') } if (e.key === 'Escape') setQ('') }}
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-dim" />
          {q ? <button onClick={() => setQ('')} className="btn-press p-1 rounded-md text-dim hover:text-fg"><X size={13} /></button> : <kbd>Ctrl K</kbd>}
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tagList.map((x) => (
              <button key={x} onClick={() => setTag(tag === x ? '' : x)}
                className={`btn-press px-2.5 py-0.5 rounded-full text-micro border ${tag === x ? 'border-accent text-accent bg-accent-dim' : 'border-line text-dim hover:text-fg hover:border-line2'}`}>#{x}</button>
            ))}
            {allTags.length > TAGS_SHOWN && <button onClick={() => setAllTagsOpen(!allTagsOpen)} className="btn-press px-2 py-0.5 text-micro text-dim hover:text-accent">{allTagsOpen ? t('fewerTags') : `+${allTags.length - TAGS_SHOWN} ${t('moreTags')}`}</button>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-5 pt-2 pb-1.5 border-t border-line">
        <span className="text-micro uppercase tracking-wide text-dim">{t('notes')}</span>
        <span className="px-1.5 rounded-full bg-field border border-line text-micro text-dim tabular-nums">{filtered ? `${all.length}/${notes.length}` : notes.length}</span>
        <button onClick={() => setCreating(true)} title={`${t('newNote')} (Ctrl N)`}
          className="btn-press ml-auto p-1 rounded-md text-dim hover:text-accent hover:bg-panel"><Plus size={15} /></button>
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
      <ul className="flex-1 overflow-auto px-2 pb-2 flex flex-col gap-0.5">
        {filtered && all.length === 0 && <li className="px-3 py-6 text-center text-xs text-dim">{t('noMatch')}</li>}
        {shown.map((n, i) => {
          const on = n.name === current
          const c = links(n.content).length
          return (
            <li key={n.name} className="anim-rise" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
              <button onClick={() => onSelect(n.name)} title={n.name}
                onContextMenu={(e) => onMenu(e, [{ label: t('copyLink'), onClick: () => onCopy(n.name) }, { label: t('deleteNote'), danger: true, onClick: () => onDelete(n.name) }])}
                className={`group relative w-full flex items-center gap-2.5 pl-3 pr-2.5 py-[7px] rounded-lg ${on ? 'bg-accent-dim text-fg' : 'text-mut hover:bg-panel hover:text-fg'}`}>
                {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent" />}
                <FileText size={14} className={`shrink-0 ${on ? 'text-accent' : 'text-dim group-hover:text-mut'}`} />
                <span className="truncate flex-1 text-left"><Marked text={n.name} q={q.trim()} /></span>
                {c > 0 && <span title={t('connections')} className="px-1.5 rounded-full bg-field border border-line text-micro text-dim tabular-nums">{c}</span>}
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
