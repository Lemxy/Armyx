// Real benchmark: the same questions answered by `claude -p`, all modes with Read/Grep/Glob available:
//   alone   explores the project by itself
//   map-v3  static map in the system prompt (the API caches it) + the best matches for the question in the user message
//   map-v4  no map: the agent queries the graph through MCP tools (find only)
//   map-v1  the first static map (only with OLD_DESO=<old deso.ts> and OLD_GRAPH=<graph dir from the old scanner>)
// Tokens, cost and turns come from the API's own usage report. `expect` is one path or a list (recall = share of the list found).
//
//   cargo run --example scan -- <project> <graph dir>   (in src-tauri/)
//   node --experimental-strip-types bench/bench.mjs <project> <graph dir> <questions.json> [model] [out.json]
// Env: MODES=alone,map-v3,hook  REPS=3  MAX_TURNS=n  EFFORT=medium
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as v2 from '../src/deso.ts'

const [project, graph, qfile, model = 'claude-haiku-5-5', outFile = 'bench/results.json'] = process.argv.slice(2)
const questions = JSON.parse(readFileSync(qfile, 'utf8'))
const reps = Number(process.env.REPS ?? 1)
const notesOf = (dir) => readdirSync(dir).filter((f) => f.endsWith('.deso')).sort().map((f) => ({ name: f.slice(0, -5), content: readFileSync(`${dir}/${f}`, 'utf8') }))
const SYS = (m, map) => `You are the assistant inside Taurium, a knowledge-graph note app. ${m.MAP_INTRO} Be concise.\n\n# Graph map\n${map}`
const tmpFile = (name, text) => { const f = `${tmpdir()}/${name}`; writeFileSync(f, text); return f }

// every mode: { sys?: system-prompt text, extra?: more CLI args, user: (q) => prompt }
const notes = notesOf(graph)
const server = fileURLToPath(new URL('../mcp/graph-server.mjs', import.meta.url))
const mcp = tmpFile('armyx-mcp.json', JSON.stringify({ mcpServers: { armyx: { command: 'node', args: ['--experimental-strip-types', '--no-warnings', server, graph] } } }))
// the user's own MCP servers and plugins add tens of thousands of tokens to every call; no mode gets them, so the modes stay comparable
const noMcp = tmpFile('armyx-no-mcp.json', '{"mcpServers":{}}')
const modes = {
  alone: { user: (q) => q },
  'map-v3': { sys: SYS(v2, v2.graphMap(notes)), user: (q) => `# Best matches\n${v2.topHits(notes, q)}\n\n# Question\n${q}` },
  'map-v4': {
    sys: 'The project is indexed as a graph of files. Tool: find(query) returns the best matching files. If the tools do not clearly answer, search with Grep/Glob. Never guess a path.',
    extra: ['--mcp-config', mcp, '--strict-mcp-config', '--allowedTools', 'mcp__armyx__find'],
    user: (q) => q,
  },
}
// project search taken away: the agent has the map (links and symbol edges included) and Read. lean = a small map (2.5k tokens), for small repos
const NOGREP = ' Grep and Glob are disabled: work from the map and "Best matches", then Read the file; the best matches also say which files a file uses and which use it.'
modes['map-nogrep'] = { ...modes['map-v3'], tools: 'Read', sys: modes['map-v3'].sys + NOGREP }
modes['lean-nogrep'] = { sys: SYS(v2, v2.graphMap(notes, 2500)) + NOGREP, tools: 'Read', user: modes['map-v3'].user }
// auto = mapFor(): lean map for small projects, folder outline for big ones; hits = no map at all, best matches only
modes.auto = { sys: SYS(v2, v2.mapFor(notes)), user: modes['map-v3'].user }
modes.hits = { sys: `You are working in a code project. ${v2.MAP_INTRO}`, user: modes['map-v3'].user }
// safe = the least harm: small project -> lean map and best matches; big project -> nothing unless the best match is sure
const big = notes.length > v2.SMALL_PROJECT
modes.safe = big
  ? { user: (q) => { const h = v2.sureHits(notes, q); return h ? `# Best matches
${h}

# Question
${q}` : q } }
  : { sys: SYS(v2, v2.graphMap(notes, 2500)), user: modes['map-v3'].user }
