// What do the orchestra's token savers save? Five before/after pairs, each on real `claude -p` runs with the flags the app uses:
//   slice    a worker's brief with the code it names attached            vs the brief alone                    (reading worker)
//   resume   a review round that continues the worker's session          vs a fresh call with the whole prompt (writing worker, round 2 only)
//   diff     a reviewer that gets the git diff                           vs one that has to find the change    (reading worker)
//   final    the lead's final answer on Haiku                            vs on the lead's own model            (no tools)
//   stagger  4 calls on a cold prompt cache, 3 of them 6 s behind        vs all 4 at once
//   node --experimental-strip-types --no-warnings archive/map-bench/orchestra.mjs <project> <graph dir> <questions.json> [out.json]
// Env: MODEL=claude-sonnet-5-5  CHEAP=claude-haiku-5-5  REPS=2  ONLY=slice,resume,diff,final,stagger
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import * as d from '../../src/deso.ts'

const [project, graph, qfile, outFile = 'archive/map-bench/results.orchestra.json'] = process.argv.slice(2)
const questions = JSON.parse(readFileSync(qfile, 'utf8'))
const notes = readdirSync(graph).filter((f) => f.endsWith('.deso')).sort().map((f) => ({ name: f.slice(0, -5), content: readFileSync(`${graph}/${f}`, 'utf8') }))
const reps = Number(process.env.REPS ?? 2), MODEL = process.env.MODEL ?? 'claude-sonnet-5-5', CHEAP = process.env.CHEAP ?? 'claude-haiku-5-5'
const only = (process.env.ONLY ?? 'slice,resume,diff,final,stagger').split(',')
const read = async (p) => readFileSync(`${project}/${p}`, 'utf8')

// ---- the prompts, as in src/orchestra.ts ----
const BRIEF = 'Answer tersely, like a senior engineer in a hurry: no greeting, no preamble, no restating the task, no closing summary or offers. ' +
  'Fragments are fine; drop filler and hedging. Keep code, paths, names, numbers and errors exact. ' +
  'Write long material (code, full lists, reports) into files and reply with their paths and a one-line gist. ' +
  'A required output format (such as "### A" sections) still comes first and stays complete and self-contained.'
const FILES = '# Files\nFrom the project map. `{name@12-40}` = the lines of that definition at the last scan: read just that range (offset/limit), not the whole file; if it moved, search for the name.'
const CODE = '# Code\nThe definitions this brief names, as they are in the project now: do not open these files again just to read them.'
const DIFF = '# Changes made (git diff)\nEverything the agents changed so far. Open a file only when the diff is not enough to judge.'
const REVIEW_PROTOCOL = '# Review protocol\nIf the result is acceptable, answer with exactly `OK` on the first line. Otherwise list the concrete problems and how to fix each.'
const parts = async (inputs, { code = false, diff = '', feedback = '', review = false } = {}) => {
  const files = d.subMap(notes, inputs), src = code ? await d.sliceFor(notes, inputs, read) : ''
  return [`# Input from previous agents\n${inputs}`, files && `${FILES}\n${files}`, src && `${CODE}\n${src}`, diff && `${DIFF}\n${diff}`, feedback && `# Review feedback\n${feedback}`, review && REVIEW_PROTOCOL].filter(Boolean).join('\n\n')
}

// ---- one call, with the flags run_agent passes (src-tauri/src/lib.rs) ----
const READ = 'Read,Grep,Glob', WRITE = 'Read,Grep,Glob,Edit'
const run = (prompt, { model = MODEL, tools = READ, cwd = project, effort = 'medium', session, resume } = {}) => new Promise((res) => {
  const t0 = Date.now()
  const args = ['--model', model, ...(model.includes('haiku') ? [] : ['--effort', effort]), '--output-format', 'stream-json', '--strict-mcp-config', '--setting-sources', '', '--verbose',
    '--disallowedTools', 'Agent,Task', '--tools', tools, '--append-system-prompt', BRIEF, '--max-budget-usd', '1', '--max-turns', '25',
    ...(session ? [resume ? '--resume' : '--session-id', session] : ['--no-session-persistence']), '--permission-mode', 'acceptEdits', '-p']
  const p = spawn('claude', args, { cwd })
  let out = '', err = ''
  p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (err += c))
  p.on('close', () => {
    let j; for (const l of out.split('\n')) { try { const e = JSON.parse(l); if (e.type === 'result') j = e } catch { /* a partial line */ } }
    if (!j) return res({ failed: err.slice(0, 200) || 'no result', answer: '' })
    const u = j.usage ?? {}
    res({ answer: (j.result ?? '').trim(), turns: j.num_turns, usd: j.total_cost_usd, ms: Date.now() - t0, output: u.output_tokens ?? 0,
      fresh: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0,
      input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) })
  })
  p.stdin.end(prompt)
})
const pool = async (jobs, n = 4) => { let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < jobs.length) await jobs[next++]() })) }
const hit = (text, expect) => expect.every((e) => new RegExp(e, 'i').test(text))
const rows = []
const add = (exp, arm, r, more = {}) => { rows.push({ exp, arm, ...more, ...r }); console.log(exp.padEnd(8), arm.padEnd(9), more.ok === undefined ? '    ' : more.ok ? 'OK  ' : 'MISS', r.failed ? `FAILED ${r.failed}` : `turns=${r.turns} in=${r.input} out=${r.output} $${r.usd?.toFixed(4)} ${r.ms}ms`, more.id ?? '') }

