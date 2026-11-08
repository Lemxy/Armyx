// Bug-fix benchmark: for each task a bug is injected into a throw-away copy of the project, the agent gets only a plain-language
// symptom (no file, no function name) and the Read/Grep/Glob/Edit tools, and the project's own tests decide whether it fixed it.
// Modes as in bench.mjs: alone / map-v3 (static map + best matches for the symptom) / map-v4 (graph tools over MCP).
//
//   node --experimental-strip-types bench/edit.mjs <pristine project> <graph dir> bench/edit-tasks.json [model] [out.json]
// Env: MODES=alone,map-v3  REPS=2  JOBS=3.  The project's node_modules (if any) is linked into each copy, not copied.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from '../src/deso.ts'

const [project, graph, tfile, model = 'claude-haiku-5-5', outFile = 'bench/results.edit.json'] = process.argv.slice(2)
const tasks = JSON.parse(readFileSync(tfile, 'utf8')).filter((t) => !process.env.IDS || process.env.IDS.split(',').includes(t.id))
const reps = Number(process.env.REPS ?? 1)
const notes = readdirSync(graph).filter((f) => f.endsWith('.deso')).sort().map((f) => ({ name: f.slice(0, -5), content: readFileSync(`${graph}/${f}`, 'utf8') }))
const tmp = (name, text) => { const f = `${tmpdir()}/${name}`; writeFileSync(f, text); return f }
const noMcp = tmp('armyx-no-mcp.json', '{"mcpServers":{}}')
const server = fileURLToPath(new URL('../mcp/graph-server.mjs', import.meta.url))
const mcp = tmp('armyx-mcp-edit.json', JSON.stringify({ mcpServers: { armyx: { command: 'node', args: ['--experimental-strip-types', '--no-warnings', server, graph] } } }))
const TASK = (s) => `Bug report: ${s}\n\nFind the cause in the source code and fix it with the smallest change. Do not edit any test. Reply with one line: the file you changed.`
const modes = {
  alone: { user: (s) => TASK(s) },
  'map-v3': { sys: `You are working in a code project. ${lib.MAP_INTRO}\n\n# Graph map\n${lib.graphMap(notes)}`, user: (s) => `# Best matches\n${lib.topHits(notes, s)}\n\n${TASK(s)}` },
  'map-v4': {
    sys: 'The project is indexed as a graph of files. Tools: find(query) returns the best matching files, Use find first. Never guess a path.',
    extra: ['--mcp-config', mcp, '--strict-mcp-config', '--allowedTools', 'mcp__armyx__find'], user: (s) => TASK(s),
  },
}
// hypothesis: agents narrate and re-plan between tool calls; one line of instruction might cut output tokens and turns
const TERSE = ' Work silently: do not explain or plan out loud. Read only the file you suspect, make the edit, and finish with one line.'
modes['alone-terse'] = { sys: TERSE.trim(), user: modes.alone.user }
modes['map-v3-terse'] = { sys: modes['map-v3'].sys + TERSE, user: modes['map-v3'].user }
// project search taken away (Edit stays): the agent works from the map, the best matches with their symbol links, and Read
modes['map-nogrep'] = { sys: `${modes['map-v3'].sys}${TERSE} Grep and Glob are disabled: work from the map and "Best matches" (they also say which files a file uses and which use it), then Read the file.`, tools: 'Read,Edit', user: modes['map-v3'].user }
const active = Object.keys(modes).filter((m) => !process.env.MODES || process.env.MODES.split(',').includes(m))

// node_modules folders (real or already linked) up to three levels deep: they are linked into each copy, never copied
const modulesDirs = (d, depth = 0) => depth > 2 ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' ? [`${d}/${e.name}`] : e.isDirectory() && !/^(\.git|target)$/.test(e.name) ? modulesDirs(`${d}/${e.name}`, depth + 1) : [])
const copy = (to) => {
  cpSync(project, to, { recursive: true, filter: (p) => !/[\\/](node_modules|target|\.git)([\\/]|$)/.test(p) })
  for (const m of modulesDirs(project)) symlinkSync(m, `${to}${m.slice(project.length)}`, 'junction') // dependencies are linked, not copied
}
const sh = (cmd, cwd) => spawnSync(cmd[0], cmd.slice(1), { cwd, shell: true, encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? `${tmpdir()}/armyx-cargo-target` } })
const testsOf = (src) => src.split('#[cfg(test)]')[1] ?? '' // Rust tests live in the same file, so the test block must stay as it was

