import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, FolderOpen, Play, Plus, Square, Trash2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { agyModels, inTauri, openRoot, runAgent, stopAgents, type Answer } from '../vault'
import Markdown from './Markdown'
import { MODELS } from './AgentSidebar'
import { graphMap, MAP_INTRO, tokens, type Note } from '../deso'
import type { MenuItem } from './ContextMenu'
import { getKey } from '../keys'
import { dsChat } from '../deepseek'

type Agent = 'claude' | 'agy' | 'codex' | 'deepseek' | 'nano'
const DEEPSEEK = MODELS.deepseek
const EFFORTS = ['low', 'medium', 'high', 'max'] as const
const NANO = MODELS.nano
const CODEX = [['', 'Codex (default model)']] as const // model comes from the user's Codex config
const NAMES = { claude: 'Claude', agy: 'Antigravity', codex: 'Codex', deepseek: 'DeepSeek', nano: 'Nano Banana' } as const
// Recommended model per role, shown first in every model picker. agy takes its effort from the model name (...-low / ...-high).
const PRESETS = [
  { ru: 'Ведущий', en: 'Lead', agent: 'agy', effort: 'low' },
  { ru: 'Планирование задач', en: 'Task planning', agent: 'agy', effort: 'high' },
  { ru: 'Кодинг', en: 'Coding', agent: 'claude', model: 'claude-sonnet-5-5' },
  { ru: 'Кодинг (сложный)', en: 'Hard coding', agent: 'claude', model: 'claude-opus-5-5' },
  { ru: 'Поиск по карте и файлам', en: 'Search map & files', agent: 'claude', model: 'claude-haiku-5-5' },
  { ru: 'Поиск по карте и файлам', en: 'Search map & files', agent: 'deepseek', model: 'deepseek-v4-flash' },
  { ru: 'Картинки', en: 'Images', agent: 'nano', model: NANO[0][0] },
] as const
type Node = {
  id: string; x: number; y: number; kind: 'model' | 'rules' | 'start'
  agent?: Agent; model?: string; effort?: string; name?: string; role?: string // effort: Claude blocks only; name = your title for the block; role = the recommended role it was picked for
  text: string; notes: string[] // text = context for a model block, the rules themselves for a rules block; notes = embedded note names
  out?: string; img?: string; state?: 'run' | 'ok' | 'err'
  sid?: string; mapSum?: number // claude session continued with --resume, so the dialogue isn't resent; mapSum = hash of the map that session last saw
  sum?: number; use?: Use // sum = hash of what the block was last run with: unchanged → its answer is reused; use = tokens of the last call
}
type Use = Omit<Answer, 'text'> & { same?: boolean }
type Opts = { keep?: boolean; tools?: string; effort?: string; mapSum?: number }
// The dialogue is saved with the orchestra. `task` = what an agent was asked, `user` = a message you wrote, `run` = a divider between runs.
// `usage` = the table of who spent what, posted after every run or answer (rows; no ids, so it never enters an agent's dialogue).
type Entry = { from: string; to: string; text: string; kind: 'task' | 'reply' | 'error' | 'user' | 'run' | 'usage'; at: number; toId?: string; fromId?: string; quiet?: boolean; rows?: Row[]; img?: string }
type Row = { who: string; use: Use }
type Orch = { id: string; name: string; task: string; nodes: Node[]; edges: [string, string][]; log?: Entry[]; queue?: boolean } // queue: one block at a time; default: blocks run as soon as their inputs are ready, in parallel
const LOG_MAX = 200
const INPUT_MAX = 12000, NOTE_MAX = 6000 // chars: a longer handoff is cut; a longer embedded note is passed as a file to read
const BUDGET = 3 // USD cap per call (claude --max-budget-usd): stops a runaway agent, not normal work
// Appended to every orchestra agent's system prompt: short answers are fewer output tokens AND smaller inputs for the next block.
const BRIEF = 'Answer tersely, like a senior engineer in a hurry: no greeting, no preamble, no restating the task, no closing summary or offers. ' +
  'Fragments are fine; drop filler and hedging. Keep code, paths, names, numbers and errors exact. ' +
  'Write long material (code, full lists, reports) into files and reply with their paths and a one-line gist. ' +
  'A required output format (such as "### A" sections) still comes first and stays complete and self-contained.'
const clip = (s: string) => (s.length > INPUT_MAX ? `${s.slice(0, INPUT_MAX)}\n…(cut: ${s.length - INPUT_MAX} more chars)` : s)
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

const W = 272, HEAD = 20 // node width; y of the link handles, measured from the node's top
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
const uid = () => Math.random().toString(36).slice(2, 9)
const fresh = (n: number): Orch => ({ id: uid(), name: `Orchestra ${n}`, task: '', nodes: [], edges: [] })
// Older saves may hold more than one start block; keep the first.
const dedupe = (o: Orch): Orch => { const keep = o.nodes.filter((n, i) => n.kind !== 'start' || i === o.nodes.findIndex((x) => x.kind === 'start')); return { ...o, nodes: keep, edges: o.edges.filter((e) => e.every((id) => keep.some((n) => n.id === id))) } }
const load = (k: string): Orch[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? ''); if (v.length) return (v as Orch[]).map((o) => dedupe({ ...o, nodes: o.nodes.map((n) => (n.state === 'run' ? { ...n, state: undefined } : n)) })) } catch { /* first run */ } return [fresh(1)] }
const field = 'px-3 py-1.5 rounded-lg bg-field border border-line focus:border-accent outline-none text-xs placeholder:text-dim'

