// Enriches a scanned graph with what a cheap model can say about each file, once, cached by file hash:
//   ?about:    one line, only when the file has no comment to take it from
//   ?keywords: synonyms and user-level words ("email, mail, smtp, reset code") so a question phrased differently still finds the file
//   node bench/describe.mjs <project> <graph dir> [model]
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const [project, graph, model = 'claude-haiku-5-5'] = process.argv.slice(2)
const cacheFile = `${graph}/.about-cache.json`
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
const VERSION = 'v2' // bump when the prompt changes

const ask = (prompt) => new Promise((res) => {
  const p = spawn('claude', ['-p', '--model', model, '--tools', '', '--no-session-persistence', '--max-budget-usd', '0.2'], { cwd: graph })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.on('close', () => res(out.trim()))
  p.stdin.end(prompt)
})

const clean = (s) => s.replace(/^[\s"'`-]+|["'`.\s]+$/g, '').replace(/\s+/g, ' ')
const parse = (out) => ({
  about: clean(out.match(/^ABOUT:\s*(.+)$/im)?.[1] ?? '').slice(0, 100),
  keywords: clean(out.match(/^KEYWORDS:\s*(.+)$/im)?.[1] ?? '').slice(0, 160),})

const todo = readdirSync(graph).filter((f) => f.endsWith('.deso')).flatMap((f) => {
  const src = readFileSync(`${graph}/${f}`, 'utf8')
  const path = src.match(/^\?path:\s*(.+)$/m)?.[1].trim()
  if (!path || !/^\?generated: scan$/m.test(src) || /^\?keywords:/m.test(src) || !existsSync(`${project}/${path}`)) return []
  return [{ f, src, path, code: readFileSync(`${project}/${path}`, 'utf8').slice(0, 6000) }]
})

let next = 0, done = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < todo.length) {
    const t = todo[next++]
    const key = `${VERSION}:${createHash('sha1').update(t.code).digest('hex')}`
    cache[key] ??= parse(await ask(`You index source files so a developer can find them by a question. Answer in exactly two lines.\nABOUT: what this file does, at most 90 characters, no quotes, no final period (name its responsibility and what it serves).\nKEYWORDS: 8 to 12 comma-separated words a developer might use when asking for this file: synonyms, user-level concepts, related technologies. Do not repeat identifiers that are literally in the file name.\n\nFile ${t.path}:\n${t.code}`))
    const { about, keywords } = cache[key]
    let src = t.src
    if (!/^\?about:/m.test(src) && about) src = src.replace(/^(\?lines:.*)$/m, `$1\n?about: ${about}`)
    if (keywords && !/^\?keywords:/m.test(src)) src = src.replace(/^(\?lines:.*)$/m, (l) => `${l}\n?keywords: ${keywords}`)
    writeFileSync(`${graph}/${t.f}`, src)
    console.log(`${++done}/${todo.length}`, t.path, '→', keywords)
  }
}))
writeFileSync(cacheFile, JSON.stringify(cache, null, 1))
