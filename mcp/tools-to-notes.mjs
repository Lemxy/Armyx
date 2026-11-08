// Turns Claude Code skills (SKILL.md files) into .deso notes, one per skill, so the graph ranking can find them like files.
// Run: node mcp/tools-to-notes.mjs <out dir> <skills dir>...   (searched recursively; later dirs do not override earlier ones)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const find = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name)
  return e.isDirectory() ? find(p) : e.name === 'SKILL.md' ? [p] : []
})

// shortcut: reads only single-line `name:`/`description:` frontmatter, upgrade to a YAML parser if a skill folds them over lines
export const parseSkill = (src) => {
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '')
  const name = get('name'), about = get('description')
  return name && about ? { name, about: about.replace(/\\"/g, '"').replace(/\s+/g, ' ').slice(0, 300) } : null
}

// path = where the agent can Read the full skill, so a session with skills switched off can still use it
export const toNote = ({ name, about, file }) => `# ${name.toUpperCase()}\n#skill\n?path:${file ?? `skill:${name}`}\n?about:${about}\n`

if (process.argv[1]?.endsWith('tools-to-notes.mjs')) {
  const [out, ...dirs] = process.argv.slice(2)
  if (!out || !dirs.length) { console.error('usage: tools-to-notes.mjs <out dir> <skills dir>...'); process.exit(1) }
  mkdirSync(out, { recursive: true })
  const seen = new Set()
  for (const d of dirs) for (const f of find(d)) {
    const s = parseSkill(readFileSync(f, 'utf8'))
    if (!s || seen.has(s.name)) continue
    s.file = f.replaceAll('\\', '/')
    seen.add(s.name)
    writeFileSync(join(out, `skill-${s.name.replace(/[^\w-]/g, '_')}.deso`), toNote(s))
  }
  console.log(`${seen.size} skills -> ${out}`)
}
