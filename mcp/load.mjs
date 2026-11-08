// Reads a graph dir for the hook and the server: one unreadable or empty note is skipped (not fatal), and an old scanner's graph is flagged.
import { readdirSync, readFileSync } from 'node:fs'
import { staleSchema } from '../src/deso.ts'

export const loadNotes = (dir) => {
  const notes = []
  let files = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.deso')).sort() } catch (e) { if (e.code !== 'ENOENT') throw e } // no graph yet: nothing to say, not an error
  for (const f of files) {
    try {
      const content = readFileSync(`${dir}/${f}`, 'utf8')
      if (content.trim()) notes.push({ name: f.slice(0, -5), content })
    } catch (e) { console.error(`armyx: skipped ${f}: ${e.message}`) }
  }
  if (staleSchema(notes)) console.error('armyx: this graph came from an older scanner (links guessed by name are not marked with ~); scan it again')
  return notes
}
