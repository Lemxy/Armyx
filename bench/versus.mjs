// Plain Claude Code vs Claude Code through Armyx, on the same "which file does X" questions. Real `claude -p` runs, numbers from the API usage report.
//   plain   your Claude Code as is (claude.ai connectors on, no plugin)
//   nomcp   the claude.ai connectors switched off (ENABLE_CLAUDEAI_MCP_SERVERS=false), nothing else
//   armyx   nomcp + the armyx plugin (map and best matches by hook; graph read from ARMYX_GRAPH)
// All arms get Read, Grep and Glob. The first call per arm only warms the prompt cache and is reported separately.
//   node --experimental-strip-types --no-warnings bench/versus.mjs <project> <graph dir> <questions.json> [model] [out.json]   Env: REPS=1
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const [project, graph, qfile, model = 'claude-haiku-5-5', outFile = 'bench/results.versus.json'] = process.argv.slice(2)
const questions = JSON.parse(readFileSync(qfile, 'utf8'))
const reps = Number(process.env.REPS ?? 1)
const plugin = fileURLToPath(new URL('../plugin/armyx', import.meta.url)).replaceAll('\\', '/')

const arms = {
  plain: { env: {}, args: [] },
  nomcp: { env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }, args: [] },
  armyx: { env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', ARMYX_GRAPH: graph }, args: ['--plugin-dir', plugin] },
}
const active = Object.keys(arms).filter((a) => !process.env.ARMS || process.env.ARMS.split(',').includes(a))

const run = (text, arm) => new Promise((res) => {
  const a = arms[arm]
  const p = spawn('claude', ['-p', '--output-format', 'json', '--model', model, '--tools', 'Read,Grep,Glob', '--max-budget-usd', '1', '--no-session-persistence', ...a.args], { cwd: project, env: { ...process.env, ...a.env } })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.on('close', () => {
    try {
      const j = JSON.parse(out), u = j.usage ?? {}
      res({ answer: (j.result ?? '').trim(), turns: j.num_turns, usd: j.total_cost_usd, ms: j.duration_ms,
        input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 })
    } catch { res({ answer: '', turns: 0, usd: 0, input: 0, output: 0, ms: 0, failed: true }) }
  })
  p.stdin.end(text)
})

const warm = {}
for (const arm of active) { await run('Reply with OK.', arm); warm[arm] = await run('Reply with OK.', arm) } // second call = steady-state overhead of a trivial prompt
console.log('trivial prompt, steady state', JSON.stringify(Object.fromEntries(active.map((a) => [a, { input: warm[a].input, usd: warm[a].usd }]))))

const jobs = Array.from({ length: reps }, (_, rep) => questions.flatMap(({ q, expect }) => active.map((arm) => ({ q, expect: [].concat(expect), arm, rep })))).flat()
const rows = []
let next = 0
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < jobs.length) {
    const { q, expect, arm, rep } = jobs[next++]
    const r = await run(q, arm)
    const answer = r.answer.replaceAll('\\', '/')
    const recall = expect.filter((e) => answer.includes(e)).length / expect.length
    rows.push({ q, arm, rep, ok: recall === 1, recall, expect, ...r })
    console.log(arm.padEnd(6), recall === 1 ? 'OK  ' : `${Math.round(recall * 100)}%`.padEnd(4), `turns=${r.turns} input=${r.input} $${r.usd?.toFixed(4)}`, r.failed ? 'FAILED' : '')
  }
}))
const sum = (a, k) => rows.filter((r) => r.arm === a).reduce((s, r) => s + (r[k] ?? 0), 0)
const base = {}
for (const a of active) {
  const n = rows.filter((r) => r.arm === a).length
  base[a] = { n, usd: sum(a, 'usd'), turns: sum(a, 'turns'), input: sum(a, 'input'), sec: sum(a, 'ms') / n / 1000 }
  console.log(a.padEnd(6), 'correct', `${rows.filter((r) => r.arm === a && r.ok).length}/${n}`, 'recall', (sum(a, 'recall') / n).toFixed(2), 'usd', base[a].usd.toFixed(4), `($${(base[a].usd / n).toFixed(5)}/q)`, 'turns', base[a].turns, 'input', base[a].input, 'avg s', base[a].sec.toFixed(1))
}
if (base.plain) for (const a of active.filter((x) => x !== 'plain')) console.log(`${a} vs plain: cost ${((1 - base[a].usd / base.plain.usd) * 100).toFixed(0)}% cheaper, input ${((1 - base[a].input / base.plain.input) * 100).toFixed(0)}% less, turns ${base.plain.turns} -> ${base[a].turns}`)
writeFileSync(outFile, JSON.stringify({ project, model, reps, warm: Object.fromEntries(active.map((a) => [a, { input: warm[a].input, usd: warm[a].usd }])), rows }, null, 2))
