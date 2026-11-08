// Generates verified questions for any Python project from its own docstrings, so nobody tunes to hand-picked ones:
//   "Which file defines the Python function/class documented as: <first docstring line>?"
// A question is kept only if the identifier is defined once outside tests, the docstring line is unique, and the line does not
// contain the identifier. One question per file, random with a fixed seed.
//   node bench/genq.mjs <project dir> <count> [seed] > questions.json
import { readdirSync, readFileSync, statSync } from 'node:fs'

const [root, count = '40', seed = '7'] = process.argv.slice(2)
const files = []
const walk = (d) => { for (const e of readdirSync(d)) { if (e.startsWith('.') || e === 'node_modules') continue; const p = `${d}/${e}`; statSync(p).isDirectory() ? walk(p) : e.endsWith('.py') && files.push(p) } }
walk(root)

const defs = new Map(), docs = new Map(), cands = []
for (const f of files) {
  const rel = f.slice(root.length + 1)
  const lines = readFileSync(f, 'utf8').split('\n')
  const test = /(^|\/)(tests?|test_[^/]*|testing)(\/|\.py$)/.test(rel)
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:async\s+)?(def|class)\s+(\w+)/)
    if (m && !test) defs.set(m[2], [...(defs.get(m[2]) ?? []), rel])
    const d = lines[i + 1]?.match(/^\s*[rR]?(?:"""|''')\s*(.{30,140}?)\s*(?:"""|''')?$/)
    if (m && d && !test && !m[2].startsWith('_') && m[2].length >= 6) cands.push({ rel, kind: m[1] === 'def' ? 'function' : 'class', name: m[2], doc: d[1].replace(/\s*(?:"""|''')$/, '') })
  })
  for (const l of lines) { const d = l.trim().replace(/^[rR]?("""|''')/, ''); if (d.length >= 30) docs.set(d.slice(0, 60), (docs.get(d.slice(0, 60)) ?? 0) + 1) }
}

let s = Number(seed)
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
const norm = (x) => x.toLowerCase().replace(/_/g, '')
const ok = cands.filter((c) => defs.get(c.name).length === 1 && docs.get(c.doc.slice(0, 60)) === 1 && !norm(c.doc).includes(norm(c.name)) && /^[A-Za-z]/.test(c.doc) && !c.doc.includes('"'))
const used = new Set(), out = []
for (const c of ok.sort(() => rnd() - 0.5)) {
  if (used.has(c.rel) || out.length >= Number(count)) continue
  used.add(c.rel)
  out.push({ q: `Which file defines the Python ${c.kind} documented as: "${c.doc}"? Reply with the repo-relative path only.`, expect: c.rel, verify: c.name })
}
console.error(`${cands.length} candidates, ${ok.length} unambiguous, ${out.length} questions`)
console.log(JSON.stringify(out, null, 1))
