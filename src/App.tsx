import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebounced } from './debounce'
import { Gauge, Network, PenLine, Settings, Sparkles, Workflow } from 'lucide-react'
import { mapVsSource, prop, savings, type Note } from './deso'
import { backend, deleteNote, inTauri, loadNotes, onGraphChanged, rescanProject, saveNote, activeProject, switchProject, watchProject } from './vault'
import { useI18n } from './i18n'
import SettingsModal from './components/SettingsModal'
import ProjectModal from './components/ProjectModal'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import FileSplit from './components/SourceEditor'
import CircuitGraph from './components/CircuitGraph'
import TokenInspector from './components/TokenInspector'
import ContextMenu, { type MenuItem, type MenuState } from './components/ContextMenu'
import Orchestra from './components/Orchestra'
import AgentSidebar from './components/AgentSidebar'
import Modal from './components/Modal'
import Segmented from './components/Segmented'

const TABS = [['editor', 'editor', PenLine], ['graph', 'graph', Network], ['orchestra', 'orchestra', Workflow], ['tokens', 'tokensTab', Gauge]] as const
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
  const [agents, setAgents] = useState(new URLSearchParams(window.location.search).get('agents') !== '0') // open by default
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

  // The graph follows the code: a watcher in the backend re-scans after files change; generated notes are swapped in, what you wrote or are editing stays.
  useEffect(() => {
    const gen = (n: Note) => n.content.includes('?generated: scan')
    watchProject().catch(console.error)
    const off = onGraphChanged(() => loadNotes().then((fresh) => setNotes((cur) => [...cur.filter((n) => !gen(n)), ...fresh.filter(gen)].sort((a, b) => a.name.localeCompare(b.name)))).catch(console.error))
    return () => { off.then((f) => f()) }
  }, [project])

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
  // Whole-project token stats are heavy on a big scan: compute them off the typing path, and only when the notes change.
  const lazyNotes = useDebounced(notes)
  const total = useMemo(() => savings(lazyNotes.map((n) => n.content).join('\n')), [lazyNotes])
  const scanned = useMemo(() => mapVsSource(lazyNotes), [lazyNotes])
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
  const open = (n: string) => { setCurrent(n); setTab('editor') }
  const create = (n: string) => update(n, `# ${n}\n`)
  const iconBtn = 'btn-press p-2 rounded-full text-mut hover:text-fg hover:bg-panel'

  return (
    <div className="h-full flex text-sm">
      <Sidebar notes={notes} current={current} project={project} onSelect={open} onNew={(n) => { create(n); open(n) }}
        onMenu={showMenu} onCopy={copyLink} onDelete={setDeleting} onProjects={() => setModal('project')} onRescan={inTauri ? () => rescan().catch(console.error) : undefined} />
      <main className="flex-1 flex flex-col min-w-0">
        <nav className="flex items-center gap-4 px-5 h-14 border-b border-line bg-surface">
          <Segmented<Tab> value={tab} onChange={setTab} className="w-[36rem] min-w-0 shrink"
            options={TABS.map(([id, label, Icon]) => [id, <><Icon size={13} />{t(label)}</>] as const)} />
          <span title={scanned ? t('mapTip') : backend} className="ml-auto text-micro text-dim tabular-nums">
            {scanned
              ? <>{t('mapBadge', { m: k(scanned.map), s: k(scanned.src) })}</>
              : <><span className="font-serif text-base font-semibold text-accent">−{total.pct}%</span> {t('tokens')} {t('tokSaved')}</>}
          </span>
          {tab !== 'orchestra' && <button onClick={() => setAgents((a) => !a)} title={t('agentsTitle')}
            className={`btn-press flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs ${agents ? 'border-accent text-accent bg-accent-dim' : 'border-line text-mut hover:text-fg hover:border-line2'}`}>
            <Sparkles size={13} />{t('agents')}
          </button>}
          <button onClick={() => setModal('settings')} title={t('settings')} className={iconBtn}><Settings size={15} /></button>
        </nav>
        {/* Always mounted (just hidden) so a running orchestra keeps working while you are on another tab. */}
        <div className={`flex-1 min-h-0 ${tab === 'orchestra' ? '' : 'hidden'}`}><Orchestra key={project} notes={notes} project={project} onMenu={showMenu} /></div>
        <div key={tab} className={`flex-1 min-h-0 anim-fade ${tab === 'orchestra' ? 'hidden' : ''}`}>
          {tab === 'graph' ? <CircuitGraph notes={notes} current={current} onOpen={open} onNew={create}
              onMenu={showMenu} onCopy={copyLink} onDelete={setDeleting} project={project} />
            : tab === 'orchestra' ? null
            : !note ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-center anim-rise">
                <svg width="44" height="44" viewBox="0 0 18 18" fill="none" stroke="var(--accent)" strokeWidth=".6" aria-hidden>
                  <path d="M9 1.5 L16.5 9 L9 16.5 L1.5 9 Z" /><path d="M9 5.5 L12.5 9 L9 12.5 L5.5 9 Z" />
                </svg>
                <h1 className="font-serif text-[40px] leading-tight font-medium">{t('emptyTitle')}</h1>
                <p className="text-mut max-w-xs">{t('emptySub')}</p>
                <button onClick={() => setCreating(true)} className="btn-press mt-2 px-5 py-2.5 rounded-full bg-accent text-bg text-sm font-medium hover:opacity-90">{t('createFirst')}</button>
              </div>)
            : tab === 'editor' ? (inTauri && prop(note.content, 'path') ? <FileSplit key={note.name} note={note} notes={notes} onChange={(c) => update(note.name, c)} /> : <Editor key={note.name} note={note} notes={notes} onChange={(c) => update(note.name, c)} />)
            : <TokenInspector note={note} scanned={scanned} />}
        </div>
      </main>
      {agents && tab !== 'orchestra' && <AgentSidebar key={project} notes={notes} note={note} project={project} onClose={() => setAgents(false)}
        onInsert={(x) => note && update(note.name, note.content.replace(/\n*$/, '\n') + x + '\n')} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'project' && <ProjectModal active={project} onSwitch={changeProject} onClose={() => setModal(null)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {creating && <FirstNote taken={notes} onCreate={(n) => { create(n); open(n); setCreating(false) }} onClose={() => setCreating(false)} />}
      {deleting && (
        <Modal title={t('deleteTitle')} onClose={() => setDeleting('')}>
          <p className="text-mut">{t('deleteConfirm', { n: deleting })}</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting('')} className="btn-press px-4 py-2 rounded-full border border-line text-xs text-mut hover:text-fg hover:border-line2">{t('cancel')}</button>
            <button autoFocus onClick={() => remove(deleting)} className="btn-press px-4 py-2 rounded-full bg-status-err text-bg text-xs font-medium hover:opacity-90">{t('delete')}</button>
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
          className="px-3.5 py-2 rounded-xl bg-field border border-line focus:border-accent outline-none text-sm placeholder:text-dim" />
        {err && <span className="text-micro text-status-err">{err}</span>}
        <button disabled={!n || !!err} className="btn-press py-2 rounded-full bg-accent text-bg text-sm font-medium hover:opacity-90 disabled:opacity-30">{t('noteCreate')}</button>
      </form>
    </Modal>
  )
}