// ---- slice ----
if (only.includes('slice')) {
  await run('Reply with OK.') // pays the cache write, not counted
  const jobs = []
  for (let rep = 0; rep < reps; rep++) for (const [i, { q, expect }] of questions.entries()) {
    const inputs = `## Lead\nFind this in the code and report it: ${q}`
    const before = await parts(inputs), after = await parts(inputs, { code: true })
    for (const [arm, prompt] of [['before', before], ['after', after]]) jobs.push(async () => { const r = await run(prompt); add('slice', arm, r, { id: `q${i}`, ok: hit(r.answer, expect), fired: after !== before }) })
  }
  await pool(jobs)
}

// ---- resume, diff, final: one small coding task per copy of the project ----
const TASKS = [
  { id: 'keys', brief: 'In src/keys.ts add an exported function `hasKey(name)` that tells whether a key is stored for that name. Reply with the file you changed and one line on what you did.',
    feedback: 'Name it `keySet`, not `hasKey`, and make it return false when the stored value is only whitespace.', ok: (dir) => { const s = readFileSync(`${dir}/src/keys.ts`, 'utf8'); return /keySet/.test(s) && !/hasKey/.test(s) && /trim/.test(s) } },
  { id: 'mapmem', brief: 'In src/mapmem.ts add an exported function `resetHeat()` that clears the saved heat of the active project. Reply with the file you changed and one line on what you did.',
    feedback: 'It must clear the co-read pairs as well, in the same function; rename it to `resetMemory`.', ok: (dir) => { const s = readFileSync(`${dir}/src/mapmem.ts`, 'utf8'); return /resetMemory/.test(s) && !/resetHeat/.test(s) && /resetMemory[\s\S]*CO/.test(s) } },
  { id: 'dsprice', brief: 'In src/dsprice.ts add an exported function `dsCost(model, input, output)` that returns the USD cost of that many uncached input tokens and output tokens. Reply with the file you changed and one line on what you did.',
    feedback: 'Rename it to `plainCost` and make it return `undefined`, not 0, for a model with no known price.', ok: (dir) => { const s = readFileSync(`${dir}/src/dsprice.ts`, 'utf8'); return /plainCost/.test(s) && !/dsCost/.test(s) && /undefined/.test(s) } },
]
const base = `${tmpdir()}/armyx-orch-bench-${process.pid}`
const copy = (from, to, all = false) => cpSync(from, to, { recursive: true, filter: (p) => all || !/[\\/](node_modules|target|\.git|dist|archive|\.tools|\.claude|vault)([\\/]|$)/.test(p) })
const git = (dir, ...a) => spawnSync('git', ['-c', 'user.name=b', '-c', 'user.email=b@b', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).stdout
if (only.some((x) => ['resume', 'diff', 'final'].includes(x))) {
  mkdirSync(base, { recursive: true })
  await pool(Array.from({ length: reps }, (_, rep) => TASKS.map((t) => async () => {
    const id = `${t.id}#${rep}`, X = `${base}/${t.id}-${rep}-x`, Y = `${base}/${t.id}-${rep}-y`
    copy(project, X); git(X, 'init', '-q'); git(X, 'add', '-A'); git(X, 'commit', '-qm', 'base')
    const inputs = `## Lead\n${t.brief}`, sid = randomUUID()
    const first = await run(await parts(inputs, { code: true }), { tools: WRITE, cwd: X, session: sid })
    add('round1', 'coder', first, { id })
    if (first.failed) return
    copy(X, Y, true) // the project as the coder left it: the fresh arm and the reviewers work here, the resumed session stays in X
    git(Y, 'add', '-A'); const diff = `${git(Y, 'diff', '--cached', 'HEAD', '--stat')}\n${git(Y, 'diff', '--cached', 'HEAD')}`
    const rin = `## Lead\nReview the change the coder made. It was asked: ${t.brief}\n\n## Coder\n${first.answer}`
    let review = ''
    if (only.includes('diff')) {
      const [b, a] = await Promise.all([run(await parts(rin, { review: true }), { cwd: Y }), run(await parts(rin, { review: true, diff }), { cwd: Y })])
      add('diff', 'before', b, { id, verdict: /^ok\b/i.test(b.answer) }); add('diff', 'after', a, { id, verdict: /^ok\b/i.test(a.answer) }); review = a.answer
    }
    if (only.includes('final')) {
      const prompt = `# Role\nYou are the lead agent of an orchestra. Your agents have reported back. Write the final answer to the task: merge their findings, say where they disagree, and what is still unknown. Do not brief anyone again.\n\n# Task\n${t.brief}\n\n# Reports\n## Coder\n${first.answer}\n\n## Reviewer\n${review || 'OK'}`
      const [b, a] = await Promise.all([run(prompt, { tools: '', effort: 'low' }), run(prompt, { tools: '', model: CHEAP })])
      add('final', 'before', b, { id, ok: /keys|mapmem|dsprice/.test(b.answer) }); add('final', 'after', a, { id, ok: /keys|mapmem|dsprice/.test(a.answer) })
    }
    if (only.includes('resume')) {
      const [b, a] = await Promise.all([
        run(await parts(inputs, { code: true, feedback: t.feedback }), { tools: WRITE, cwd: Y }),
        run(`# Review feedback\n${t.feedback}\n\nDo the work again with this.`, { tools: WRITE, cwd: X, session: sid, resume: true })])
      if (!a.failed) a.usd -= first.usd // a resumed session reports its total cost, round 1 included (the token counts are the call's own)
      add('resume', 'before', b, { id, ok: !b.failed && t.ok(Y) }); add('resume', 'after', a, { id, ok: !a.failed && t.ok(X) })
    }
  })).flat(), 3)
  rmSync(base, { recursive: true, force: true })
}

// ---- stagger: a tool set nobody used lately = a cold cache for the tools + system prompt ----
if (only.includes('stagger')) {
  const ALL = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite']
  const used = new Set(), cold = () => { for (;;) { const s = ALL.filter(() => Math.random() < 0.5); if (s.length > 2 && s.length < 9 && !used.has(s.join())) { used.add(s.join()); return s.join() } } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let rep = 0; rep < reps + 1; rep++) for (const [arm, wait] of [['before', 0], ...(process.env.WAITS ?? '6000').split(',').map((w) => [Number(w) === 6000 ? 'after' : `w${w}`, Number(w)])]) {
    const tools = cold(), t0 = Date.now()
    const rs = await Promise.all([0, 1, 2, 3].map(async (i) => { if (i) await sleep(wait); return run('Reply with OK.', { tools }) }))
    const sum = (k) => rs.reduce((a, r) => a + (r[k] ?? 0), 0)
    // one row per group of four: the whole group's bill and the time until the last one answered
    add('stagger', arm, { failed: rs.find((r) => r.failed)?.failed, answer: '', turns: sum('turns'), usd: sum('usd'), ms: Date.now() - t0, output: sum('output'), fresh: sum('fresh'), cacheWrite: sum('cacheWrite'), cacheRead: sum('cacheRead'), input: sum('input') }, { id: `g${rep}`, tools })
  }
}

// ---- summary: the change from `before` to `after`, on pairs where both arms answered ----
const summary = {}
for (const exp of ['slice', 'resume', 'diff', 'final', 'stagger']) {
  const okIds = (arm) => new Set(rows.filter((r) => r.exp === exp && r.arm === arm && !r.failed).map((r) => r.id))
  const both = okIds('before'), aft = okIds('after')
  for (const [name, keep] of [[exp, () => true], ...(exp === 'slice' ? [['slice (fired)', (r) => r.fired]] : [])]) {
    const g = (arm) => rows.filter((r) => r.exp === exp && r.arm === arm && !r.failed && both.has(r.id) && aft.has(r.id) && keep(r))
    const b = g('before'), a = g('after')
    if (!b.length || !a.length) continue
    const avg = (x, k) => x.reduce((s, r) => s + (r[k] ?? 0), 0) / x.length
    const m = Object.fromEntries(['input', 'output', 'turns', 'usd', 'ms', 'cacheWrite', 'cacheRead'].map((k) => [k, { before: avg(b, k), after: avg(a, k), pct: avg(b, k) ? Math.round((avg(a, k) / avg(b, k) - 1) * 100) : 0 }]))
    const ok = (x) => (x.some((r) => r.ok !== undefined) ? `${x.filter((r) => r.ok).length}/${x.length}` : undefined)
    summary[name] = { n: b.length, okBefore: ok(b), okAfter: ok(a), ...m }
    console.log(name.padEnd(14), `n=${b.length}`, ['input', 'output', 'turns', 'usd', 'ms'].map((k) => `${k} ${m[k].pct > 0 ? '+' : ''}${m[k].pct}%`).join('  '), ok(b) ? `correct ${ok(b)} -> ${ok(a)}` : '')
  }
}
const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0)
console.log('spent $', total.toFixed(2))
writeFileSync(outFile, JSON.stringify({ project, model: MODEL, cheap: CHEAP, reps, total, summary, rows }, null, 1))
