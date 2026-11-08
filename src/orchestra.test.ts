import { expect, test, vi } from 'vitest'
import { isWriter, leadChat, RETRIES, retry, RUN_CAP, RUN_TOKEN_CAP, runOrchestra, save, section, slim, type Deps, type Entry, type Node, type Opts, type Orch } from './orchestra'
import { dsUsage } from './dsprice'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const node = (id: string, p: Partial<Node> = {}): Node => ({ id, x: 0, y: 0, kind: 'model', agent: 'deepseek', model: 'm', text: '', notes: [], ...p })
const orch = (nodes: Node[], edges: [string, string][], p: Partial<Orch> = {}): Orch =>
  ({ id: 'o', name: 'o', task: 'T', nodes: [node('L', { kind: 'start', agent: 'claude' }), ...nodes], edges, ...p })
const ans = (text: string, p: object = {}) => ({ text, input: 1, cached: 0, output: 1, cost: 0, ...p })
const BRIEFING = '### A\ngo A\n### B\ngo B'

// A fake screen: records every exec call and applies patches to a copy of the nodes.
function rig(o: Orch, exec: (n: Node, prompt: string, opts: Opts) => Promise<ReturnType<typeof ans>>, over: Partial<Deps> = {}) {
  const log: Entry[] = [], nodes = new Map(o.nodes.map((n) => [n.id, { ...n }]))
  const calls: { id: string; prompt: string; opts: Opts }[] = []
  const d: Deps = {
    exec: (n, build, opts) => { const prompt = build(false); calls.push({ id: n.id, prompt, opts }); return exec(n, prompt, opts) },
    patch: (id, p) => { Object.assign(nodes.get(id)!, p) },
    addLog: (e) => { log.push({ ...e, at: 0 }) },
    stamp: async () => '', stopped: () => false, history: () => '', embed: () => '', leadMap: () => 'MAP',
    label: (n) => n.id, who: (n) => n.id, t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k),
    ...over,
  }
  return { d, log, nodes, calls, ids: () => calls.map((c) => c.id) }
}
const lead = (n: Node, brief = BRIEFING) => (n.id === 'L' ? ans(brief) : ans(`out ${n.id}`))

test('blocks wait only for their own inputs: topological order and parallel branches', async () => {
  const ev: string[] = []
  const o = orch([node('A'), node('B'), node('C')], [['L', 'A'], ['L', 'B'], ['A', 'C'], ['B', 'C']])
  const r = rig(o, async (n) => { ev.push(`+${n.id}`); await sleep(n.id === 'A' ? 40 : 10); ev.push(`-${n.id}`); return lead(n) })
  await runOrchestra(o, r.d)
  expect(ev.slice(0, 8)).toEqual(['+L', '-L', '+A', '+B', '-B', '-A', '+C', '-C']) // A and B overlap, C waits for both
})

test('queue mode runs one block at a time', async () => {
  let now = 0, max = 0
  const o = orch([node('A'), node('B')], [['L', 'A'], ['L', 'B']], { queue: true })
  const r = rig(o, async (n) => { max = Math.max(max, ++now); await sleep(10); now--; return lead(n) })
  await runOrchestra(o, r.d)
  expect(max).toBe(1)
  expect(r.ids().slice(0, 3)).toEqual(['L', 'A', 'B'])
})

test('a loop gives an orchCycle error and nothing runs', async () => {
  const o = orch([node('A'), node('B')], [['A', 'B'], ['B', 'A']])
  const r = rig(o, async (n) => lead(n))
  await runOrchestra(o, r.d)
  expect(r.nodes.get('A')).toMatchObject({ state: 'err', out: 'orchCycle' })
  expect(r.calls).toHaveLength(0)
})

test('a failed block skips its descendants, independent branches still run, and the lead does not report on nothing', async () => {
  const o = orch([node('A'), node('B'), node('C')], [['L', 'A'], ['L', 'B'], ['A', 'C']])
  const r = rig(o, async (n) => { if (n.id === 'A') throw new Error('boom'); return lead(n) })
  await runOrchestra(o, r.d)
  expect(r.nodes.get('A')?.state).toBe('err')
  expect(r.nodes.get('B')?.state).toBe('ok')
  expect(r.ids()).not.toContain('C')
  expect(r.nodes.get('C')?.state).toBeUndefined()
  expect(r.ids().filter((i) => i === 'L')).toHaveLength(2) // B is a sink with a report: the lead still writes the final answer
  const all = orch([node('A')], [['L', 'A']])
  const r2 = rig(all, async (n) => { if (n.id === 'A') throw new Error('boom'); return lead(n) })
  await runOrchestra(all, r2.d)
  expect(r2.ids()).toEqual(['L', 'A']) // no sinks: no final report
})

