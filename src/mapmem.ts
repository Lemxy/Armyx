// What the map remembers about a project between sessions (local storage): the number of each note, and which files agents opened.
import { mapIds, type MapOpts, type Note } from './deso'
import { activeProject } from './vault'

const IDS = 'desovault.mapids', HEAT = 'desovault.heat', CO = 'desovault.coread'
const CO_MAX = 2000 // pairs kept; the rarest go first
const load = (k: string) => { try { return new Map<string, number>(JSON.parse(localStorage.getItem(`${k}.${activeProject()}`) ?? '[]')) } catch { return new Map<string, number>() } }
const save = (k: string, m: Map<string, number>) => { try { localStorage.setItem(`${k}.${activeProject()}`, JSON.stringify([...m])) } catch (e) { console.error(e) } }

/** The saved note numbers, extended with any new note (see `mapIds`). */
export const projectIds = (notes: Note[]) => {
  const prev = load(IDS), ids = mapIds(notes, prev)
  if (ids.size > prev.size) save(IDS, ids)
  return ids
}
export const mapOpts = (notes: Note[]): MapOpts => ({ ids: projectIds(notes), heat: load(HEAT) })
export const coRead = () => load(CO)

/** One agent call opened these project files: each gets warmer, and each pair is remembered as read together. */
export const recordRead = (files: string[] = []) => {
  const f = [...new Set(files)].slice(0, 8).sort()
  if (!f.length) return
  const heat = load(HEAT), co = load(CO)
  for (const p of f) heat.set(p, (heat.get(p) ?? 0) + 1)
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) co.set(`${f[i]}|${f[j]}`, (co.get(`${f[i]}|${f[j]}`) ?? 0) + 1)
  save(HEAT, heat)
  save(CO, co.size > CO_MAX ? new Map([...co].sort((a, b) => b[1] - a[1]).slice(0, CO_MAX)) : co)
}
