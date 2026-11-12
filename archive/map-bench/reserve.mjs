// Where is the chat's remaining reserve? Five ideas, on questions about what the code says (not "which file"):
//   1 slice    when the best match is sure, send the text of the matching definition instead of the map      (real `claude -p` runs)
//   2 stream   time to the first text of the final answer vs the whole answer + the typewriter               (same runs, stream-json)
//   3 cache    a second cache point on the conversation                                                       (calculated, no API key here)
//   4 batch    trim the history in halves instead of one message per turn                                     (calculated)
//   5 cheap    the same questions on Haiku and on Sonnet                                                      (real runs)
//   node --experimental-strip-types --no-warnings archive/map-bench/reserve.mjs <project> <graph dir> <questions.json> [out.json]
// Env: MODELS=claude-haiku-5-5,claude-sonnet-5-5  MODES=alone,map,slice  REPS=2  DRY=1 (no LLM calls: the offline part only)
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as d from '../../src/deso.ts'

const [project, graph, qfile, outFile = 'archive/map-bench/results.reserve.json'] = process.argv.slice(2)
const questions = JSON.parse(readFileSync(qfile, 'utf8'))
const notes = readdirSync(graph).filter((f) => f.endsWith('.deso')).sort().map((f) => ({ name: f.slice(0, -5), content: readFileSync(`${graph}/${f}`, 'utf8') }))
const reps = Number(process.env.REPS ?? 2)
const models = (process.env.MODELS ?? 'claude-haiku-5-5,claude-sonnet-5-5').split(',')
const active = (process.env.MODES ?? 'alone,map,slice').split(',')

// ---- the prompts: `map` is what the chat sends in CLI mode today (SYSTEM + cliPrompt in AgentSidebar.tsx) ----
const SYSTEM = `You are the assistant inside Taurium, a knowledge-graph note app. ${d.MAP_INTRO} Be concise and answer in the user's language.\n\n# Graph map\n${d.graphMap(notes)}`
const mapPrompt = (q) => `${SYSTEM}\n\n# Conversation\nUser: ${q}\n\n# Best matches for the last message\n${d.topHits(notes, q, 5)}\n\nAssistant:`
/** Idea 1: the lines of the definitions the question names: sliceFor in src/deso.ts, the same code the chat runs. */
const sliced = new Map(await Promise.all(questions.map(async ({ q }) => [q, await d.sliceFor(notes, q, async (p) => readFileSync(`${project}/${p}`, 'utf8'))])))
const slice = (q) => sliced.get(q) || null
const slicePrompt = (q) => { const s = slice(q); return s ? `You are working in a code project. Be concise. The code below is the definition that most likely answers the question; if it does not, search (Grep/Glob) or Read.\n\n${s}\n\n# Question\n${q}` : mapPrompt(q) }
const modes = { alone: (q) => q, map: mapPrompt, slice: slicePrompt }
const hit = (text, expect) => expect.every((e) => new RegExp(e, 'i').test(text))

// offline: how often idea 1 can fire at all, and whether the slice it would send holds the answer
const offline = questions.map(({ q, expect }) => { const s = slice(q); return { q, sure: d.sure(notes, q), top: d.prop(d.scoredHits(notes, q)[0]?.note.content ?? '', 'path'), sliced: !!s, sliceHasAnswer: !!s && hit(s, expect), mapTok: d.tokens(mapPrompt(q)), sliceTok: d.tokens(slicePrompt(q)) } })
for (const o of offline) console.log(o.sure ? 'sure' : '    ', o.sliced ? (o.sliceHasAnswer ? 'slice+' : 'slice-') : '      ', String(o.top).padEnd(36), o.q.slice(0, 70))