test('unchanged input reuses the answer, force reruns everything', async () => {
  const o1 = orch([node('A')], [['L', 'A']])
  const r1 = rig(o1, async (n) => lead(n))
  await runOrchestra(o1, r1.d)
  expect(r1.ids()).toEqual(['L', 'A', 'L'])
  const o2 = { ...o1, nodes: [...r1.nodes.values()] } // the saved state after the first run
  const r2 = rig(o2, async (n) => lead(n))
  await runOrchestra(o2, r2.d)
  expect(r2.calls).toHaveLength(0)
  expect(r2.nodes.get('A')?.use?.same).toBe(true)
  const r3 = rig(o2, async (n) => lead(n))
  await runOrchestra(o2, r3.d, { force: true })
  expect(r3.ids()).toEqual(['L', 'A', 'L'])
})

test('section gives an agent only its own part, or the whole answer when there is none', () => {
  expect(section(BRIEFING, 'A')).toBe('go A')
  expect(section(BRIEFING, 'B')).toBe('go B')
  expect(section('no sections here', 'A')).toBe('no sections here')
  expect(section(BRIEFING, 'C')).toBe(BRIEFING)
})

test('RUN_CAP stops new blocks from starting', async () => {
  const o = orch([node('A'), node('B'), node('C')], [['L', 'A'], ['A', 'B'], ['B', 'C']])
  const r = rig(o, async (n) => (n.id === 'L' ? ans(BRIEFING) : ans(n.id, { cost: RUN_CAP / 2 + 1 })))
  await runOrchestra(o, r.d)
  expect(r.ids()).toEqual(['L', 'A', 'B'])
  expect(r.log.some((e) => e.text.startsWith('orchCap'))).toBe(true)
})

test('RUN_TOKEN_CAP stops blocks that report no cost', async () => {
  const o = orch([node('A'), node('B'), node('C')], [['L', 'A'], ['A', 'B'], ['B', 'C']])
  const r = rig(o, async (n) => (n.id === 'L' ? ans(BRIEFING) : ans(n.id, { input: RUN_TOKEN_CAP, output: 1 })))
  await runOrchestra(o, r.d)
  expect(r.ids()).toEqual(['L', 'A'])
  expect(r.log.some((e) => e.text.startsWith('orchTokCap'))).toBe(true)
})

test('the final report is written only when there are sinks', async () => {
  const alone = orch([], [])
  const r = rig(alone, async (n) => lead(n))
  await runOrchestra(alone, r.d)
  expect(r.ids()).toEqual(['L'])
  const o = orch([node('A')], [['L', 'A']])
  const r2 = rig(o, async (n) => lead(n))
  await runOrchestra(o, r2.d)
  expect(r2.ids()).toEqual(['L', 'A', 'L'])
  expect(r2.calls[2].opts.tools).toBe('')
})

test('two writing blocks never run at once, two read-only blocks do', async () => {
  const peak = async (extra: Partial<Node>) => {
    let now = 0, max = 0
    const o = orch([node('A', { agent: 'claude', ...extra }), node('B', { agent: 'claude', ...extra })], [['L', 'A'], ['L', 'B']])
    const r = rig(o, async (n, _p, opts) => { if (n.id !== 'L') { max = Math.max(max, ++now); await sleep(15); now-- } return lead(n, opts.tools === '' ? BRIEFING : '') })
    await runOrchestra(o, r.d)
    return max
  }
  expect(await peak({})).toBe(1) // all tools
  expect(await peak({ tools: 'Read,Grep,Glob' })).toBe(2)
  expect(isWriter(node('x', { agent: 'claude' }), '')).toBe(false)
  expect(isWriter(node('x', { agent: 'agy' }), undefined)).toBe(true)
  expect(isWriter(node('x', { agent: 'deepseek' }), undefined)).toBe(false)
})

test('a writing block is not retried after a transient error, a reading block is', async () => {
  vi.useFakeTimers()
  try {
    const flaky = async (n: Node) => { if (n.id === 'A') throw new Error('request timed out'); return lead(n) }
    const w = orch([node('A', { agent: 'claude' })], [['L', 'A']])
    const rw = rig(w, flaky)
    const pw = runOrchestra(w, rw.d); await vi.runAllTimersAsync(); await pw
    expect(rw.ids().filter((i) => i === 'A')).toHaveLength(1)
    expect(rw.nodes.get('A')?.state).toBe('err')
    expect(rw.log.some((e) => e.kind === 'error' && e.text.includes('orchWriterFail'))).toBe(true)
    const rd = orch([node('A')], [['L', 'A']])
    const rr = rig(rd, flaky)
    const pr = runOrchestra(rd, rr.d); await vi.runAllTimersAsync(); await pr
    expect(rr.ids().filter((i) => i === 'A')).toHaveLength(RETRIES + 1)
  } finally { vi.useRealTimers() }
})

