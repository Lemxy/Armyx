// Multi-file questions for any Python project, with ground truth from plain text, not from the graph:
//   "Which files (not tests) use the function/class `Sym`, defined in <path>?"
// Sym is a top-level def/class defined in exactly one non-test file and mentioned (as a whole word) in 3-8 other non-test files;
// those files are the answer. Grep can do this too, so the test shows what the graph adds (or costs) on a task grep is made for.
//   node bench/genrefs.mjs <project dir> <count> [seed] > questions.json
import { readdirSync, readFileSync, statSync } from 'node:fs'

const [root, count = '20', seed = '7'] = process.argv.slice(2)
const files = []
const walk = (d) => { for (const e of readdirSync(d)) { if (e.startsWith('.') || e === 'node_modules') continue; const p = `${d}/${e}`; statSync(p).isDirectory() ? walk(p) : e.endsWith('.py') && !/test/i.test(p) && files.push(p) } }
walk(root)
const rel = (p) => p.slice(root.length + 1).replaceAll('\\', '/')
const src = new Map(files.map((p) => [rel(p), readFileSync(p, 'utf8')]))
const words = new Map([...src].map(([p, s]) => [p, new Set(s.split(/[^A-Za-z0-9_]/).filter((w) => w.length >= 6))]))
const defs = new Map()
for (const [p, s] of src) for (const m of s.matchAll(/^(?:def|class) ([A-Za-z]\w{5,})/gm)) defs.set(m[1], [...(defs.get(m[1]) ?? []), p])
let s = Number(seed)
const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
const out = []
for (const [sym, at] of [...defs].sort(() => rnd() - 0.5)) {
  if (at.length !== 1) continue
  const users = [...words].filter(([p, w]) => p !== at[0] && w.has(sym)).map(([p]) => p).sort()
  if (users.length < 3 || users.length > 8) continue
  out.push({ q: `Which files (not tests) use the Python function or class \`${sym}\`, defined in ${at[0]}? List every one, repo-relative paths only, one per line.`, expect: users, defined: at[0], verify: sym })
  if (out.length >= Number(count)) break
}
console.log(JSON.stringify(out, null, 1))
