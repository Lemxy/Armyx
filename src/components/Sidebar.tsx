import { useEffect, useRef, useState } from 'react'
import { ChevronsUpDown, FileText, GitFork, Plus, RefreshCw, Search } from 'lucide-react'
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
    <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col text-[13px]">
      <div className="p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <span className="grid place-items-center w-6 h-6 rounded-lg bg-fg text-bg"><GitFork size={13} /></span>
          <span className="font-semibold tracking-tight">DesoVault</span>
        </div>
        <button onClick={onProjects} title={project}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg border border-line hover:border-line2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-dim">{t('projects')}</span>
            <span className="block truncate font-medium">{projectLabel(project)}</span>
          </span>
          <ChevronsUpDown size={14} className="text-dim shrink-0" />
        </button>
        {creating ? (
          <div className="flex flex-col gap-1">
            <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder={t('noteName')}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setCreating(false); setErr('') } }}
              onBlur={() => !name && setCreating(false)}
              className="px-3 py-2 rounded-lg bg-bg border border-line2 outline-none text-xs placeholder:text-dim" />
            {err && <span className="px-1 text-[11px] text-rose-300">{err}</span>}
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="flex items-center justify-center gap-2 py-2 rounded-lg bg-fg text-bg hover:bg-fg/90 text-xs font-semibold">
            <Plus size={14} />{t('newNote')}<kbd className="ml-1 text-[10px] opacity-60">Ctrl N</kbd>
          </button>
        )}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg border border-line focus-within:border-line2">
          <Search size={13} className="text-dim" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onSelect(shown[0].name); setQ('') } }}
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-dim" />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((x) => (
              <button key={x} onClick={() => setTag(tag === x ? '' : x)}
                className={`px-2 py-0.5 rounded-full text-[11px] border ${tag === x ? 'bg-panel border-line2 text-fg' : 'bg-bg border-line text-dim hover:text-fg'}`}>#{x}</button>
            ))}
          </div>
        )}
      </div>

      <ul className="flex-1 overflow-auto px-2 pb-2">
        {shown.map((n) => {
          const on = n.name === current
          return (
            <li key={n.name}>
              <button onClick={() => onSelect(n.name)}
                onContextMenu={(e) => onMenu(e, [{ label: t('copyLink'), onClick: () => onCopy(n.name) }, { label: t('deleteNote'), danger: true, onClick: () => onDelete(n.name) }])}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg ${on ? 'bg-panel text-fg' : 'text-mut hover:bg-panel/60 hover:text-fg'}`}>
                <FileText size={14} className={on ? 'text-fg' : 'text-dim'} />
                <span className="truncate">{n.name}</span>
                <span title={t('connections')} className="ml-auto text-[10px] text-dim tabular-nums">{links(n.content).length || ''}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-2 px-4 py-3 border-t border-line text-[11px] text-dim">
        <span>{notes.length} {t('notes')} · {total.d} tok vs {total.m} md</span>
        {onRescan && <button onClick={onRescan} title={t('rescan')} className="ml-auto p-1 rounded text-dim hover:text-fg hover:bg-panel"><RefreshCw size={13} /></button>}
      </div>
    </aside>
  )
}