const runAgent = (dir, mode, symptom) => new Promise((res) => {
  const m = modes[mode]
  const extra = typeof m.extra === 'function' ? m.extra(dir) : m.extra
  const trace = !!process.env.TRACE // TRACE=1 also records which tools the agent called, turn by turn
  const args = ['-p', '--output-format', trace ? 'stream-json' : 'json', ...(trace ? ['--verbose'] : []), '--model', model, '--tools', typeof m.tools === 'function' ? m.tools(symptom) : (m.tools ?? 'Read,Grep,Glob,Edit'), '--permission-mode', 'acceptEdits', '--max-budget-usd', '1', '--no-session-persistence',
    ...(m.sys ? ['--append-system-prompt-file', tmp(`armyx-edit-sys-${mode}.txt`, m.sys)] : []), ...(extra ?? ['--strict-mcp-config', '--mcp-config', noMcp])]
  const p = spawn('claude', args, { cwd: dir })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.on('close', () => {
    try {
      const events = trace ? out.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
      const steps = events.filter((e) => e.type === 'assistant').map((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => `${c.name.replace('mcp__armyx__', '')}(${String(c.input?.file_path ?? c.input?.path ?? c.input?.pattern ?? c.input?.query ?? '').slice(-34)})`))
      const j = trace ? events.find((e) => e.type === 'result') : JSON.parse(out), u = j.usage ?? {}; res({ ...(trace ? { steps } : {}), answer: (j.result ?? '').trim(), turns: j.num_turns, usd: j.total_cost_usd, ms: j.duration_ms, input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 }) }
    catch { res({ answer: '', turns: 0, usd: 0, ms: 0, input: 0, output: 0, failed: true }) }
  })
  p.stdin.end(m.user(symptom, dir))
})

const runOne = async (t, mode, rep, id) => {
  const dir = `${tmpdir()}/armyx-edit-${process.pid}-${id}`
  rmSync(dir, { recursive: true, force: true })
  copy(dir)
  const file = `${dir}/${t.file}`, src = readFileSync(file, 'utf8')
  if (src.split(t.old).length !== 2) throw new Error(`${t.id}: snippet must appear exactly once`)
  const broken = src.replace(t.old, () => t.new)
  writeFileSync(file, broken)
  const r = await runAgent(dir, mode, t.symptom)
  const after = readFileSync(file, 'utf8')
  const changed = readdirSyncAll(dir).filter((f) => !/node_modules/.test(f)).filter((f) => f === t.file ? after !== broken : readFileSync(`${dir}/${f}`, 'utf8') !== (existsSync(`${project}/${f}`) ? readFileSync(`${project}/${f}`, 'utf8') : null))
  const testsIntact = !changed.some((f) => /\.test\.|\/tests?\//.test(f)) && testsOf(after) === testsOf(src)
  const pass = sh(t.cmd, dir).status === 0
  rmSync(dir, { recursive: true, force: true })
  return { task: t.id, mode, rep, ok: pass && testsIntact, pass, testsIntact, foundFile: changed.includes(t.file), changed, ...r }
}
function readdirSyncAll(d, base = '') {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === 'node_modules' ? [] : e.isDirectory() ? readdirSyncAll(`${d}/${e.name}`, `${base}${e.name}/`) : [`${base}${e.name}`])
}

const valid = []
for (const t of tasks) { // the bug must be real: pristine passes, broken fails
  const dir = `${tmpdir()}/armyx-edit-check-${process.pid}`
  rmSync(dir, { recursive: true, force: true }); copy(dir)
  const pristine = sh(t.cmd, dir).status === 0
  writeFileSync(`${dir}/${t.file}`, readFileSync(`${dir}/${t.file}`, 'utf8').replace(t.old, () => t.new))
  const broken = sh(t.cmd, dir).status !== 0
  rmSync(dir, { recursive: true, force: true })
  console.log(t.id.padEnd(18), pristine && broken ? 'valid task' : `SKIPPED (pristine passes: ${pristine}, broken fails: ${broken})`)
  if (pristine && broken) valid.push(t)
}
tasks.length = 0
tasks.push(...valid)

const jobs = Array.from({ length: reps }, (_, rep) => tasks.flatMap((t) => active.map((mode) => ({ t, mode, rep })))).flat()
const rows = []
let next = 0
await Promise.all(Array.from({ length: Number(process.env.JOBS ?? 3) }, async (_, w) => {
  while (next < jobs.length) {
    const i = next++, { t, mode, rep } = jobs[i]
    const r = await runOne(t, mode, rep, `${w}`)
    rows.push(r)
    console.log(mode.padEnd(7), t.id.padEnd(18), r.ok ? 'FIXED' : r.pass ? 'tests edited' : 'NOT FIXED', `found=${r.foundFile} turns=${r.turns} $${r.usd?.toFixed(4)} ${Math.round(r.ms / 1000)}s`, r.failed ? 'FAILED' : '')
  }
}))
for (const m of active) {
  const x = rows.filter((r) => r.mode === m), n = x.length, sm = (k) => x.reduce((a, r) => a + (r[k] ?? 0), 0)
  console.log(m.padEnd(7), 'fixed', `${x.filter((r) => r.ok).length}/${n}`, 'right file', x.filter((r) => r.foundFile).length, 'turns/task', (sm('turns') / n).toFixed(1), 'usd/task', (sm('usd') / n).toFixed(4), 's/task', (sm('ms') / n / 1000).toFixed(0))
}
writeFileSync(outFile, JSON.stringify({ project, model, reps, rows }, null, 2))
