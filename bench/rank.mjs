// Offline ranking check (no API calls): share of the expected files found in the top k, with and without the folder spread.
//   node --experimental-strip-types --no-warnings bench/rank.mjs <project> <questions.json> [graph dir]
// Without a graph dir the project is scanned into a temp dir (needs cargo).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { diverse, scoredHits } from '../src/deso.ts'
import { loadNotes } from '../mcp/load.mjs'

const [project, qfile, given] = process.argv.slice(2)
let graph = given
if (!graph) {
  graph = mkdtempSync(`${tmpdir()}/armyx-rank-`)
  execFileSync('cargo', ['run', '-q', '--example', 'scan', '--', project, graph], { cwd: fileURLToPath(new URL('../src-tauri', import.meta.url)), stdio: 'inherit' })
}
const notes = loadNotes(graph)
const questions = JSON.parse(readFileSync(qfile, 'utf8'))
const path = (n) => n.content.match(/^\?path:\s*(.+)$/m)?.[1].trim()
for (const [label, spread] of [['no spread', false], ['spread', true]]) {
  const row = {}
  for (const k of [1, 3, 5, 12]) {
    let sum = 0
    for (const { q, expect } of questions) {
      const want = [].concat(expect), got = new Set(diverse(scoredHits(notes, q).map((h) => h.note), k, undefined, spread).map(path))
      sum += want.filter((e) => got.has(e)).length / want.length
    }
    row[`recall@${k}`] = (sum / questions.length).toFixed(3)
  }
  console.log(label.padEnd(10), JSON.stringify(row), `${notes.length} notes, ${questions.length} questions`)
}