// ---- ideas 3 and 4, calculated: a 40-question chat, billed input in units of one uncached input token ----
const MAX_TURNS = 24, MAX_CHARS = 30000 // as in AgentSidebar.tsx
const trimNow = (msgs) => { let out = msgs.slice(-MAX_TURNS), size = out.reduce((n, m) => n + m.length, 0); while (out.length > 1 && size > MAX_CHARS) size -= out.shift().length; while (out.length && out[0].role !== 'user') out.shift(); return out }
// idea 4: on overflow drop half the window at once, so the start of the request stays put for the next 6 questions
const trimBatch = (msgs) => { let s = 0; while (msgs.length - s > MAX_TURNS || msgs.slice(s).reduce((n, m) => n + m.length, 0) > MAX_CHARS) s += MAX_TURNS / 2; return msgs.slice(s) }
let seed = 7; const rnd = (a, b) => a + ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * (b - a)
const sim = (trim, price) => { // price(sys, kept, fresh) -> billed units for one request; kept = history tokens identical to the previous request's start
  seed = 7
  const msgs = [], tok = (m) => Math.ceil(m.length / 4), sys = d.tokens(SYSTEM)
  let prev = [], billed = 0, sent = 0
  for (let t = 0; t < 40; t++) {
    msgs.push({ id: msgs.length, role: 'user', length: Math.round(rnd(120, 400)) })
    const h = trim(msgs), same = prev.length && h[0].id === prev[0].id
    const kept = same ? prev.reduce((n, m) => n + tok(m), 0) : 0, all = h.reduce((n, m) => n + tok(m), 0)
    billed += price(sys, kept, all - kept, t === 0); sent += sys + all
    msgs.push({ id: msgs.length, role: 'assistant', length: Math.round(rnd(600, 2400)) })
    prev = h
  }
  return { billed: Math.round(billed), sent }
}
// Assumed prices: Claude cache read 0.1x, cache write 1.25x (5-minute cache, every turn inside it); DeepSeek V4 Flash cache hit 0.006/0.3 = 0.02x (src/dsprice.ts)
const claudeSys = (sys, kept, fresh, first) => (first ? 1.25 : 0.1) * sys + kept + fresh // today: only the system prompt is cached
const claudeHist = (sys, kept, fresh, first) => (first ? 1.25 : 0.1) * sys + 0.1 * kept + 1.25 * fresh // idea 3: a second cache point on the last message
const deepseek = (sys, kept, fresh, first) => (first ? 1 : 0.02) * sys + 0.02 * kept + fresh // automatic prefix cache
const cache = {
  claude: { now: sim(trimNow, claudeSys), cacheHistory: sim(trimNow, claudeHist), batchTrim: sim(trimBatch, claudeSys), both: sim(trimBatch, claudeHist) },
  deepseek: { now: sim(trimNow, deepseek), batchTrim: sim(trimBatch, deepseek) },
}
console.log('cache, billed input units for a 40-question chat', JSON.stringify(cache))

// ---- real runs ----
const run = (text, model) => new Promise((res) => {
  const noMcp = `${tmpdir()}/armyx-no-mcp.json`; writeFileSync(noMcp, '{"mcpServers":{}}')
  const t0 = Date.now()
  const p = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model, '--tools', 'Read,Grep,Glob', '--max-budget-usd', '1', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', noMcp], { cwd: project })
  let buf = '', first = null, j = null
  p.stdout.on('data', (c) => {
    buf += c
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) {
      let e; try { e = JSON.parse(l) } catch { continue }
      // the first text of the LAST message is what streaming would show; text before a tool call is not the answer
      if (e.type === 'stream_event' && e.event?.type === 'message_start') first = null
      if (e.type === 'stream_event' && e.event?.delta?.type === 'text_delta' && first == null) first = Date.now() - t0
      if (e.type === 'result') j = { ...e, wall: Date.now() - t0 }
    }
  })
  p.on('close', () => {
    if (!j) return res({ answer: '', failed: true, turns: 0, usd: 0, input: 0, output: 0, ms: 0 })
    const u = j.usage ?? {}, answer = (j.result ?? '').trim()
    // useTypewriter: max(2, ceil(len / 240)) characters every 16 ms
    res({ answer, turns: j.num_turns, usd: j.total_cost_usd, ms: j.wall, firstMs: first ?? j.wall, typeMs: Math.ceil(answer.length / Math.max(2, Math.ceil(answer.length / 240))) * 16,
      input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 })
  })
  p.stdin.end(text)
})

const rows = []
if (!process.env.DRY) {
  for (const model of models) for (const mode of active) await run(modes[mode]('Reply with OK.'), model) // pays the cache write, not counted
  const jobs = models.flatMap((model) => Array.from({ length: reps }, (_, rep) => questions.flatMap((x, i) => active.map((mode) => ({ ...x, i, mode, model, rep })))).flat())
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const { q, expect, i, mode, model, rep } = jobs[next++]
      const r = await run(modes[mode](q), model)
      rows.push({ q, mode, model, rep, ok: hit(r.answer, expect), sure: offline[i].sure, sliced: offline[i].sliced, sliceHasAnswer: offline[i].sliceHasAnswer, ...r })
      console.log(model.padEnd(18), mode.padEnd(6), rows.at(-1).ok ? 'OK  ' : 'MISS', `turns=${r.turns} input=${r.input} $${r.usd?.toFixed(4)} first=${r.firstMs} total=${r.ms}`, r.failed ? 'FAILED' : '')
    }
  }))
  for (const model of models) for (const mode of active) {
    const g = rows.filter((r) => r.model === model && r.mode === mode), avg = (k) => g.reduce((a, r) => a + (r[k] ?? 0), 0) / g.length
    console.log(model.padEnd(18), mode.padEnd(6), 'correct', `${g.filter((r) => r.ok).length}/${g.length}`, 'input', Math.round(avg('input')), 'turns', avg('turns').toFixed(2), 'usd', avg('usd').toFixed(4), 'first s', (avg('firstMs') / 1000).toFixed(1), 'total s', (avg('ms') / 1000).toFixed(1))
  }
}
writeFileSync(outFile, JSON.stringify({ project, models, reps, offline, cache, rows }, null, 2))
