// The orchestra engine: types, limits and the run itself. No React and no Tauri in here: everything it needs comes in through `Deps`, so it is testable.
import type { Answer } from './vault'
import type { Key } from './i18n'
import { MAP_INTRO } from './deso'

export type Agent = 'claude' | 'agy' | 'codex' | 'deepseek' | 'nano'
export type Use = Omit<Answer, 'text'> & { same?: boolean }
export type Node = {
  id: string; x: number; y: number; kind: 'model' | 'rules' | 'start'
  agent?: Agent; model?: string; effort?: string; tools?: string; name?: string; role?: string // effort: Claude blocks only; tools = the only tools it may use; name = your title for the block; role = the recommended role it was picked for
  review?: number // reviewer: up to this many fix rounds (its input blocks rerun with its feedback until it answers OK); 0/undefined = a normal block
  text: string; notes: string[] // text = context for a model block, the rules themselves for a rules block; notes = embedded note names
  out?: string; img?: string; state?: 'run' | 'ok' | 'err'
  sid?: string; mapSum?: number // claude session continued with --resume, so the dialogue isn't resent; mapSum = hash of the map that session last saw
  final?: string; finalSum?: number // lead only: its answer after the agents reported back, and the hash of the reports it was written from
  sum?: number; use?: Use // sum = hash of what the block was last run with: unchanged → its answer is reused; use = tokens of the last call
}
export type Opts = { keep?: boolean; tools?: string; effort?: string; mapSum?: number; maxTurns?: number }
// The dialogue is saved with the orchestra. `task` = what an agent was asked, `user` = a message you wrote, `run` = a divider between runs.
// `usage` = the table of who spent what, posted after every run or answer (rows; no ids, so it never enters an agent's dialogue).
export type Entry = { from: string; to: string; text: string; kind: 'task' | 'reply' | 'error' | 'user' | 'run' | 'usage'; at: number; toId?: string; fromId?: string; quiet?: boolean; rows?: Row[]; img?: string }
export type Row = { who: string; use: Use }
// iso: agents work in a git worktree, wt: that worktree exists and holds changes to review; queue: one block at a time; default: blocks run as soon as their inputs are ready, in parallel;
// leadChat: a message to the lead is just answered, instead of briefing every agent again
export type Orch = { id: string; name: string; task: string; nodes: Node[]; edges: [string, string][]; log?: Entry[]; queue?: boolean; iso?: boolean; wt?: boolean; leadChat?: boolean }
export type Reply = Answer & { img?: string }

export const INPUT_MAX = 12000, NOTE_MAX = 6000 // chars: a longer handoff is cut; a longer embedded note is passed as a file to read
export const BUDGET = 3 // USD cap per call (claude --max-budget-usd): stops a runaway agent, not normal work
export const MAX_TURNS = 25 // tool-use turns per worker call: cuts an agent that keeps re-reading instead of answering
export const RUN_CAP = 10 // USD per run: no new block starts after this (a running one is still bound by BUDGET). Only Claude and DeepSeek report a cost.
export const RUN_TOKEN_CAP = 2_000_000 // input + output tokens per run: the same stop for agents that report no cost (agy)
export const RETRIES = 2
export const READ_ONLY = 'Read,Grep,Glob'
// Appended to every orchestra agent's system prompt: short answers are fewer output tokens AND smaller inputs for the next block.
export const BRIEF = 'Answer tersely, like a senior engineer in a hurry: no greeting, no preamble, no restating the task, no closing summary or offers. ' +
  'Fragments are fine; drop filler and hedging. Keep code, paths, names, numbers and errors exact. ' +
  'Write long material (code, full lists, reports) into files and reply with their paths and a one-line gist. ' +
  'A required output format (such as "### A" sections) still comes first and stays complete and self-contained.'
const REVIEW_PROTOCOL = '# Review protocol\nIf the result is acceptable, answer with exactly `OK` on the first line. Otherwise list the concrete problems and how to fix each.'
const DIRECT = 'Answer the user directly. Do not write ### sections and do not brief anyone.'
const TRANSIENT = /overload|rate.?limit|too many|429|50\d|timed? ?out|econn|network|temporar|unavailable/i // worth another try; a bad key or model is not

