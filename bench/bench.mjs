// Real benchmark: the same questions answered by `claude -p` (a) exploring the project alone and
// (b) with the DesoVault graph map in the prompt. Tokens, cost and turns come from the API's own usage report.
//
//   cargo run --example scan -- <project> <graph dir>   (in src-tauri/)
//   node bench/bench.mjs <project> <graph dir> bench/questions.horizon.json [model]
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { MAP_INTRO } from '../src/deso.ts'

const [project, graph, qfile, model = 'claude-haiku-5-5'] = process.argv.slice(2)
const questions = JSON.parse(readFileSync(qfile, 'utf8'))
const map = execFileSync('node', ['bench/map.mjs', graph], { encoding: 'utf8', maxBuffer: 1 << 26 })
const SYSTEM = `You are the assistant inside DesoVault, a knowledge-graph note app. ${MAP_INTRO} Be concise.\n\n# Graph map\n`

function run(prompt) {
  const r = spawnSync('claude', ['-p', '--output-format', 'json', '--model', model, '--tools', 'Read,Grep,Glob', '--max-budget-usd', '1', '--no-session-persistence'],
    { cwd: project, input: prompt, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600000 })
  const j = JSON.parse(r.stdout)
  const u = j.usage ?? {}
  return { answer: (j.result ?? '').trim(), turns: j.num_turns, usd: j.total_cost_usd,
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0, ms: j.duration_ms }
}

const rows = []
for (const { q, expect } of questions) {
  for (const [mode, prompt] of [['alone', q], ['with-map', `${SYSTEM}${map}\n\n# Question\n${q}`]]) {
    const r = run(prompt)
    const ok = r.answer.replaceAll('\\', '/').includes(expect)
    rows.push({ q: q.slice(0, 60), mode, ok, ...r })
    console.log(mode.padEnd(8), ok ? 'OK  ' : 'MISS', `turns=${r.turns} input=${r.input} output=${r.output} $${r.usd?.toFixed(4)} ${Math.round(r.ms / 1000)}s`)
  }
}
const sum = (m, k) => rows.filter((r) => r.mode === m).reduce((a, r) => a + (r[k] ?? 0), 0)
for (const m of ['alone', 'with-map'])
  console.log(m.padEnd(8), 'correct', rows.filter((r) => r.mode === m && r.ok).length + '/' + questions.length, 'input', sum(m, 'input'), 'output', sum(m, 'output'), 'turns', sum(m, 'turns'), 'usd', sum(m, 'usd').toFixed(4))
writeFileSync('bench/results.json', JSON.stringify({ project, model, mapChars: map.length, rows }, null, 2))