modes['lean'] = { sys: SYS(v2, v2.graphMap(notes, 2500)), user: modes['map-v3'].user }
// the same map and best matches as map-v3, but delivered the way a user gets them: through mcp/claude-hook.mjs as Claude Code hooks
const hook = fileURLToPath(new URL('../mcp/claude-hook.mjs', import.meta.url)).replaceAll('\\', '/')
const hookCmd = (mode) => ({ hooks: [{ type: 'command', command: `node --experimental-strip-types --no-warnings "${hook}" "${graph.replaceAll('\\', '/')}" ${mode}` }] })
modes.hook = { extra: ['--settings', tmpFile('armyx-hook-settings.json', JSON.stringify({ hooks: { SessionStart: [hookCmd('session')], UserPromptSubmit: [hookCmd('prompt')] } })), '--strict-mcp-config', '--mcp-config', noMcp], user: (q) => q }
// the product path since the hook moved into the app: `deso-vault --armyx-hook` (Rust). hook-rs reads GRAPH_NOSEM (a graph dir without
// embeddings.bin: words only), hook-rs-sem reads the graph dir argument (with the vectors: semantic search on). ARMYX_EXE points at the app.
const exe = (process.env.ARMYX_EXE ?? fileURLToPath(new URL('../src-tauri/target/release/deso-vault.exe', import.meta.url))).replaceAll('\\', '/')
const rsCmd = (dir, mode) => ({ hooks: [{ type: 'command', command: `"${exe}" --armyx-hook "${dir.replaceAll('\\', '/')}" ${mode}` }] })
const rsMode = (name, dir) => ({ extra: ['--settings', tmpFile(`armyx-${name}-settings.json`, JSON.stringify({ hooks: { SessionStart: [rsCmd(dir, 'session')], UserPromptSubmit: [rsCmd(dir, 'prompt')] } })), '--strict-mcp-config', '--mcp-config', noMcp], user: (q) => q })
if (process.env.GRAPH_NOSEM) modes['hook-rs'] = rsMode('hook-rs', process.env.GRAPH_NOSEM)
modes['hook-rs-sem'] = rsMode('hook-rs-sem', graph)
if (process.env.OLD_DESO) {
  const v1 = await import(pathToFileURL(process.env.OLD_DESO).href)
  const map = v1.graphMap(notesOf(process.env.OLD_GRAPH))
  modes['map-v1'] = { sys: SYS(v1, map), user: (q) => q }
}
const active = Object.keys(modes).filter((m) => !process.env.MODES || process.env.MODES.split(',').includes(m))

const run = (text, mode) => new Promise((res) => {
  const m = modes[mode]
  const args = ['-p', '--output-format', 'json', '--model', model, '--tools', m.tools ?? 'Read,Grep,Glob', '--max-budget-usd', '1', '--no-session-persistence',
    ...(process.env.MAX_TURNS ? ['--max-turns', process.env.MAX_TURNS] : []), ...(process.env.EFFORT ? ['--effort', process.env.EFFORT] : []), ...(m.sys ? ['--append-system-prompt-file', tmpFile(`armyx-sys-${mode}.txt`, m.sys)] : []), ...(m.extra ?? ['--strict-mcp-config', '--mcp-config', noMcp])]
  const p = spawn('claude', args, { cwd: project })
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

// one throw-away call per mode first: it pays the cache write, so the numbers below are the steady state (its cost is reported)
const warm = {}
for (const mode of active) warm[mode] = (await run('Reply with OK.', mode)).usd
console.log('cache warm-up cost', JSON.stringify(warm))

const jobs = Array.from({ length: reps }, (_, rep) => questions.flatMap(({ q, expect }) => active.map((mode) => ({ q, expect: [].concat(expect), mode, rep })))).flat()
const rows = []
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const { q, expect, mode, rep } = jobs[next++]
    const r = await run(modes[mode].user(q), mode)
    const answer = r.answer.replaceAll('\\', '/')
    const recall = expect.filter((e) => answer.includes(e)).length / expect.length
    rows.push({ q, mode, rep, ok: recall === 1, recall, expect, ...r })
    console.log(mode.padEnd(7), recall === 1 ? 'OK  ' : `${Math.round(recall * 100)}%`.padEnd(4), `turns=${r.turns} input=${r.input} $${r.usd?.toFixed(4)}`, r.failed ? 'FAILED' : '')
  }
}))
const sum = (m, k) => rows.filter((r) => r.mode === m).reduce((a, r) => a + (r[k] ?? 0), 0)
for (const m of active) {
  const n = rows.filter((r) => r.mode === m).length
  console.log(m.padEnd(7), 'correct', `${rows.filter((r) => r.mode === m && r.ok).length}/${n}`, 'recall', (sum(m, 'recall') / n).toFixed(2), 'input', sum(m, 'input'), 'output', sum(m, 'output'), 'turns', sum(m, 'turns'), 'usd', sum(m, 'usd').toFixed(4), 'avg s', (sum(m, 'ms') / n / 1000).toFixed(1))
}
writeFileSync(outFile, JSON.stringify({ project, model, reps, warm, rows }, null, 2))
