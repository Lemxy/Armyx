import { useEffect, useRef, useState } from 'react'
import { Bot, Gauge, Network, PenLine, Settings } from 'lucide-react'
import { mapVsSource, savings, type Note } from './deso'
import { backend, deleteNote, inTauri, loadNotes, rescanProject, saveNote, activeProject, switchProject } from './vault'
import { useI18n } from './i18n'
import SettingsModal from './components/SettingsModal'
import ProjectModal from './components/ProjectModal'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import CircuitGraph from './components/CircuitGraph'
import TokenInspector from './components/TokenInspector'
import ContextMenu, { type MenuItem, type MenuState } from './components/ContextMenu'
import AgentSidebar from './components/AgentSidebar'
import Modal from './components/Modal'

const TABS = [['editor', 'editor', PenLine], ['graph', 'graph', Network], ['tokens', 'tokensTab', Gauge]] as const
type Tab = (typeof TABS)[number][0]

export default function App() {
  const { t } = useI18n()
  const [modal, setModal] = useState<'settings' | 'project' | null>(null)
  const [project, setProject] = useState(activeProject())
  const [notes, setNotes] = useState<Note[]>([])
  const [current, setCurrent] = useState('')
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((x) => x[0] === q) ? (q as Tab) : 'editor'
  })
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [agents, setAgents] = useState(new URLSearchParams(window.location.search).get('agents') === '1')
  const [deleting, setDeleting] = useState('')
  const [creating, setCreating] = useState(false)
  // Pending debounced saves, one per note, so edits to different notes never cancel each other.
  const pending = useRef(new Map<string, { id: number; run: () => Promise<void> }>())
  const flush = async () => {
    const all = [...pending.current.values()]
    pending.current.clear()
    all.forEach((p) => clearTimeout(p.id))
    await Promise.all(all.map((p) => p.run().catch(console.error)))
  }

  useEffect(() => {
    loadNotes().then((n) => { setNotes(n); setCurrent(n[0]?.name ?? '') }).catch(console.error)
  }, [])

  // Native feel: no browser context menu anywhere; Ctrl/Cmd+J toggles the agent panel.
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault()
    const hot = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'j') { e.preventDefault(); setAgents((a) => !a) } }
    window.addEventListener('contextmenu', block)
    window.addEventListener('keydown', hot)
    return () => { window.removeEventListener('contextmenu', block); window.removeEventListener('keydown', hot) }
  }, [])

  const changeProject = async (id: string) => {
    await flush() // old project's pending edits must hit the old folder, before the root changes
    await switchProject(id)
    const n = await loadNotes()
    setProject(activeProject()); setNotes(n); setCurrent(n[0]?.name ?? ''); setModal(null)
  }

  const rescan = async () => {
    await flush()
    await rescanProject()
    const n = await loadNotes()
    setNotes(n); setCurrent((c) => (n.some((x) => x.name === c) ? c : n[0]?.name ?? ''))
  }

  const update = (name: string, content: string) => {
    const all = notes.some((n) => n.name === name)
      ? notes.map((n) => (n.name === name ? { ...n, content } : n))
      : [...notes, { name, content }].sort((a, b) => a.name.localeCompare(b.name))
    setNotes(all)
    clearTimeout(pending.current.get(name)?.id)
    const run = () => saveNote({ name, content }, all)
    pending.current.set(name, { id: window.setTimeout(() => { pending.current.delete(name); run().catch(console.error) }, 400), run })
  }

  const showMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault(); e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  const copyLink = (n: string) => navigator.clipboard.writeText('@' + n).catch(console.error)
  const remove = (name: string) => {
    setDeleting('')
    const rest = notes.filter((n) => n.name !== name)
    const p = pending.current.get(name)
    if (p) { clearTimeout(p.id); pending.current.delete(name) }
    setNotes(rest)
    if (current === name) setCurrent(rest[0]?.name ?? '')
    deleteNote(name, rest).catch(console.error)
  }

  const note = notes.find((n) => n.name === current)
  const total = savings(notes.map((n) => n.content).join('\n'))
  const scanned = mapVsSource(notes)
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
  const open = (n: string) => { setCurrent(n); setTab('editor') }
  const create = (n: string) => update(n, `# ${n}\n`)
  const iconBtn = 'p-1.5 rounded-[2px] border border-line bg-field hover:border-line2 text-mut hover:text-fg'

  return (
    <div className="h-full flex text-sm">
      <Sidebar notes={notes} current={current} project={project} onSelect={open} onNew={(n) => { create(n); open(n) }}
        onMenu={showMenu} onCopy={copyLink} onDelete={setDeleting} onProjects={() => setModal('project')} onRescan={inTauri ? () => rescan().catch(console.error) : undefined} />
      <main className="flex-1 flex flex-col min-w-0">
        <nav className="flex items-center gap-3 px-3 h-11 border-b border-line bg-surface">
          <div className="flex gap-4 self-stretch">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 text-xs tracking-wide whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-accent text-fg font-medium' : 'border-transparent text-dim hover:text-mut'}`}>
                <Icon size={12} />{t(label)}
              </button>
            ))}
          </div>
          <span title={scanned ? t('mapTip') : backend} className="ml-auto border border-line bg-field px-2 py-0.5 text-micro text-dim tabular-nums font-mono">
            {scanned
              ? <>{t('mapBadge', { m: k(scanned.map), s: k(scanned.src) })}</>
              : <><span className="text-accent">−{total.pct}%</span> {t('tokens')}</>}
          </span>
          <button onClick={() => setAgents((a) => !a)} title={t('agentsTitle')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] border bg-field hover:border-line2 text-micro tracking-wide uppercase font-mono ${agents ? 'border-accent text-fg' : 'border-line text-mut hover:text-fg'}`}>
            <Bot size={13} />{t('agents')}
          </button>
          <button onClick={() => setModal('settings')} title={t('settings')} className={iconBtn}><Settings size={14} /></button>
        </nav>
        <div key={tab} className="flex-1 min-h-0 anim-fade">
          {tab === 'graph' ? <CircuitGraph notes={notes} current={current} onOpen={open} onNew={create}
              onMenu={showMenu} onCopy={copyLink} onDelete={setDeleting} />
            : !note ? (
              <div className="h-full flex items-center pl-[12%] gap-10 font-mono">
                <svg width="168" height="76" viewBox="0 0 168 76" fill="none" stroke="var(--line2)" strokeWidth="1" aria-hidden className="shrink-0">
                  <path d="M4 38 H58" /><path d="M58 38 L98 18" stroke="var(--accent)" /><path d="M98 38 H164" strokeDasharray="3 4" />
                  <circle cx="4" cy="38" r="2.5" fill="var(--line2)" /><circle cx="58" cy="38" r="2.5" fill="var(--line2)" />
                  <rect x="94" y="34" width="8" height="8" /><circle cx="164" cy="38" r="2.5" />
                  <path d="M20 58 V68 M16 68 H24" /><path d="M130 58 V68 M126 68 H134" />
                </svg>
                <div className="flex flex-col gap-2 items-start">
                  <span className="text-micro tracking-widest text-dim">STATUS: NO ACTIVE LOG</span>
                  <span className="text-micro tracking-widest text-dim">CIRCUIT: OPEN</span>
                  <span className="text-xs text-mut mt-1">INITIALIZE NODE TO ENERGIZE GRAPH</span>
                  <button onClick={() => setCreating(true)} className="mt-2 px-2.5 py-1 rounded-[2px] border border-line bg-field hover:border-accent text-micro uppercase tracking-wider text-fg">{t('createFirst')}</button>
                </div>
              </div>)
            : tab === 'editor' ? <Editor key={note.name} note={note} notes={notes} onChange={(c) => update(note.name, c)} />
            : <TokenInspector note={note} scanned={scanned} />}
        </div>
      </main>
      {agents && <AgentSidebar key={project} notes={notes} note={note} project={project} onClose={() => setAgents(false)}
        onInsert={(x) => note && update(note.name, note.content.replace(/\n*$/, '\n') + x + '\n')} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'project' && <ProjectModal active={project} onSwitch={changeProject} onClose={() => setModal(null)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {creating && <FirstNote taken={notes} onCreate={(n) => { create(n); open(n); setCreating(false) }} onClose={() => setCreating(false)} />}
      {deleting && (
        <Modal title={t('deleteTitle')} onClose={() => setDeleting('')}>
          <p className="text-mut font-mono text-xs">{t('deleteConfirm', { n: deleting })}</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting('')} className="px-3 py-1.5 rounded-[2px] border border-line bg-field text-micro uppercase tracking-wider text-mut hover:text-fg hover:border-line2">{t('cancel')}</button>
            <button autoFocus onClick={() => remove(deleting)} className="px-3 py-1.5 rounded-[2px] border border-status-err text-micro uppercase tracking-wider text-status-err hover:bg-status-err hover:text-bg">{t('delete')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function FirstNote({ taken, onCreate, onClose }: { taken: Note[]; onCreate: (n: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const n = name.trim().toLowerCase()
  const err = n && !/^[a-z0-9_-]+$/.test(n) ? t('noteBad') : taken.some((x) => x.name === n) ? t('noteExists') : ''
  return (
    <Modal title={t('newNote')} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (n && !err) onCreate(n) }} className="flex flex-col gap-3">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('noteName')}
          className="px-3 py-1.5 rounded-[2px] bg-field border border-line focus:border-accent outline-none text-xs font-mono placeholder:text-dim" />
        {err && <span className="text-micro text-status-err">{err}</span>}
        <button disabled={!n || !!err} className="py-1.5 rounded-[2px] border border-accent text-accent hover:bg-accent-dim text-micro uppercase tracking-wider disabled:opacity-40">{t('noteCreate')}</button>
      </form>
    </Modal>
  )
}