test('retry gives up on errors that are not transient', async () => {
  let n = 0
  await expect(retry(async () => { n++; throw new Error('bad api key') }, () => false, 1)).rejects.toThrow('bad api key')
  expect(n).toBe(1)
})

test('DeepSeek usage becomes a cost, unknown models stay free', () => {
  const u = dsUsage('deepseek-v4-flash', { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, completion_tokens: 500 })
  expect(u).toMatchObject({ input: 600, cached: 400, output: 500 })
  expect(u.cost).toBeCloseTo((400 * 0.006 + 600 * 0.3 + 500 * 1.2) / 1e6, 9)
  expect(dsUsage('deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 100 }).cost).toBeGreaterThan(0)
  expect(dsUsage('deepseek-chat', { prompt_tokens: 100, completion_tokens: 100 }).cost).toBe(0)
})

// A coder A feeds the reviewer R; the reviewer says `says[i]` on its i-th look.
const reviewed = async (review: number, says: string[]) => {
  const o = orch([node('A'), node('R', { review })], [['L', 'A'], ['A', 'R']])
  let a = 0, r = 0
  const rg = rig(o, async (n) => (n.id === 'A' ? ans(`code ${++a}`) : n.id === 'R' ? ans(says[Math.min(r++, says.length - 1)]) : lead(n)))
  await runOrchestra(o, rg.d)
  return rg
}

test('reviewer: OK the first time means one pass', async () => {
  const r = await reviewed(2, ['OK'])
  expect(r.ids().filter((i) => i === 'A')).toHaveLength(1)
  expect(r.ids().filter((i) => i === 'R')).toHaveLength(1)
})

test('reviewer: not OK, then OK gives two passes of the coder, and the feedback reaches it', async () => {
  const r = await reviewed(2, ['fix the null check', 'ok'])
  const coder = r.calls.filter((c) => c.id === 'A')
  expect(coder).toHaveLength(2)
  expect(coder[1].prompt).toContain('# Review feedback\nfix the null check')
  expect(coder[0].prompt).not.toContain('# Review feedback')
  expect(r.calls.find((c) => c.id === 'R')?.prompt).toContain('exactly `OK`')
  expect(r.log.some((e) => e.text.startsWith('orchReviewWarn'))).toBe(false)
})

test('reviewer: the number of fix rounds is the limit, then a warning', async () => {
  const r = await reviewed(2, ['bad'])
  expect(r.ids().filter((i) => i === 'A')).toHaveLength(3)
  expect(r.ids().filter((i) => i === 'R')).toHaveLength(3)
  expect(r.nodes.get('R')?.state).toBe('ok')
  expect(r.log.some((e) => e.text.startsWith('orchReviewWarn'))).toBe(true)
})

test('lead chat answers once with no tools and briefs nobody', async () => {
  const o = orch([node('A', { out: 'old report' })], [['L', 'A']])
  o.nodes[0] = { ...o.nodes[0], out: 'BRIEFING', sum: 7, final: 'FINAL', finalSum: 9, state: 'ok' }
  const r = rig(o, async () => ans('hello'))
  await leadChat(o, r.d, 'what did A find?')
  expect(r.calls).toHaveLength(1)
  expect(r.calls[0]).toMatchObject({ id: 'L', opts: { keep: true, tools: '' } })
  expect(r.calls[0].prompt).toContain('old report')
  expect(r.nodes.get('L')).toMatchObject({ out: 'BRIEFING', sum: 7, final: 'FINAL', finalSum: 9 })
  expect(r.log.map((e) => e.kind)).toEqual(['user', 'reply', 'usage'])
})

test('saving cuts long answers, drops their cache stamp, and survives a full quota', () => {
  const long = 'x'.repeat(5000)
  const o = orch([node('A', { out: long, sum: 5 }), node('B', { out: 'short', sum: 6 })], [], { log: Array.from({ length: 80 }, (_, i) => ({ from: '', to: '', text: i === 79 ? long : 'e', kind: 'reply' as const, at: i })) })
  const [s] = slim([o])
  expect(s.nodes[1].out!.length).toBeLessThan(4100)
  expect(s.nodes[1].sum).toBeUndefined()
  expect(s.nodes[2]).toMatchObject({ out: 'short', sum: 6 })
  const saved: string[] = []
  expect(save('k', [o], { setItem: (_k, v) => { saved.push(v) } })).toBe('ok')
  let first = true
  expect(save('k', [o], { setItem: () => { if (first) { first = false; throw new DOMException('full', 'QuotaExceededError') } } })).toBe('trimmed')
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(save('k', [o], { setItem: () => { throw new Error('full') } })).toBe('failed')
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})
