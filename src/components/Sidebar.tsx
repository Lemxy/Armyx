import { useEffect, useRef, useState } from 'react'
import { ChevronsUpDown, GitFork, Plus, RefreshCw, Search } from 'lucide-react'
import { links, savings, tags, type Note } from '../deso'
import { useI18n } from '../i18n'
import { projectLabel } from '../vault'
import type { MenuItem } from './ContextMenu'

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

  const allTags = [...new Set(notes.flatMap((n) => tags(n.content)))].sort()
  const shown = notes.filter((n) => n.name.includes(q.toLowerCase()) && (!tag || tags(n.content).includes(tag)))
  const total = notes.reduce((a, n) => { const s = savings(n.content); return { d: a.d + s.d, m: a.m + s.m } }, { d: 0, m: 0 })

  const submit = () => {
    const n = name.trim().toLowerCase()
    if (!n) return setCreating(false)
    if (!/^[a-z0-9_-]+$/.test(n)) return setErr(t('noteBad'))
    if (notes.some((x) => x.name === n)) return setErr(t('noteExists'))
    onNew(n); setName(''); setErr(''); setCreating(false)
  }

  return (
    <aside className="w-60 shrink-0 border-r border-line bg-surface flex flex-col font-mono text-xs">
      <div className="pt-3 pb-2.5 px-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <span className="w-3 h-px bg-accent" />
          <GitFork size={12} className="text-accent" />
          <span className="text-micro tracking-widest text-mut">DESOVAULT // LOGBOOK</span>
        </div>
        <button onClick={onProjects} title={project}
          className="flex items-center gap-2 px-2 py-1.5 rounded-[2px] bg-field border border-line hover:border-line2 text-left">
          <span className="text-micro text-dim tracking-wider">PROJ:</span>
          <span className="min-w-0 flex-1 truncate text-fg">{projectLabel(project)}</span>
          <ChevronsUpDown size={12} className="text-dim shrink-0" />
        </button>
        {creating ? (
          <div className="flex flex-col gap-1">
            <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder={t('noteName')}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setCreating(false); setErr('') } }}
              onBlur={() => !name && setCreating(false)}
              className="px-2 py-1.5 rounded-[2px] bg-field border border-accent outline-none text-xs placeholder:text-dim" />
            {err && <span className="px-0.5 text-micro text-status-err">{err}</span>}
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-[2px] border border-line bg-field hover:border-accent text-micro uppercase tracking-wider text-fg">
            <Plus size={12} />{t('newNote')}<kbd className="ml-auto">CTRL+N</kbd>
          </button>
        )}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-[2px] bg-field border border-line focus-within:border-line2">
          <Search size={12} className="text-dim" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onSelect(shown[0].name); setQ('') } }}
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-dim" />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 px-0.5">
            {allTags.map((x) => (
              <button key={x} onClick={() => setTag(tag === x ? '' : x)}
                className={`text-micro ${tag === x ? 'underline text-accent font-medium' : 'text-dim hover:text-mut'}`}>#{x}</button>
            ))}
          </div>
        )}
      </div>

      <ul className="flex-1 overflow-auto border-t border-line py-1">
        {shown.map((n, i) => {
          const on = n.name === current
          return (
            <li key={n.name}>
              <button onClick={() => onSelect(n.name)}
                onContextMenu={(e) => onMenu(e, [{ label: t('copyLink'), onClick: () => onCopy(n.name) }, { label: t('deleteNote'), danger: true, onClick: () => onDelete(n.name) }])}
                className={`w-full flex items-center gap-2 pl-2 pr-3 py-1 border-l-2 ${on ? 'bg-panel border-accent text-fg font-medium' : 'border-transparent text-mut hover:bg-panel hover:text-fg'}`}>
                <span className="text-dim text-micro tabular-nums w-5 text-right select-none">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-mono text-xs truncate flex-1 text-left">{n.name}</span>
                <span title={t('connections')} className="text-dim text-micro tabular-nums">{links(n.content).length || ''}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-2 pl-3 pr-2 py-2 border-t border-line text-micro text-dim tabular-nums">
        <span>REC: {notes.length} · TOK: {total.d} / {total.m}</span>
        {onRescan && <button onClick={onRescan} title={t('rescan')} className="ml-auto p-1 rounded-[2px] text-dim hover:text-fg"><RefreshCw size={12} /></button>}
      </div>
    </aside>
  )
}