export default function Orchestra({ notes, project, onMenu }: { notes: Note[]; project: string; onMenu: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  const { t, lang } = useI18n()
  const KEY = `desovault.orchestra.${project}`
  const [orchs, setOrchs] = useState(() => load(KEY))
  const [aid, setAid] = useState(orchs[0].id)
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null) // link being dragged
  const [running, setRunning] = useState(false)
  const stopped = useRef(false) // Stop was pressed: blocks not started yet stay idle
  const [agy, setAgy] = useState<readonly (readonly [string, string])[]>(MODELS.agy)
  const canvas = useRef<HTMLDivElement>(null)
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(orchs, (k, v) => (k === 'img' ? undefined : v))) }, [orchs, KEY])
  useEffect(() => { if (inTauri) agyModels().then((l) => l.length && setAgy(l)).catch(console.error) }, [])

  const o = orchs.find((x) => x.id === aid) ?? orchs[0]
  // Every orchestra always has its start block: the lead agent. It has a single (output) handle and cannot be deleted. Its context is always the project map.
  useEffect(() => { if (!o.nodes.some((n) => n.kind === 'start')) setOrchs((os) => os.map((x) => (x.id !== o.id || x.nodes.some((n) => n.kind === 'start') ? x : { ...x, nodes: [{ id: uid(), x: 40, y: 40, kind: 'start', agent: 'claude', model: MODELS.claude[0][0], text: '', notes: [] }, ...x.nodes] }))) }, [o.id, o.nodes])
  const upd = (f: (o: Orch) => Orch) => setOrchs((os) => os.map((x) => (x.id === o.id ? f(x) : x)))
  const log = o.log ?? []
  const addLog = (e: Omit<Entry, 'at'>) => upd((c) => ({ ...c, log: [...(c.log ?? []), { ...e, at: Date.now() }].slice(-LOG_MAX) }))
  const patch = (id: string, p: Partial<Node>) => upd((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }))
  const map = useMemo(() => graphMap(notes), [notes])
  const mapTok = useMemo(() => tokens(map), [map])
  const models = (a: Agent): readonly (readonly [string, string])[] => (a === 'claude' ? MODELS.claude : a === 'deepseek' ? DEEPSEEK : a === 'codex' ? CODEX : a === 'nano' ? NANO : agy)
  // An embedded note in full, or, if large, a pointer the agent reads itself (agents run in the project folder with file tools).
  const embed = (names: string[]) => names.map((x) => { const c = notes.find((k) => k.name === x)?.content ?? ''
    return `## @${x}\n${c.length > NOTE_MAX ? `(large note, ~${tokens(c)} tok: read the file \`${x}.deso\` in the project folder or its \`.desovault\` folder)` : c}` }).join('\n\n')
  const resolve = (p: (typeof PRESETS)[number]): Partial<Node> => {
    if (p.agent !== 'agy') return { agent: p.agent, model: p.model, effort: undefined }
    const f = agy.filter(([m]) => m.includes('3.8') && m.includes('flash'))
    return { agent: 'agy', model: (f.find(([m]) => m.endsWith(`-${p.effort}`)) ?? f[0] ?? agy[0])[0], effort: undefined }
  }
  const presetLabel = (p: (typeof PRESETS)[number]) => { const m = resolve(p); return `${p[lang]} — ${models(p.agent).find((x) => x[0] === m.model)?.[1] ?? m.model}` }
  const label = (n: Node) => n.kind === 'rules' ? t('blockRules') : `${NAMES[n.agent ?? 'claude']} · ${models(n.agent ?? 'claude').find((m) => m[0] === n.model)?.[1] ?? n.model}`

  const letter = (id: string) => String.fromCharCode(65 + o.nodes.filter((n) => n.kind === 'model').findIndex((n) => n.id === id))
  const who = (n: Node) => `${n.kind === 'start' ? t('orchLead') : letter(n.id)} · ${n.name ? `${n.name} (${label(n)})` : label(n)}`

  const add = (x: number, y: number, n: Partial<Node>) => upd((c) => ({ ...c, nodes: [...c.nodes, { id: uid(), x, y, kind: 'model', text: '', notes: [], ...n }] }))
  const remove = (id: string) => o.nodes.find((n) => n.id === id)?.kind !== 'start' && upd((c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== id), edges: c.edges.filter((e) => !e.includes(id)) }))
  const connect = (from: string, to: string) =>
    upd((c) => (from === to || c.nodes.find((n) => n.id === to)?.kind !== 'model' || c.edges.some((e) => e[0] === from && e[1] === to) ? c : { ...c, edges: [...c.edges, [from, to]] }))

  // Drag from an output handle and release over another block to link them.
  const startWire = (from: string, e: React.PointerEvent) => {
    e.preventDefault()
    const at = (m: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { from, x: m.clientX - r.left + canvas.current!.scrollLeft, y: m.clientY - r.top + canvas.current!.scrollTop } }
    const move = (m: PointerEvent) => setWire(at(m))
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setWire(null)
      const to = document.elementsFromPoint(m.clientX, m.clientY).map((el) => (el as HTMLElement).dataset.node).find(Boolean)
      if (to) connect(from, to)
    }
    setWire(at(e))
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const canvasMenu = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    const x = e.clientX - r.left + canvas.current!.scrollLeft, y = e.clientY - r.top + canvas.current!.scrollTop
    const items: MenuItem[] = [
      { label: `★ ${lang === 'ru' ? 'Рекомендуемые' : 'Recommended'}`, children: PRESETS.map((p) => ({ label: presetLabel(p), onClick: () => add(x, y, { ...resolve(p), role: p[lang] }) })) },
      { label: 'Claude', children: MODELS.claude.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'claude', model: m }) })) },
      { label: 'Antigravity', children: agy.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'agy', model: m }) })) },
      { label: 'Codex — Coming soon', disabled: true },
      { label: 'DeepSeek', children: DEEPSEEK.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'deepseek', model: m }) })) },
      { label: 'Nano Banana', children: NANO.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'nano', model: m }) })) },
      { label: t('blockRules'), sep: true, onClick: () => add(x, y, { kind: 'rules' }) },
    ]
    onMenu(e, items)
  }

  // Hold the left button on empty canvas and drag to move around (scrolls the canvas).
  const pan = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-node],button,path')) return
    const c = canvas.current!, sx = e.clientX + c.scrollLeft, sy = e.clientY + c.scrollTop
    c.style.cursor = 'grabbing'
    const move = (m: PointerEvent) => { c.scrollLeft = sx - m.clientX; c.scrollTop = sy - m.clientY }
    const up = () => { c.style.cursor = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const drag = (n: Node, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,select,input')) return
    const el = e.currentTarget as HTMLElement, sx = e.clientX - n.x, sy = e.clientY - n.y
    el.setPointerCapture(e.pointerId)
    el.onpointermove = (m) => patch(n.id, { x: Math.max(0, m.clientX - sx), y: Math.max(0, m.clientY - sy) })
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null }
  }

  // `msg` = something you wrote to the lead: the lead takes it as a new instruction and briefs every agent again.
  // force (Shift+click on Run): rerun every block, even one whose input has not changed.
  const run = async (msg?: string, force = false) => {
    if (running) return
    stopped.current = false
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
    setRunning(true); addLog({ from: '', to: '', text: '', kind: 'run' })
    const lead = o.nodes.find((n) => n.kind === 'start')!
    if (msg) addLog({ from: t('orchUser'), to: who(lead), toId: lead.id, text: msg, kind: 'user' })
    try {
    upd((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, out: undefined, state: undefined, use: undefined, img: undefined, sid: n.kind === 'start' ? n.sid : undefined })) })) // a worker's chat session restarts from the log after each run
    const outs = new Map<string, string>()
    // The lead answers with "### A" … sections; each agent receives only its own section (whole answer if the lead skipped it).
    const section = (leadOut: string, id: string) => {
      const parts = leadOut.split(/^###\s*([A-Z])\s*$/m)
      for (let i = 1; i < parts.length; i += 2) if (parts[i] === tag(id)) return parts[i + 1].trim()
      return leadOut
    }
    let failed = false
    const rows: Row[] = [] // filled as blocks finish; posted as one table when the run ends
    const step = async (n: Node) => {
      if (failed || stopped.current) return
      const from = o.edges.filter((e) => e[1] === n.id).map((e) => byId.get(e[0])!)
      const rules = from.filter((f) => f.kind === 'rules').map((f) => f.text).join('\n')
      const inputs = from.filter((f) => f.kind !== 'rules').map((f) => `## ${f.kind === 'start' ? 'Lead' : label(f)}\n${f.kind === 'start' ? section(outs.get(f.id) ?? '', n.id) : clip(outs.get(f.id) ?? '')}`).join('\n\n')
      const embedded = embed(n.notes)
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
        const lmap = graphMap(notes, undefined, [o.task, n.text, msg].join(' '))
        build = (resumed) => [`# Role\n${role}`, (!resumed || n.mapSum !== hash(lmap)) && `${MAP_INTRO}\n\n# Graph map\n${lmap}`, o.task && `# Task\n${o.task}`, n.text && `# Input\n${n.text}`, !resumed && history(n.id) && `# Conversation so far\n${history(n.id)}`, msg && `# Message from the user\n${msg}`].filter(Boolean).join('\n\n')
        key = [role, lmap, o.task, n.text, msg].join('\0') // not the dialogue: it grows every run
        opts = { keep: true, tools: to.length ? '' : undefined, effort: n.effort ?? 'low', mapSum: hash(lmap) } // a lead that only briefs agents needs no tools (it has the map) and little thinking
      } else {
        build = () => [rules && `# Rules\n${rules}`, !inputs && o.task && `# Task\n${o.task}`, n.text && `# Context\n${n.text}`, embedded && `# Notes\n${embedded}`, inputs && `# Input from previous agents\n${inputs}`]
          .filter(Boolean).join('\n\n')
        key = build(false)
        opts = { effort: n.effort }
      }
      const sum = hash([n.agent ?? 'claude', n.model, n.effort, key].join('\0')), old = prev.get(n.id)
      if (!force && old?.state === 'ok' && old.out && old.sum === sum && (n.agent !== 'nano' || old.img)) { // same input as last time: reuse the answer, spend nothing
        outs.set(n.id, old.out); const use = { input: 0, cached: 0, output: 0, cost: 0, same: true }
        patch(n.id, { state: 'ok', out: old.out, img: old.img, sum, use }); rows.push({ who: who(n), use }); return
      }
      if (stopped.current) return
      const given = from.filter((f) => f.kind !== 'rules').map((f) => (f.kind === 'start' ? section(outs.get(f.id) ?? '', n.id) : outs.get(f.id) ?? '')).join('\n\n') || n.text || o.task || (n.kind === 'start' ? t('orchLeadDefault') : '')
      const sender = from.filter((f) => f.kind !== 'rules').map(who).join(', ') || t('orchUser')
      if (!(n.kind === 'start' && msg)) addLog({ from: sender, to: who(n), toId: n.id, text: given, kind: 'task', quiet: from.length > 0 && from.every((f) => f.kind === 'model') }) // your message is already in the log; a model-to-model handoff is already shown as the sender's reply
      patch(n.id, { state: 'run' })
      try {
        const { text: out, img, ...use } = await exec(n, build, opts)
        rows.push({ who: who(n), use })
        outs.set(n.id, out); patch(n.id, { state: 'ok', out, img, sum, use, ...(opts.mapSum !== undefined && { mapSum: opts.mapSum }) })
        const to = o.edges.filter((e) => e[0] === n.id).map((e) => who(byId.get(e[1])!)).join(', ') || t('orchUser')
        addLog({ from: who(n), fromId: n.id, to, text: out, kind: 'reply', img })
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e)
        patch(n.id, { state: 'err', out: msg }); addLog({ from: who(n), fromId: n.id, to: '', text: msg, kind: 'error' }); failed = true
      }
    }
    // Each block waits only for its own inputs (parallel) or for the block before it (queue); `order` is topological, so those promises exist.
    const done = new Map<string, Promise<void>>()
    for (const [i, n] of order.entries()) {
      const deps = o.queue ? [done.get(order[i - 1]?.id)] : o.edges.filter((e) => e[1] === n.id).map((e) => done.get(e[0]))
      done.set(n.id, Promise.all(deps).then(() => step(n)))
    }
    await Promise.all(done.values())
    if (rows.length) addLog({ from: '', to: '', text: '', kind: 'usage', rows })
    } finally { setRunning(false) }
  }

  // The saved dialogue as one agent saw it: what it was asked and what it answered.
  const history = (id: string) => log.filter((e) => (e.toId === id || e.fromId === id) && e.kind !== 'error').slice(-12)
    .map((e) => `${e.kind === 'reply' ? 'Assistant' : 'User'}: ${e.text}`).join('\n\n')

  // keep: continue the block's claude session (--resume) instead of resending the dialogue. agy gets the full prompt every time:
  // its --conversation resume was ~8x slower than a fresh call when tried.
  const exec = async (n: Node, build: (resumed: boolean) => string, { keep, tools, effort = '' }: Opts = {}): Promise<Answer & { img?: string }> => {
    if (n.agent === 'nano') return nano(n.model ?? NANO[0][0], build(false))
    if (n.agent === 'deepseek') return deepseek(n.model ?? DEEPSEEK[0][0], build(false))
    if (!inTauri) throw new Error(t('desktopOnly'))
    const cli = n.agent === 'agy' || n.agent === 'codex' ? n.agent : 'claude'
    const go = async (resumed: boolean, session?: string) => {
      const prompt = build(resumed)
      if (!prompt.trim()) throw new Error(t('orchNoInput'))
      const a = await runAgent(cli, prompt, n.model ?? MODELS.claude[0][0], cli !== 'claude' ? '' : effort, { session, resume: resumed, tools, system: BRIEF, budget: BUDGET })
      return { ...a, text: a.text.trim() }
    }
    if (cli !== 'claude' || !keep) return go(false)
    if (n.sid) {
      try { return await go(true, n.sid) } catch (e) { if (!/No conversation found/i.test(String(e))) throw e } // session gone (cleaned up, other folder): start a new one
    }
    const sid = crypto.randomUUID()
    const out = await go(false, sid)
    patch(n.id, { sid })
    return out
  }

  // DeepSeek has no CLI: a plain API call (stateless, so the dialogue is replayed in the prompt like agy).
  const deepseek = async (model: string, prompt: string): Promise<Answer> => {
    const key = getKey('deepseek')
    if (!key) throw new Error(t('dsNoKey'))
    if (!prompt.trim()) throw new Error(t('orchNoInput'))
    const j = await dsChat(key, { model, messages: [{ role: 'system', content: BRIEF }, { role: 'user', content: prompt }] })
    const u = j.usage ?? {}, cached = u.prompt_cache_hit_tokens ?? 0
    return { text: String(j.choices?.[0]?.message?.content ?? '').trim(), input: (u.prompt_tokens ?? 0) - cached, cached, output: u.completion_tokens ?? 0, cost: 0 }
  }

  // Nano Banana (Gemini image models): the answer is text plus an inline image, shown in the block and the dialogue.
  const nano = async (model: string, prompt: string): Promise<Answer & { img?: string }> => {
    const key = getKey('agy') // the Gemini API key, shared with the chat sidebar
    if (!key) throw new Error(t('gemNoKey'))
    if (!prompt.trim()) throw new Error(t('orchNoInput'))
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }) })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message ?? r.statusText)
    const parts = (j.candidates?.[0]?.content?.parts ?? []) as { text?: string; inlineData?: { mimeType: string; data: string } }[]
    const im = parts.find((p) => p.inlineData)?.inlineData
    const text = parts.map((p) => p.text ?? '').join('').trim()
    if (!im) throw new Error(text || 'No image returned')
    const u = j.usageMetadata ?? {}
    return { text: text || '🖼', img: `data:${im.mimeType};base64,${im.data}`, input: u.promptTokenCount ?? 0, cached: 0, output: u.candidatesTokenCount ?? 0, cost: 0 }
  }

  // A message from you to one agent (the lead or any block): it answers with its own context plus its share of the saved dialogue.
  const ask = async (id: string, text: string) => {
    const n = o.nodes.find((x) => x.id === id)
    if (!n || running) return
    if (n.kind === 'start') return run(text) // the lead never just answers: it briefs everyone again
    setRunning(true)
    addLog({ from: t('orchUser'), to: who(n), toId: id, text, kind: 'user' })
    patch(id, { state: 'run' })
    try {
      const rules = o.edges.filter((e) => e[1] === id).map((e) => o.nodes.find((x) => x.id === e[0])!).filter((f) => f.kind === 'rules').map((f) => f.text).join('\n')
      const embedded = embed(n.notes)
      const own = history(id)
      // A resumed session already has its rules, notes and dialogue: send only the new message.
      const build = (resumed: boolean) => resumed ? text : [rules && `# Rules\n${rules}`, n.text && `# Context\n${n.text}`, embedded && `# Notes\n${embedded}`, own && `# Conversation so far\n${own.slice(-20000)}`, `# User message\n${text}`]
        .filter(Boolean).join('\n\n')
      const { text: out, img, ...use } = await exec(n, build, { keep: true })
      patch(id, { state: 'ok', out, img, use, sum: undefined }); addLog({ from: who(n), fromId: id, to: t('orchUser'), text: out, kind: 'reply', img })
      addLog({ from: '', to: '', text: '', kind: 'usage', rows: [{ who: who(n), use }] })
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      patch(id, { state: 'err', out: msg }); addLog({ from: who(n), fromId: id, to: '', text: msg, kind: 'error' })
    } finally { setRunning(false) }
  }

  const spent = o.nodes.reduce((a, n) => (n.use && !n.use.same ? { n: a.n + 1, input: a.input + n.use.input, cached: a.cached + n.use.cached, output: a.output + n.use.output, cost: a.cost + n.use.cost } : a), { n: 0, input: 0, cached: 0, output: 0, cost: 0 })
  const pos = (id: string, side: 'in' | 'out') => { const n = o.nodes.find((x) => x.id === id)!; return [n.x + (side === 'out' ? W : 0), n.y + HEAD] }
  const dot = 'absolute top-[14px] w-3 h-3 rounded-full border-2 border-accent bg-surface'

  return (
    <div className="h-full flex">
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-line">
        <select value={o.id} onChange={(e) => setAid(e.target.value)} className={`${field} w-40`}>{orchs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button title={t('orchNew')} onClick={() => { const c = fresh(orchs.length + 1); setOrchs([...orchs, c]); setAid(c.id) }} className="btn-press p-1.5 rounded-lg text-dim hover:text-fg hover:bg-panel"><Plus size={15} /></button>
        <button title={t('delete')} disabled={orchs.length < 2} onClick={() => { const rest = orchs.filter((x) => x !== o); setOrchs(rest); setAid(rest[0].id) }} className="btn-press p-1.5 rounded-lg text-dim hover:text-status-err disabled:opacity-30"><Trash2 size={15} /></button>
        <input value={o.name} onChange={(e) => upd((c) => ({ ...c, name: e.target.value }))} placeholder={t('orchName')} className={`${field} w-44`} />
        {spent.n > 0 && <span title={t('orchUseTip')} className="text-micro text-dim tabular-nums shrink-0">↑{k(spent.input)} ⟳{k(spent.cached)} ↓{k(spent.output)}{spent.cost > 0 && ` · $${spent.cost.toFixed(2)}`}</span>}
      </div>
      <div ref={canvas} onPointerDown={pan} onContextMenu={canvasMenu} className="flex-1 min-h-0 overflow-auto relative cursor-grab">
        <div className="relative" style={{ width: 3000, height: 2000 }}>
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {o.edges.map(([a, b]) => {
              const [x1, y1] = pos(a, 'out'), [x2, y2] = pos(b, 'in'), dx = Math.max(50, Math.abs(x2 - x1) / 2)
              const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
              return <g key={a + b}><path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" opacity=".9" />
                <path d={d} fill="none" stroke="transparent" strokeWidth="12" className="pointer-events-auto cursor-pointer" onClick={() => upd((c) => ({ ...c, edges: c.edges.filter((e) => !(e[0] === a && e[1] === b)) }))}><title>{t('orchUnlink')}</title></path></g>
            })}
            {wire && (() => { const [x1, y1] = pos(wire.from, 'out'); return <path d={`M${x1} ${y1} L${wire.x} ${wire.y}`} stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" fill="none" /> })()}
          </svg>
          <p className="absolute left-[340px] top-12 text-dim pointer-events-none">{t('orchEmpty')}</p>
          {o.nodes.map((n) => (
            <div key={n.id} data-node={n.id} onContextMenu={(e) => n.kind === 'start' ? e.stopPropagation() : onMenu(e, [{ label: t('delete'), danger: true, onClick: () => remove(n.id) }])}
              style={{ left: n.x, top: n.y, width: W }} className={`absolute rounded-2xl bg-surface border shadow-float flex flex-col ${n.state === 'err' ? 'border-status-err' : n.state === 'run' ? 'border-accent animate-pulse' : 'border-line'}`}>
              <div onPointerDown={(e) => drag(n, e)} className="flex items-center gap-1.5 pl-5 pr-3 h-11 cursor-grab active:cursor-grabbing select-none border-b border-line">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${n.kind === 'rules' ? 'bg-mut' : (n.agent ?? 'claude') === 'claude' ? 'bg-accent' : n.agent === 'agy' ? 'bg-status-ok' : 'bg-fg'}`} />
                {n.kind === 'rules' ? <span className="text-xs truncate">{label(n)}</span>
                  : <>
                    {n.kind === 'start' ? <span className="text-micro text-accent shrink-0">{t('blockStart')}</span> : <span className="text-micro text-accent shrink-0">{String.fromCharCode(65 + o.nodes.filter((x) => x.kind === 'model').findIndex((x) => x.id === n.id))}</span>}
                    <input value={n.name ?? ''} onChange={(e) => patch(n.id, { name: e.target.value })} placeholder={t('orchNamePh')} spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-dim placeholder:font-normal" />
                  </>}
                {n.kind !== 'start' && <button title={t('delete')} onClick={() => remove(n.id)} className="p-1 rounded text-dim hover:text-status-err ml-auto"><X size={12} /></button>}
              </div>
              {n.kind !== 'rules' && <div className="flex items-center gap-1.5 px-5 py-1.5 border-b border-line min-w-0">
                  <select value={`${n.agent ?? 'claude'}:${n.model ?? MODELS.claude[0][0]}`} onChange={(e) => { if (e.target.value.startsWith('preset:')) return patch(n.id, { ...resolve(PRESETS[+e.target.value.slice(7)]), role: PRESETS[+e.target.value.slice(7)][lang] }); const [agent, model] = e.target.value.split(':') as [Agent, string]; patch(n.id, { agent, model, role: undefined, ...(agent !== 'claude' && { effort: undefined }) }) }}
                    className="min-w-0 bg-transparent text-micro outline-none text-mut">
                    <optgroup label={`★ ${lang === 'ru' ? 'Рекомендуемые' : 'Recommended'}`}>{PRESETS.map((p, i) => <option key={i} value={`preset:${i}`} className="bg-panel">{presetLabel(p)}</option>)}</optgroup>
                    {(['claude', 'agy', 'codex', 'deepseek', 'nano'] as const).map((a) => <optgroup key={a} label={NAMES[a]}>
                      {models(a).map(([v, l]) => <option key={v} value={`${a}:${v}`} disabled={a === 'codex'} className="bg-panel">{a === 'codex' ? 'Codex — Coming soon' : l}</option>)}</optgroup>)}
                  </select>
                {n.role && <span className="text-micro text-accent truncate shrink-0 max-w-[45%]">· {n.role}</span>}
              </div>}
              {n.kind === 'model' && <span title={t('orchIn')} className={`${dot} -left-1.5 pointer-events-none`} />}
              <button title={t('orchOut')} onPointerDown={(e) => startWire(n.id, e)} className={`${dot} -right-1.5 cursor-crosshair`} />
              <div className="p-3 flex flex-col gap-2">
                <textarea value={n.text} onChange={(e) => patch(n.id, { text: e.target.value })} rows={3} spellCheck={false}
                  placeholder={n.kind === 'rules' ? t('orchRulesPh') : n.kind === 'start' ? t('orchStartPh') : t('orchCtxPh')} className={`${field} resize-none`} />
                {n.kind !== 'rules' && (n.agent ?? 'claude') === 'claude' && <select value={n.effort ?? (n.kind === 'start' ? 'low' : '')} onChange={(e) => patch(n.id, { effort: e.target.value || undefined })} title={t('orchEffort')} className={field}>
                  {n.kind !== 'start' && <option value="">{t('orchEffort')}: auto</option>}{EFFORTS.map((x) => <option key={x} value={x}>{t('orchEffort')}: {x}</option>)}</select>}
                {n.kind === 'start' && <span className="text-micro text-dim">{t('orchMapCtx', { n: notes.length, k: mapTok })}</span>}
                {n.use && <span title={t('orchUseTip')} className="text-micro text-dim tabular-nums">{n.use.same ? t('orchSame') : `↑${k(n.use.input)} ⟳${k(n.use.cached)} ↓${k(n.use.output)}${n.use.cost > 0 ? ` · $${n.use.cost.toFixed(3)}` : ''}`}</span>}
                {n.kind === 'start' && n.out && <pre className={`max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-field ${n.state === 'err' ? 'text-status-err' : 'text-mut'}`}>{n.out}</pre>}
                {n.kind === 'model' && <>
                  {n.notes.length > 0 && <div className="flex flex-wrap gap-1">{n.notes.map((x) => (
                    <button key={x} title={t('delete')} onClick={() => patch(n.id, { notes: n.notes.filter((k) => k !== x) })} className="px-2 py-0.5 rounded-full bg-accent-dim text-accent text-micro">@{x} ×</button>))}</div>}
                  <select value="" onChange={(e) => e.target.value && patch(n.id, { notes: [...n.notes, e.target.value] })} className={field}>
                    <option value="">{t('orchEmbed')}</option>
                    {notes.filter((x) => !n.notes.includes(x.name)).map((x) => <option key={x.name} value={x.name}>@{x.name}</option>)}
                  </select>
                  {n.img && <a href={n.img} download="nano-banana.png" title="Save"><img src={n.img} className="rounded-lg w-full" /></a>}
                  {n.out && <pre className={`max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-field ${n.state === 'err' ? 'text-status-err' : 'text-mut'}`}>{n.out}</pre>}
                </>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    <Dialogue log={log} busy={running} onStop={() => { stopped.current = true; stopAgents().catch(console.error) }} queue={!!o.queue} onQueue={() => upd((c) => ({ ...c, queue: !c.queue }))} onSend={ask} onClear={() => upd((c) => ({ ...c, log: [], nodes: c.nodes.map((n) => ({ ...n, sid: undefined, mapSum: undefined, sum: undefined })) }))}
      agents={o.nodes.filter((n) => n.kind !== 'rules').map((n) => ({ id: n.id, name: who(n), role: n.role ?? (n.kind === 'model' ? n.text.split(/\r?\n/)[0].slice(0, 60) : undefined), state: n.state, task: [...log].reverse().find((e) => e.kind === 'task' && e.toId === n.id)?.text }))} />
    </div>
  )
}

const DOT = { run: 'bg-accent animate-pulse', ok: 'bg-status-ok', err: 'bg-status-err' } as const
const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Replaces the chat sidebar on this tab: who is doing what, the saved dialogue between agents, and a box to write to any of them. */
function Dialogue({ log, agents, busy, onStop, queue, onQueue, onSend, onClear }: {
  log: Entry[]; busy: boolean; onStop: () => void; queue: boolean; onQueue: () => void; onSend: (id: string, text: string) => void; onClear: () => void
  agents: { id: string; name: string; role?: string; state?: Node['state']; task?: string }[]
}) {
  const { t } = useI18n()
  const end = useRef<HTMLDivElement>(null)
  const [to, setTo] = useState('') // '' = the lead, which is always first
  const [text, setText] = useState('')
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [log.length, agents.filter((a) => a.state === 'run').length])
  const target = agents.some((a) => a.id === to) ? to : agents[0]?.id
  const send = () => { const m = text.trim(); if (m && !busy && target) { onSend(target, m); setText('') } }
  const done = agents.filter((a) => a.state === 'ok').length
  return (
    <aside className="anim-slide w-[26rem] shrink-0 border-l border-line bg-surface flex flex-col text-sm">
      <div className="flex items-center px-5 h-14 border-b border-line">
        <span className="font-serif text-lg font-semibold">{t('orchLog')}</span>
        <span className="ml-auto mr-2 text-micro text-dim tabular-nums">{done}/{agents.length}</span>
        <button title={t('openFolder')} onClick={() => openRoot().catch(console.error)} className="btn-press p-1.5 rounded-lg text-dim hover:text-fg"><FolderOpen size={15} /></button>
        <button title={t('orchClear')} onClick={onClear} disabled={!log.length} className="btn-press p-1.5 rounded-lg text-dim hover:text-status-err disabled:opacity-30"><Trash2 size={15} /></button>
      </div>
      <div className="h-0.5 bg-field"><div className="h-full bg-accent transition-all" style={{ width: `${(done / Math.max(1, agents.length)) * 100}%`, transitionDuration: '.5s' }} /></div>
      <ul className="px-5 py-3 flex flex-col gap-2.5 border-b border-line max-h-[30%] overflow-auto">
        {agents.map((a) => (
          <li key={a.id} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-xs"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.state ? DOT[a.state] : 'bg-dim'}`} /><span className="truncate">{a.name}</span></span>
            {a.task && <span className="pl-3.5 text-micro text-dim max-h-8 overflow-hidden">{a.task}</span>}
          </li>
        ))}
      </ul>
      <div className="flex-1 overflow-auto px-5 pt-4 pb-3 flex flex-col gap-5">
        {log.length === 0 && <p className="m-auto text-center text-dim max-w-[17rem] leading-relaxed">{t('orchLogEmpty')}</p>}
        {log.filter((e) => !e.quiet).map((e, i) => e.kind === 'usage' ? <UsageTable key={i} rows={e.rows ?? []} />
          : e.kind === 'run'
          ? <div key={i} className="flex items-center gap-2 text-micro text-dim"><span className="flex-1 h-px bg-line" />▶ {hm(e.at)}<span className="flex-1 h-px bg-line" /></div>
          : e.kind === 'user'
            ? <div key={i} className="anim-rise self-end max-w-[85%] flex flex-col items-end gap-1">
              <p className="whitespace-pre-wrap px-4 py-2.5 rounded-2xl rounded-br-md bg-panel border border-line">{e.text}</p>
              <span className="text-micro text-dim">{e.from} → {e.to} · {hm(e.at)}</span>
            </div>
            : <div key={i} className="anim-rise flex flex-col gap-1.5">
              <span className="text-micro text-accent">{e.from}{e.to && ` → ${e.to}`} <span className="text-dim">· {hm(e.at)}</span></span>
              {e.kind === 'error' ? <p className="text-status-err whitespace-pre-wrap">{e.text}</p>
                : e.kind === 'task' ? <p className="max-h-40 overflow-auto whitespace-pre-wrap px-3 py-2 rounded-xl bg-panel border border-line text-xs text-mut">{e.text}</p>
                  : <><Markdown text={e.text} />{e.img && <img src={e.img} className="rounded-xl border border-line" />}</>}
            </div>)}
        {agents.filter((a) => a.state === 'run').map((a) => (
          <div key={a.id} className="anim-fade flex items-center gap-2 text-micro text-dim">
            <span className="flex gap-0.5">{[0, 1, 2].map((d) => <span key={d} className="w-1 h-1 rounded-full bg-accent animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />)}</span>
            <span className="truncate">{a.name}{a.role && ` · ${a.role}`} — {t('orchThinking')}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="px-4 pt-3 pb-3 flex flex-col gap-2">
        <button title={t(queue ? 'orchQueueTip' : 'orchParTip')} onClick={onQueue} className="btn-press self-start px-3 py-1 rounded-full border border-line text-xs text-dim hover:text-fg">{t(queue ? 'orchQueue' : 'orchPar')}</button>
        <select value={target} onChange={(e) => setTo(e.target.value)} title={t('orchTo')}
          className="px-3 py-1.5 rounded-lg bg-field border border-line focus:border-accent outline-none text-xs">
          {agents.map((a) => <option key={a.id} value={a.id}>{t('orchTo')}: {a.name}</option>)}
        </select>
        <div className="flex items-end gap-2 pl-4 pr-2 py-2 rounded-2xl bg-field border border-line focus-within:border-accent focus-within:shadow-float">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} spellCheck={false} placeholder={t('orchMsgPh')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            className="flex-1 min-w-0 py-1 bg-transparent outline-none resize-none text-sm placeholder:text-dim max-h-40" />
          {busy
            ? <button onClick={onStop} title={t('orchStop')} className="btn-press p-2 rounded-full bg-accent text-bg hover:opacity-90"><Square size={15} fill="currentColor" /></button>
            : <button onClick={send} disabled={!text.trim()} title={t('send')} className="btn-press p-2 rounded-full bg-accent text-bg hover:opacity-90 disabled:opacity-25"><ArrowUp size={15} /></button>}
        </div>
      </div>
    </aside>
  )
}

/** Who spent what in one run (or one answer): new input, read from cache, output, and cost where the CLI reports it. */
function UsageTable({ rows }: { rows: Row[] }) {
  const { t } = useI18n()
  const total = rows.reduce((a, r) => ({ input: a.input + r.use.input, cached: a.cached + r.use.cached, output: a.output + r.use.output, cost: a.cost + r.use.cost }), { input: 0, cached: 0, output: 0, cost: 0 })
  const paid = total.cost > 0
  const cells = (u: Omit<Use, 'same'>) => <><td className="px-2 py-1 text-right">{k(u.input)}</td><td className="px-2 py-1 text-right">{k(u.cached)}</td><td className="px-2 py-1 text-right">{k(u.output)}</td>{paid && <td className="px-2 py-1 text-right">${u.cost.toFixed(3)}</td>}</>
  return (
    <div className="anim-rise flex flex-col gap-1.5">
      <span className="text-micro text-accent">{t('orchUsage')}</span>
      <table title={t('orchUseTip')} className="w-full text-micro tabular-nums border border-line rounded-xl overflow-hidden">
        <thead className="bg-panel text-dim"><tr><th className="px-2 py-1 text-left font-normal">{t('orchWho')}</th><th className="px-2 py-1 text-right font-normal">↑</th><th className="px-2 py-1 text-right font-normal">⟳</th><th className="px-2 py-1 text-right font-normal">↓</th>{paid && <th className="px-2 py-1 text-right font-normal">$</th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t border-line text-mut"><td className="px-2 py-1 truncate max-w-[10rem]">{r.who}</td>
            {r.use.same ? <td colSpan={paid ? 4 : 3} className="px-2 py-1 text-right text-dim">{t('orchSame')}</td> : cells(r.use)}</tr>)}
          {rows.length > 1 && <tr className="border-t border-line text-fg font-medium"><td className="px-2 py-1">{t('orchTotal')}</td>{cells(total)}</tr>}
        </tbody>
      </table>
    </div>
  )
}
