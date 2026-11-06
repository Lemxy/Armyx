import { invoke } from '@tauri-apps/api/core'
import { documentDir, join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import type { Note } from './deso'

const KEY = 'desovault.notes'
const PROJECTS = 'desovault.projects', ACTIVE = 'desovault.active'
export const inTauri = '__TAURI_INTERNALS__' in window

const seed: Note[] = Object.entries(
  import.meta.glob('../vault/*.deso', { query: '?raw', import: 'default', eager: true }),
).map(([p, content]) => ({ name: p.split('/').pop()!.replace('.deso', ''), content: content as string }))

// Static imports: dynamic ones are re-optimized by Vite at runtime and can 404 against a stale dep hash.
const call = <T,>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args)

export const backend = inTauri ? 'TAURI/FS' : 'BROWSER/LOCALSTORAGE'

// Project id = browser: a name; Tauri: a folder path.
const store = (id: string) => (id === 'default' ? KEY : `${KEY}.${id}`)
export const projectLabel = (id: string) => id.split(/[\\/]/).filter(Boolean).pop() ?? id
export const activeProject = () => localStorage.getItem(ACTIVE) ?? 'default'
export const listProjects = (): string[] => {
  const l: string[] = JSON.parse(localStorage.getItem(PROJECTS) ?? '[]')
  return l.includes(activeProject()) ? l : [activeProject(), ...l]
}

export async function loadNotes(): Promise<Note[]> {
  if (inTauri) {
    const id = localStorage.getItem(ACTIVE)
    if (id) await call('set_root', { path: id })
    else localStorage.setItem(ACTIVE, await call<string>('get_root'))
    // A folder with no notes (e.g. someone's code project) gets its graph generated once, in one batch.
    let found = await call<Note[]>('list_notes')
    if (!found.length && (await call<number>('index_project', { force: false }))) found = await call<Note[]>('list_notes')
    return found
  }
  const raw = localStorage.getItem(store(activeProject()))
  return raw ? JSON.parse(raw) : activeProject() === 'default' ? seed : []
}

/** Make `id` the active project (creating it if new) and register it. Caller reloads notes. */
export async function switchProject(id: string) {
  id = id.trim()
  if (inTauri) id = await call<string>('set_root', { path: id })
  localStorage.setItem(PROJECTS, JSON.stringify([...new Set([...listProjects(), id])]))
  localStorage.setItem(ACTIVE, id)
  const w = { name: 'welcome', content: '# welcome\n' }
  if (!(await loadNotes()).length) await saveNote(w, [w])
}

// Browser mode persists the whole vault; Tauri mode writes only the changed file.
export async function saveNote(note: Note, all: Note[]) {
  if (inTauri) await call('save_note', { name: note.name, content: note.content })
  else localStorage.setItem(store(activeProject()), JSON.stringify(all))
}

export async function deleteNote(name: string, rest: Note[]) {
  if (inTauri) await call('delete_note', { name })
  else localStorage.setItem(store(activeProject()), JSON.stringify(rest))
}

export const runAgentCli = (cli: string, prompt: string, model: string, effort: string) => call<string>('run_agent', { cli, prompt, model, effort })
export const agyModels = () => call<[string, string][]>('agy_models')

// ---- Project management ----
const saveList = (l: string[]) => localStorage.setItem(PROJECTS, JSON.stringify(l))

/** Native folder picker (desktop only). Resolves null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  const r = await open({ directory: true, multiple: false, title: 'DesoVault' })
  return typeof r === 'string' ? r : null
}

export const badProjectName = (n: string) => !n.trim() || /[\/:*?"<>|]/.test(n) || n.trim().startsWith('.')

/** Desktop: new projects live in Documents/DesoVault/<name>. Browser: the name is the id. */
export async function newProjectId(name: string): Promise<string> {
  name = name.trim()
  if (!inTauri) return name
  return join(await documentDir(), 'DesoVault', name)
}

/** Forget a project. Desktop: files stay on disk. Browser: its stored notes are deleted. Never the active one. */
export function removeProject(id: string) {
  if (id === activeProject()) return
  saveList(listProjects().filter((p) => p !== id))
  if (!inTauri) localStorage.removeItem(store(id))
}

/** Desktop only: regenerate the scanned part of the graph; hand-written notes are kept. */
export const rescanProject = () => call<number>('index_project', { force: true })
