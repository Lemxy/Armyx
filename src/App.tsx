import { useEffect, useRef, useState } from 'react'
import { Bot, FilePlus2, Gauge, Network, PenLine, Settings } from 'lucide-react'
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
  const [tab, setTab] = useState<Tab>('editor')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [agents, setAgents] = useState(false)
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
  const iconBtn = (on: boolean) => `p-2 rounded-lg ${on ? 'bg-panel text-fg' : 'text-dim hover:text-fg hover:bg-panel/60'}`

  return (
    <div className="h-full flex text-sm">
      <Sidebar notes={notes} current={current} project={project} onSelect={open} onNew={(n) => { create(n); open(n) }}
        onMenu={showMenu} onCopy={copyLink} onDelete={setDeleting} onProjects={() => setModal('project')} onRescan={inTauri ? () => rescan().catch(console.error) : undefined} />
      <main className="flex-1 flex flex-col min-w-0">
        <nav className="flex items-center gap-3 px-4 h-12 border-b border-line bg-surface">
          <div className="flex gap-1 p-1 rounded-lg bg-bg border border-line">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${tab === id ? 'bg-panel text-fg' : 'text-dim hover:text-fg'}`}>
                <Icon size={13} />{t(label)}
              </button>
            ))}
          </div>
          <span title={scanned ? t('mapTip') : backend} className="ml-auto px-2.5 py-1 rounded-full bg-bg border border-line text-[11px] text-dim">
            {scanned
              ? <>{t('mapBadge', { m: k(scanned.map), s: k(scanned.src) })}</>
              : <><span className="text-emerald-300 font-medium">−{total.pct}%</span> {t('tokens')}</>}
          </span>
          <button onClick={() => setAgents((a) => !a)} title={t('agentsTitle')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${agents ? 'bg-panel border-line2 text-fg' : 'border-line text-mut hover:text-fg hover:border-line2'}`}>
            <Bot size={14} />{t('agents')}
          </button>
          <button onClick={() => setModal('settings')} title={t('settings')} className={iconBtn(false)}><Settings size={15} /></button>
        </nav>
        <div key={tab} className="flex-1 min-h-0 anim-fade">
          {tab === 'graph' ? <CircuitGraph notes={notes} current={current} onOpen={open} onNew={create}
              onMenu={showMenu} onCopy={copyLink} onDelete={setDeleting} />
            : !note ? (
              <div className="h-full grid place-items-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid place-items-center w-14 h-14 rounded-xl bg-panel border border-line"><FilePlus2 size={24} className="text-fg" /></span>
                  <h2 className="text-base font-semibold">{t('emptyTitle')}</h2>
                  <p className="text-dim text-xs max-w-xs">{t('emptySub')}</p>
                  <button onClick={() => setCreating(true)} className="px-4 py-2 rounded-lg bg-fg text-bg hover:bg-fg/90 text-xs font-semibold">{t('createFirst')}</button>
                </div>
              </div>)
            : tab === 'editor' ? <Editor key={note.name} note={note} notes={notes} onChange={(c) => update(note.name, c)} />
            : <TokenInspector note={note} />}
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
          <p className="text-mut">{t('deleteConfirm', { n: deleting })}</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting('')} className="px-3.5 py-2 rounded-lg border border-line text-xs text-mut hover:text-fg hover:border-line2">{t('cancel')}</button>
            <button autoFocus onClick={() => remove(deleting)} className="px-3.5 py-2 rounded-lg bg-rose-500/90 text-white text-xs font-semibold hover:bg-rose-500">{t('delete')}</button>
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
          className="px-3 py-2 rounded-lg bg-surface border border-line focus:border-line2 outline-none text-xs placeholder:text-dim" />
        {err && <span className="text-[11px] text-rose-300">{err}</span>}
        <button disabled={!n || !!err} className="py-2 rounded-lg bg-fg text-bg hover:bg-fg/90 text-xs font-semibold disabled:opacity-40">{t('noteCreate')}</button>
      </form>
    </Modal>
  )
}
