// Lists every `shortcut:` comment (a deliberate shortcut with its limit and when to upgrade) so "later" does not become "never".
// Run: node mcp/debt.mjs [dir...]   (default: the current folder)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', '__pycache__', '.venv', '.armyx'])
const TEXT = /\.(mjs|cjs|js|jsx|ts|tsx|rs|py|go|rb|java|kt|php|swift|cs|c|h|cpp|sh|md)$/

/** `shortcut:` inside a comment (// # /* * -- ;), one entry per line. */
export const findDebt = (text, file) => text.split('\n').flatMap((l, i) => {
  const m = l.match(/(?:\/\/|#|\/\*|^\s*\*|--|;)\s*shortcut:\s*(.+?)\s*(?:\*\/)?$/)
  return m ? [{ file, line: i + 1, text: m[1] }] : []
})

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  SKIP.has(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : TEXT.test(e.name) ? [join(dir, e.name)] : [])

export const debt = (dirs) => dirs.flatMap(walk).flatMap((f) => { try { return findDebt(readFileSync(f, 'utf8'), f.replaceAll('\\', '/')) } catch { return [] } })

if (process.argv[1]?.endsWith('debt.mjs')) {
  const items = debt(process.argv.length > 2 ? process.argv.slice(2) : ['.'])
  console.log(items.length ? items.map((d) => `${d.file}:${d.line}  ${d.text}`).join('\n') : 'no shortcut: comments')
  console.log(`${items.length} shortcut(s)`)
}