export const clip = (s: string) => (s.length > INPUT_MAX ? `${s.slice(0, INPUT_MAX)}\n…(cut: ${s.length - INPUT_MAX} more chars)` : s)
// cyrb53: 53 bits, so two different inputs colliding (and a stale answer being reused) is out of the question in practice
export const hash = (s: string) => {
  let a = 0xdeadbeef, b = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677) }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return 4294967296 * (2097151 & b) + (a >>> 0)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const retry = async <T,>(fn: () => Promise<T>, stop: () => boolean, wait = 2000): Promise<T> => {
  for (let tries = 0; ; tries++) {
    try { return await fn() } catch (e) {
      if (tries >= RETRIES || stop() || !TRANSIENT.test(String(e))) throw e
      await sleep(wait * 2 ** tries)
      if (stop()) throw e
    }
  }
}
// A worker's own effort; unset = medium, except Haiku, which takes no effort setting.
export const workerEffort = (n: Node) => n.effort ?? (n.model?.includes('haiku') ? undefined : 'medium')
// The lead answers with "### A" … sections; each agent receives only its own section (whole answer if the lead skipped it).
export const section = (leadOut: string, letter: string) => {
  const parts = leadOut.split(/^###\s*([A-Z])\s*$/m)
  for (let i = 1; i < parts.length; i += 2) if (parts[i] === letter) return parts[i + 1].trim()
  return leadOut
}
// A writing block can edit files or run commands; it is one that is not limited to reading tools. DeepSeek and Nano never touch the project.
const READ_TOOLS = new Set(READ_ONLY.split(','))
export const isWriter = (n: Node, tools?: string) =>
  ['claude', 'agy', 'codex'].includes(n.agent ?? 'claude') && !(tools !== undefined && (tools === '' || tools.split(',').every((x) => READ_TOOLS.has(x.trim()))))
const isOk = (s: string) => /^ok\b/i.test(s.trim())

export type Deps = {
  exec: (n: Node, build: (resumed: boolean) => string, opts: Opts) => Promise<Reply>
  patch: (id: string, p: Partial<Node>) => void
  addLog: (e: Omit<Entry, 'at'>) => void
  stamp: () => Promise<string> // state of the project (or its worktree): a block that reads it is rerun when it changed
  stopped: () => boolean
  history: (id: string) => string // the saved dialogue as one agent saw it
  embed: (names: string[]) => string
  leadMap: (query: string) => string // the project map, the notes matching the query first
  label: (n: Node) => string
  who: (n: Node) => string
  t: (k: Key, v?: Record<string, string | number>) => string
}

/** One run. `o` is the snapshot at the start: later changes go through `deps.patch`, and the engine tracks the answers itself (prev, outs). */
export async function runOrchestra(o: Orch, d: Deps, { msg, force = false }: { msg?: string; force?: boolean } = {}) {
  const { t, patch, addLog, who, label } = d
  const prev = new Map(o.nodes.map((n) => [n.id, n]))
  const agents = o.nodes.filter((n) => n.kind !== 'rules') // the lead (start) and the model blocks
  const byId = new Map(o.nodes.map((n) => [n.id, n]))
  const letters = o.nodes.filter((n) => n.kind === 'model').map((n) => n.id) // A, B, C… in creation order: how the lead addresses each agent
  const tag = (id: string) => String.fromCharCode(65 + letters.indexOf(id))
  // Kahn's order over agent blocks; anything left over is a cycle.
  const left = new Set(agents.map((n) => n.id)), order: Node[] = []
  while (left.size) {
    const ready = [...left].filter((id) => !o.edges.some(([a, b]) => b === id && left.has(a)))
    if (!ready.length) { patch([...left][0], { state: 'err', out: t('orchCycle') }); return }
    ready.forEach((id) => { left.delete(id); order.push(byId.get(id)!) })
  }
  addLog({ from: '', to: '', text: '', kind: 'run' })
  const lead = o.nodes.find((n) => n.kind === 'start')!
  if (msg) addLog({ from: t('orchUser'), to: who(lead), toId: lead.id, text: msg, kind: 'user' })
  o.nodes.forEach((n) => patch(n.id, { out: undefined, final: undefined, state: undefined, use: undefined, img: undefined, sid: n.kind === 'start' ? n.sid : undefined })) // a worker's chat session restarts from the log after each run
  const outs = new Map<string, string>()
  let capped = false
  const bad = new Set<string>() // blocks that failed or were skipped because an input failed; independent branches keep running
  const rows: Row[] = [] // filled as blocks finish; posted as one table when the run ends
  // shortcut: the caps are checked when a block starts, so parallel blocks can overshoot by one round; upgrade to reservations if it matters
  const over = () => {
    const s = rows.reduce((a, r) => ({ cost: a.cost + r.use.cost, tok: a.tok + r.use.input + r.use.output }), { cost: 0, tok: 0 })
    return s.cost >= RUN_CAP ? t('orchCap', { n: RUN_CAP }) : s.tok >= RUN_TOKEN_CAP ? t('orchTokCap', { n: `${RUN_TOKEN_CAP / 1e6}M` }) : ''
  }
  const capHit = () => { const why = over(); if (why && !capped) { capped = true; addLog({ from: '', to: '', kind: 'error', text: why }) } return !!why }
  // Writing blocks take turns: two agents editing one folder at once corrupt each other's work.
  let lock: Promise<unknown> = Promise.resolve()
  const exclusive = <T,>(f: () => Promise<T>): Promise<T> => { const r = lock.then(f); lock = r.catch(() => {}); return r }

  // Runs one block (with the feedback of a reviewer, when it is being redone). false = it did not produce an answer.
  const block = async (n: Node, feedback = ''): Promise<boolean> => {
    if (d.stopped() || capHit()) return false
    const from = o.edges.filter((e) => e[1] === n.id).map((e) => byId.get(e[0])!)
    const rules = from.filter((f) => f.kind === 'rules').map((f) => f.text).join('\n')
    const inputs = from.filter((f) => f.kind !== 'rules').map((f) => `## ${f.kind === 'start' ? 'Lead' : label(f)}\n${f.kind === 'start' ? section(outs.get(f.id) ?? '', tag(n.id)) : clip(outs.get(f.id) ?? '')}`).join('\n\n')
    const embedded = d.embed(n.notes)
    let build: (resumed: boolean) => string, key: string, opts: Opts = {}
    if (n.kind === 'start') {
      // Who to address is derived from the links on the canvas, so the user never has to name anyone.
      const to = o.edges.filter((e) => e[0] === n.id).map((e) => byId.get(e[1])!)
      const list = to.map((f) => `- ${tag(f.id)}: ${label(f)}${f.text ? ` (context: ${f.text.slice(0, 160)})` : ''}`).join('\n')
      const role = to.length
        ? `You are the lead agent of an orchestra. Only you see the project map. Whatever the task or the user's message says, you ALWAYS brief EVERY agent below, none skipped. Answer ONLY with one section per agent, headed exactly "### A" (its letter), holding self-contained instructions: which notes/files to look at and what to produce. They never see the map or the task.\n\n# Agents\n${list}`
        : 'You are the lead agent of an orchestra. Do the task.'
      // Unchanging parts first so the prompt cache can reuse them; a resumed session already holds the dialogue (and the map, if unchanged).
      // The lead sees the notes that match the task (and their neighbours) first, in a smaller budget.
      const lmap = d.leadMap([o.task, n.text, msg].join(' '))
      build = (resumed) => [`# Role\n${role}`, (!resumed || n.mapSum !== hash(lmap)) && `${MAP_INTRO}\n\n# Graph map\n${lmap}`, o.task && `# Task\n${o.task}`, n.text && `# Input\n${n.text}`, !resumed && d.history(n.id) && `# Conversation so far\n${d.history(n.id)}`, msg && `# Message from the user\n${msg}`].filter(Boolean).join('\n\n')
      key = [role, lmap, o.task, n.text, msg].join('\0') // not the dialogue: it grows every run
      opts = { keep: true, tools: to.length ? '' : undefined, effort: n.effort ?? 'low', mapSum: hash(lmap) } // a lead that only briefs agents needs no tools (it has the map) and little thinking
    } else {
      build = () => [rules && `# Rules\n${rules}`, !inputs && o.task && `# Task\n${o.task}`, n.text && `# Context\n${n.text}`, embedded && `# Notes\n${embedded}`, inputs && `# Input from previous agents\n${inputs}`,
        feedback && `# Review feedback\n${feedback}`, n.review && REVIEW_PROTOCOL].filter(Boolean).join('\n\n')
      key = build(false)
      opts = { effort: workerEffort(n), tools: n.tools, maxTurns: MAX_TURNS }
    }
    // blocks that can read the project also depend on its state: after the code changed their old answer is stale
    const stamp = n.agent !== 'deepseek' && n.agent !== 'nano' ? await d.stamp().catch(() => '') : ''
    const sum = hash([n.agent ?? 'claude', n.model, opts.effort, n.tools, o.iso, stamp, key].join('\0')), old = prev.get(n.id)
    if (!force && old?.state === 'ok' && old.out && old.sum === sum && (n.agent !== 'nano' || old.img)) { // same input as last time: reuse the answer, spend nothing
      outs.set(n.id, old.out); const use = { input: 0, cached: 0, output: 0, cost: 0, same: true }
      patch(n.id, { state: 'ok', out: old.out, img: old.img, sum, use }); rows.push({ who: who(n), use }); return true
    }
    if (d.stopped()) return false
    const given = from.filter((f) => f.kind !== 'rules').map((f) => (f.kind === 'start' ? section(outs.get(f.id) ?? '', tag(n.id)) : outs.get(f.id) ?? '')).join('\n\n') || n.text || o.task || (n.kind === 'start' ? t('orchLeadDefault') : '')
    const sender = from.filter((f) => f.kind !== 'rules').map(who).join(', ') || t('orchUser')
    if (!(n.kind === 'start' && msg)) addLog({ from: sender, to: who(n), toId: n.id, text: feedback ? `${given}\n\n# Review feedback\n${feedback}` : given, kind: 'task', quiet: from.length > 0 && from.every((f) => f.kind === 'model') && !feedback }) // your message is already in the log; a model-to-model handoff is already shown as the sender's reply
    patch(n.id, { state: 'run' })
    const writes = isWriter(n, opts.tools)
    try {
      const call = () => d.exec(n, build, opts)
      // A retry would start an agent that may already have edited files on top of its own half-done work: only reading blocks are retried.
      const { text: out, img, ...use } = await (writes ? exclusive(call) : retry(call, d.stopped))
      rows.push({ who: who(n), use })
      outs.set(n.id, out); patch(n.id, { state: 'ok', out, img, sum, use, ...(opts.mapSum !== undefined && { mapSum: opts.mapSum }) })
      const to = o.edges.filter((e) => e[0] === n.id).map((e) => who(byId.get(e[1])!)).join(', ') || t('orchUser')
      addLog({ from: who(n), fromId: n.id, to, text: out, kind: 'reply', img })
      return true
    } catch (e) {
      const m = String(e instanceof Error ? e.message : e)
      patch(n.id, { state: 'err', out: m }); addLog({ from: who(n), fromId: n.id, to: '', text: writes ? `${m}\n\n${t('orchWriterFail')}` : m, kind: 'error' }); bad.add(n.id)
      return false
    }
  }

  const step = async (n: Node) => {
    if (d.stopped()) return
    if (o.edges.some((e) => e[1] === n.id && bad.has(e[0]))) { bad.add(n.id); return }
    if (!(await block(n)) || !n.review) return
    // Reviewer: not OK → its input blocks do the work again with its feedback, then it looks again. The graph stays a DAG; the loop lives here.
    const coders = o.edges.filter((e) => e[1] === n.id).map((e) => byId.get(e[0])!).filter((f) => f.kind === 'model')
    let out = outs.get(n.id)!, rounds = n.review
    while (!isOk(out) && rounds > 0) {
      rounds--
      const ok = await Promise.all(coders.map((c) => block(c, out)))
      if (!ok.every(Boolean)) { if (coders.some((c) => bad.has(c.id))) bad.add(n.id); return }
      if (!(await block(n))) return
      out = outs.get(n.id)!
    }
    if (!isOk(out)) addLog({ from: who(n), fromId: n.id, to: '', kind: 'error', text: t('orchReviewWarn', { n: n.review }) })
  }
  // Each block waits only for its own inputs (parallel) or for the block before it (queue); `order` is topological, so those promises exist.
  const done = new Map<string, Promise<void>>()
  for (const [i, n] of order.entries()) {
    const deps = o.queue ? [done.get(order[i - 1]?.id)] : o.edges.filter((e) => e[1] === n.id).map((e) => done.get(e[0]))
    done.set(n.id, Promise.all(deps).then(() => step(n)))
  }
  await Promise.all(done.values())
  // The agents report back: the lead reads what the last blocks answered and writes the final answer (once; it does not brief anyone again).
  const sinks = order.filter((n) => n.kind === 'model' && outs.has(n.id) && !o.edges.some((e) => e[0] === n.id))
  if (!bad.has(lead.id) && !d.stopped() && sinks.length && o.edges.some((e) => e[0] === lead.id) && !over()) {
    const prompt = [`# Role\nYou are the lead agent of an orchestra. Your agents have reported back. Write the final answer to the task: merge their findings, say where they disagree, and what is still unknown. Do not brief anyone again.`,
      o.task && `# Task\n${o.task}`, msg && `# Message from the user\n${msg}`, `# Reports\n${sinks.map((n) => `## ${who(n)}\n${clip(outs.get(n.id)!)}`).join('\n\n')}`,
      bad.size > 0 && `# Failed or skipped agents (no report; treat their part as unknown)\n${[...bad].map((id) => who(byId.get(id)!)).join('\n')}`].filter(Boolean).join('\n\n')
    const fsum = hash(['final', lead.agent, lead.model, lead.effort, prompt].join('\0')), old = prev.get(lead.id)
    const fin = `${who(lead)} · ${t('orchFinal')}`
    try {
      if (!force && old?.final && old.finalSum === fsum) {
        patch(lead.id, { final: old.final, finalSum: fsum }); rows.push({ who: fin, use: { input: 0, cached: 0, output: 0, cost: 0, same: true } })
        addLog({ from: fin, fromId: lead.id, to: t('orchUser'), text: old.final, kind: 'reply' })
      } else {
        patch(lead.id, { state: 'run' })
        const { text: final, ...use } = await retry(() => d.exec(lead, () => prompt, { tools: '', effort: lead.effort ?? 'low' }), d.stopped)
        rows.push({ who: fin, use }); patch(lead.id, { final, finalSum: fsum, state: 'ok' })
        addLog({ from: fin, fromId: lead.id, to: t('orchUser'), text: final, kind: 'reply' })
      }
    } catch (e) {
      patch(lead.id, { state: 'ok' }); addLog({ from: fin, fromId: lead.id, to: '', text: String(e instanceof Error ? e.message : e), kind: 'error' })
    }
  }
  if (rows.length) addLog({ from: '', to: '', text: '', kind: 'usage', rows })
}

/** A message to the lead that is only answered: nobody is briefed, and the lead's briefing, cache and final answer stay as they were. */
export async function leadChat(o: Orch, d: Deps, msg: string) {
  const { t, patch, addLog, who } = d
  const lead = o.nodes.find((n) => n.kind === 'start')!
  addLog({ from: t('orchUser'), to: who(lead), toId: lead.id, text: msg, kind: 'user' })
  patch(lead.id, { state: 'run' })
  try {
    const reports = o.nodes.filter((n) => n.kind === 'model' && n.out).map((n) => `## ${who(n)}\n${clip(n.out!)}`)
    if (lead.final) reports.push(`## ${who(lead)} · ${t('orchFinal')}\n${clip(lead.final)}`)
    const lmap = d.leadMap([o.task, lead.text, msg].join(' '))
    const build = (resumed: boolean) => resumed ? `${DIRECT}\n\n${msg}` : [
      '# Role\nYou are the lead of an orchestra, answering the user. You do not brief the agents.', `${MAP_INTRO}\n\n# Graph map\n${lmap}`, o.task && `# Task\n${o.task}`,
      `# Conversation so far\n${[d.history(lead.id), ...reports].filter(Boolean).join('\n\n')}`, `# Message from the user\n${msg}`].filter(Boolean).join('\n\n')
    const { text: out, img, ...use } = await retry(() => d.exec(lead, build, { keep: true, tools: '', effort: lead.effort ?? 'low' }), d.stopped)
    addLog({ from: who(lead), fromId: lead.id, to: t('orchUser'), text: out, kind: 'reply', img })
    addLog({ from: '', to: '', text: '', kind: 'usage', rows: [{ who: who(lead), use }] })
  } catch (e) {
    addLog({ from: who(lead), fromId: lead.id, to: '', text: String(e instanceof Error ? e.message : e), kind: 'error' })
  } finally { patch(lead.id, { state: lead.state }) }
}

// ---- saving ----
const SAVE_MAX = 4000 // chars of one saved answer
export const LOG_MAX = 200
const LOG_MIN = 50
const cut = (s: string) => (s.length > SAVE_MAX ? `${s.slice(0, SAVE_MAX)}…(cut)` : s)
/** What goes to disk: long answers shortened, images dropped. A shortened answer loses its cache stamp, so it is never reused as if it were whole. */
export const slim = (orchs: Orch[], keep = LOG_MAX): Orch[] => orchs.map((o) => ({
  ...o,
  log: o.log?.slice(-keep).map((e) => ({ ...e, text: cut(e.text), img: undefined })),
  nodes: o.nodes.map((n) => ({
    ...n, img: undefined,
    out: n.out && cut(n.out), sum: n.out && n.out.length > SAVE_MAX ? undefined : n.sum,
    final: n.final && cut(n.final), finalSum: n.final && n.final.length > SAVE_MAX ? undefined : n.finalSum,
  })),
}))
/** ok / trimmed (the quota was hit: only the last log entries were kept) / failed (nothing could be saved). */
export function save(key: string, orchs: Orch[], store: Pick<Storage, 'setItem'> = localStorage): 'ok' | 'trimmed' | 'failed' {
  try { store.setItem(key, JSON.stringify(slim(orchs))); return 'ok' } catch { /* quota: try less */ }
  try { store.setItem(key, JSON.stringify(slim(orchs, LOG_MIN))); return 'trimmed' } catch (e) { console.error('orchestra: cannot save', e); return 'failed' }
}
