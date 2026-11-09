import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, BookmarkPlus, FolderOpen, GitBranch, History, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { agyModels, inTauri, openRoot, runAgent, stopAgents, worktreeApply, worktreeCreate, worktreeDiff, worktreeDiscard, worktreeStamp, type Answer } from '../vault'
import Markdown from './Markdown'
import StoredImg from './StoredImg'
import { MODELS } from './AgentSidebar'
import { graphMap, tokens, type Note } from '../deso'
import type { MenuItem } from './ContextMenu'
import { getKey } from '../keys'
import { dsChat } from '../deepseek'
import { dsUsage } from '../dsprice'
import { nanoImage } from '../nano'
import { getImg, imgId, putImg } from '../imgs'
import { BRIEF, BUDGET, clip, fromTemplate, leadChat, LOG_MAX, NOTE_MAX, READ_ONLY, runOrchestra, save, workerEffort, MAX_TURNS, type Agent, type Deps, type Entry, type Node, type Opts, type Orch, type Reply, type Row, type Template, type Use } from '../orchestra'

const DEEPSEEK = MODELS.deepseek
const EFFORTS = ['low', 'medium', 'high', 'max'] as const
const NANO = MODELS.nano
const CODEX = [['', 'Codex (default model)']] as const // model comes from the user's Codex config
const NAMES = { claude: 'Claude', agy: 'Antigravity', codex: 'Codex', deepseek: 'DeepSeek', nano: 'Nano Banana' } as const
// Recommended model per role, shown first in every model picker. agy takes its effort from the model name (...-low / ...-high).
// think = Claude effort the block gets from this preset; tools = the only tools it may use (read-only for search).
type Preset = { ru: string; en: string; agent: Agent; model?: string; effort?: string; think?: string; tools?: string }
const PRESETS: readonly Preset[] = [
  { ru: 'Ведущий', en: 'Lead', agent: 'agy', effort: 'low' },
  { ru: 'Планирование задач', en: 'Task planning', agent: 'agy', effort: 'high' },
  { ru: 'Кодинг', en: 'Coding', agent: 'claude', model: 'claude-sonnet-5-5', think: 'medium' },
  { ru: 'Кодинг (сложный)', en: 'Hard coding', agent: 'claude', model: 'claude-opus-5-5', think: 'high' },
  { ru: 'Поиск по карте и файлам', en: 'Search map & files', agent: 'claude', model: 'claude-haiku-5-5', tools: READ_ONLY },
  { ru: 'Поиск по карте и файлам', en: 'Search map & files', agent: 'deepseek', model: 'deepseek-v4-flash' },
  { ru: 'Картинки', en: 'Images', agent: 'nano', model: NANO[0][0] },
]
// Roles, picked with the + next to the model: the text fills the block's context (editable), review/tools are set with it.
// A reviewer sends its work back to the blocks feeding it, up to `review` times, until it answers OK.
type Role = { ru: string; en: string; ruText: string; enText: string; review?: number; tools?: string }
const ROLES: readonly Role[] = [
  { ru: 'Кодер', en: 'Coder', ruText: 'Ты кодер. Решай задачу, а не изображай работу. Меняй только нужные файлы, минимальный diff, проверь, что код запускается. Отвечай коротко.',
    enText: 'You are the coder. Solve the task, do not pretend. Touch only the files you need, keep the diff minimal, check the code runs. Answer briefly.' },
  { ru: 'Ревьюер', en: 'Reviewer', review: 2, tools: READ_ONLY, ruText: 'Ты ревьюер. Проверь результат предыдущего агента по задаче: баги, пропущенные случаи, сломанные вызовы. Сам код не переписывай.',
    enText: 'You are the reviewer. Check the previous agent\'s result against the task: bugs, missed cases, broken callers. Do not rewrite the code yourself.' },
  { ru: 'Исследователь', en: 'Researcher', tools: READ_ONLY, ruText: 'Ты исследователь. Найди в карте и файлах то, что нужно для задачи, ничего не меняй. В ответе только факты: пути, имена, строки.',
    enText: 'You are the researcher. Find what the task needs in the map and files, change nothing. Answer with facts only: paths, names, lines.' },
  { ru: 'Планировщик', en: 'Planner', tools: READ_ONLY, ruText: 'Ты планировщик. Разбей задачу на короткие шаги по файлам, без кода. Укажи порядок и риски.',
    enText: 'You are the planner. Split the task into short steps by file, no code. Give the order and the risks.' },
  { ru: 'Тестировщик', en: 'Tester', ruText: 'Ты тестировщик. Запусти тесты и сборку; при падении назови причину и файл. Код не чини.',
    enText: 'You are the tester. Run the tests and the build; on a failure name the cause and the file. Do not fix the code.' },
]
// Ready-made orchestras (the blocks are filled from the roles above) and your own, saved from the current one.
const builtin = (lang: 'ru' | 'en'): Template[] => {
  const S = MODELS.claude[0][0], H = 'claude-haiku-5-5'
  const [coder, reviewer, researcher, , tester] = ROLES
  const lead: Node = { id: 'l', x: 40, y: 40, kind: 'start', agent: 'claude', model: S, text: '', notes: [] }
  const role = (id: string, x: number, r: Role, model: string): Node => ({ id, x, y: 40, kind: 'model', agent: 'claude', model, role: r[lang], text: r[lang === 'ru' ? 'ruText' : 'enText'], notes: [], review: r.review, tools: r.tools })
  return [
    { name: lang === 'ru' ? 'Код + ревью' : 'Code + review', nodes: [lead, role('a', 360, researcher, H), role('b', 680, coder, S), role('c', 1000, reviewer, S)], edges: [['l', 'a'], ['a', 'b'], ['b', 'c']] },
    { name: lang === 'ru' ? 'Код + тесты + ревью' : 'Code + tests + review', nodes: [lead, role('b', 360, coder, S), role('t', 680, tester, S), role('c', 1000, reviewer, S)], edges: [['l', 'b'], ['b', 't'], ['t', 'c']] },
  ]
}
const TPL = 'desovault.orchestra.templates' // global: shared by every project
const loadTpl = (): Template[] => { try { return JSON.parse(localStorage.getItem(TPL) ?? '[]') } catch { return [] } }
const RUNS_KEPT = 5
const SLOW = 120 // seconds a block may run before its timer turns to a warning
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

const W = 272, HEAD = 20 // node width; y of the link handles, measured from the node's top
const uid = () => Math.random().toString(36).slice(2, 9)
const fresh = (n: number): Orch => ({ id: uid(), name: `Orchestra ${n}`, task: '', nodes: [], edges: [], iso: inTauri })
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
  const [showRuns, setShowRuns] = useState(false)
  const [saved, setSaved] = useState<Template[]>(loadTpl)
  const stopped = useRef(false) // Stop was pressed: blocks not started yet stay idle
  const [agy, setAgy] = useState<readonly (readonly [string, string])[]>(MODELS.agy)
  const canvas = useRef<HTMLDivElement>(null)
  const saveWarned = useRef(false) // warn about a failed save once, not on every render
  useEffect(() => {
    const r = save(KEY, orchs)
    if (r === 'failed' && !saveWarned.current) { saveWarned.current = true; addLog({ from: '', to: '', kind: 'error', text: t('orchSaveFail') }) }
    if (r !== 'failed') saveWarned.current = false
  }, [orchs, KEY])
  useEffect(() => { if (inTauri) agyModels().then((l) => l.length && setAgy(l)).catch(console.error) }, [])

  const o = orchs.find((x) => x.id === aid) ?? orchs[0]
  // Every orchestra always has its start block: the lead agent. It has a single (output) handle and cannot be deleted. Its context is always the project map.
  useEffect(() => { if (!o.nodes.some((n) => n.kind === 'start')) setOrchs((os) => os.map((x) => (x.id !== o.id || x.nodes.some((n) => n.kind === 'start') ? x : { ...x, nodes: [{ id: uid(), x: 40, y: 40, kind: 'start', agent: 'claude', model: MODELS.claude[0][0], text: '', notes: [] }, ...x.nodes] }))) }, [o.id, o.nodes])
  const upd = (f: (o: Orch) => Orch) => setOrchs((os) => os.map((x) => (x.id === o.id ? f(x) : x)))
  const log = o.log ?? []
  const addLog = (e: Omit<Entry, 'at'>) => {
    if (e.img) { e = { ...e, imgId: imgId() }; putImg(e.imgId!, e.img!) } // the picture goes to the image store, the log keeps its id
    upd((c) => ({ ...c, log: [...(c.log ?? []), { ...e, at: Date.now() }].slice(-LOG_MAX) }))
  }
  const newFromTemplate = (v: string) => {
    const tpl = (v[0] === 'b' ? builtin(lang) : saved)[+v.slice(1)]
    if (!tpl) return
    const c: Orch = { ...fresh(orchs.length + 1), name: tpl.name, ...fromTemplate(tpl, uid) }
    setOrchs([...orchs, c]); setAid(c.id)
  }
  const saveTemplate = () => {
    const tpl: Template = { name: o.name, edges: o.edges, cond: o.cond, nodes: o.nodes.map(({ out, img, state, use, sid, sum, final, finalSum, mapSum, since, ...n }) => n) }
    const next = [...saved.filter((x) => x.name !== o.name), tpl]
    setSaved(next)
    try { localStorage.setItem(TPL, JSON.stringify(next)) } catch (e) { console.error(e) }
  }
  const applyRole = (n: Node, r: Role | null) => {
    if (!r) return patch(n.id, { role: undefined, review: undefined, tools: undefined })
    const old = ROLES.flatMap((x) => [x.ruText, x.enText]).reduce((s, x) => s.replace(x, ''), n.text).trim() // swapping roles drops the previous role's text, keeps yours
    const text = r[lang === 'ru' ? 'ruText' : 'enText']
    patch(n.id, { role: r[lang], review: r.review, tools: r.tools, text: old ? `${text}\n\n${old}` : text })
  }
  const patch = (id: string, p: Partial<Node>) => upd((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }))
  const map = useMemo(() => graphMap(notes), [notes])
  const mapTok = useMemo(() => tokens(map), [map])
  const models = (a: Agent): readonly (readonly [string, string])[] => (a === 'claude' ? MODELS.claude : a === 'deepseek' ? DEEPSEEK : a === 'codex' ? CODEX : a === 'nano' ? NANO : agy)
  // An embedded note in full, or, if large, a pointer the agent reads itself (agents run in the project folder with file tools).
  const embed = (names: string[]) => names.map((x) => { const c = notes.find((k) => k.name === x)?.content ?? ''
    return `## @${x}\n${c.length > NOTE_MAX ? `(large note, ~${tokens(c)} tok: read the file \`${x}.deso\` in the project folder or its \`.desovault\` folder)` : c}` }).join('\n\n')
  const resolve = (p: (typeof PRESETS)[number]): Partial<Node> => {
    if (p.agent !== 'agy') return { agent: p.agent, model: p.model, effort: p.think, tools: p.tools }
    const f = agy.filter(([m]) => m.includes('3.8') && m.includes('flash'))
    return { agent: 'agy', model: (f.find(([m]) => m.endsWith(`-${p.effort}`)) ?? f[0] ?? agy[0])[0], effort: undefined, tools: undefined }
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

  // Isolated: every agent works in the orchestra's git worktree. A failure stops the run: never fall back to the real project.
  const isolate = async () => {
    if (!o.iso || !inTauri) return true
    try { await worktreeCreate(o.id); if (!o.wt) upd((c) => ({ ...c, wt: true })); return true }
    catch (e) { addLog({ from: 'git', to: '', text: `${t('orchIsoFail')}
${String(e)}`, kind: 'error' }); return false }
  }
  const review = async (what: 'diff' | 'apply' | 'discard') => {
    try {
      if (what === 'diff') { const d = await worktreeDiff(o.id); addLog({ from: 'git', to: '', kind: 'reply', text: d.trim() ? `\`\`\`diff
${clip(d)}
\`\`\`` : t('orchNoChanges') }); return }
      if (what === 'discard' && !window.confirm(t('orchDiscardAsk'))) return
      const changed = what === 'apply' ? await worktreeApply(o.id) : (await worktreeDiscard(o.id), false)
      upd((c) => ({ ...c, wt: false, nodes: c.nodes.map((n) => ({ ...n, sid: undefined, sum: undefined })) })) // sessions and cached answers belonged to the worktree
      addLog({ from: 'git', to: '', kind: 'reply', text: what === 'apply' ? t(changed ? 'orchApplied' : 'orchNoChanges') : t('orchDiscarded') })
    } catch (e) { addLog({ from: 'git', to: '', text: String(e), kind: 'error' }) }
  }

  // What the engine needs from the screen: the same calls the old inline run() made.
  const deps = (): Deps => ({
    exec, patch, addLog, history, embed, label, who, t,
    stamp: () => (inTauri ? worktreeStamp(o.iso ? o.id : undefined) : Promise.resolve('')),
    stopped: () => stopped.current,
    leadMap: (query) => graphMap(notes, undefined, query),
  })
  // `msg` = something you wrote to the lead: the lead takes it as a new instruction and briefs every agent again.
  // force (Shift+click on Run): rerun every block, even one whose input has not changed.
  // only = a block id: that block and what follows it run again, the rest comes from the cache.
  const run = async (msg?: string, force = false, only?: string) => {
    if (running || !(await isolate())) return
    stopped.current = false
    setRunning(true)
    try {
      const info = await runOrchestra(o, deps(), { msg, force, only })
      if (info) upd((c) => ({ ...c, runs: [...(c.runs ?? []), { at: Date.now(), ...info }].slice(-RUNS_KEPT) }))
    } finally { setRunning(false) }
  }

  // The saved dialogue as one agent saw it: what it was asked and what it answered.
  const history = (id: string) => log.filter((e) => (e.toId === id || e.fromId === id) && e.kind !== 'error').slice(-12)
    .map((e) => `${e.kind === 'reply' ? 'Assistant' : 'User'}: ${e.text}`).join('\n\n')

  // keep: continue the block's claude session (--resume) instead of resending the dialogue. agy gets the full prompt every time:
  // its --conversation resume was ~8x slower than a fresh call when tried.
  const exec = async (n: Node, build: (resumed: boolean) => string, { keep, tools, effort = '', maxTurns }: Opts = {}): Promise<Reply> => {
    if (n.agent === 'nano') return nano(n.model ?? NANO[0][0], build(false))
    if (n.agent === 'deepseek') return deepseek(n.model ?? DEEPSEEK[0][0], build(false))
    if (!inTauri) throw new Error(t('desktopOnly'))
    const cli = n.agent === 'agy' || n.agent === 'codex' ? n.agent : 'claude'
    const go = async (resumed: boolean, session?: string) => {
      const prompt = build(resumed)
      if (!prompt.trim()) throw new Error(t('orchNoInput'))
      const a = await runAgent(cli, prompt, n.model ?? MODELS.claude[0][0], cli !== 'claude' ? '' : effort, { session, resume: resumed, tools, system: BRIEF, budget: BUDGET, maxTurns, worktree: o.iso ? o.id : undefined })
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
    return { text: String(j.choices?.[0]?.message?.content ?? '').trim(), ...dsUsage(model, j.usage) }
  }

  // Nano Banana (Gemini image models): the answer is text plus an inline image, shown in the block and the dialogue.
  const nano = async (model: string, prompt: string): Promise<Answer & { img?: string }> => {
    const key = getKey('agy') // the Gemini API key, shared with the chat sidebar
    if (!key) throw new Error(t('gemNoKey'))
    if (!prompt.trim()) throw new Error(t('orchNoInput'))
    const { text, img, input, output } = await nanoImage(key, model, [{ role: 'user', text: prompt }])
    return { text, img, input, cached: 0, output, cost: 0 }
  }

  // A message from you to one agent (the lead or any block): it answers with its own context plus its share of the saved dialogue.
  const ask = async (id: string, text: string) => {
    const n = o.nodes.find((x) => x.id === id)
    if (!n || running) return
    if (n.kind === 'start' && !o.leadChat) return run(text) // by default the lead never just answers: it briefs everyone again
    if (n.kind === 'start') { // "just answer": no tools, so no worktree is needed either
      stopped.current = false; setRunning(true)
      try { await leadChat(o, deps(), text) } finally { setRunning(false) }
      return
    }
    if (!(await isolate())) return
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
      const { text: out, img, ...use } = await exec(n, build, { keep: true, effort: workerEffort(n), tools: n.tools, maxTurns: MAX_TURNS })
      patch(id, { state: 'ok', out, img, use, sum: undefined }); addLog({ from: who(n), fromId: id, to: t('orchUser'), text: out, kind: 'reply', img })
      addLog({ from: '', to: '', text: '', kind: 'usage', rows: [{ who: who(n), use }] })
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      patch(id, { state: 'err', out: msg }); addLog({ from: who(n), fromId: id, to: '', text: msg, kind: 'error' })
    } finally { setRunning(false) }
  }

  const spent = o.nodes.reduce((a, n) => (n.use && !n.use.same ? { n: a.n + 1, input: a.input + n.use.input, cached: a.cached + n.use.cached, output: a.output + n.use.output, cost: a.cost + n.use.cost } : a), { n: 0, input: 0, cached: 0, output: 0, cost: 0 })
  // Input tokens only: the task, each block's context and notes, and the project map for the lead. The answers come on top.
  const est = o.nodes.reduce((a, n) => n.kind === 'rules' ? a : a + tokens(`${o.task} ${n.text}`) + (n.kind === 'start' ? mapTok : n.notes.reduce((s, x) => { const c = notes.find((q) => q.name === x)?.content ?? ''; return s + (c.length > NOTE_MAX ? 50 : tokens(c)) }, 0)), 0)
  const pos = (id: string, side: 'in' | 'out') => { const n = o.nodes.find((x) => x.id === id)!; return [n.x + (side === 'out' ? W : 0), n.y + HEAD] }
  const dot = 'absolute top-[14px] w-3 h-3 rounded-full border-2 border-accent bg-surface'

  return (
    <div className="h-full flex">
    <div className="flex-1 min-w-0 flex flex-col relative">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-line">
        <select value={o.id} onChange={(e) => setAid(e.target.value)} className={`${field} w-40`}>{orchs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button title={t('orchNew')} onClick={() => { const c = fresh(orchs.length + 1); setOrchs([...orchs, c]); setAid(c.id) }} className="btn-press p-1.5 rounded-lg text-dim hover:text-fg hover:bg-panel"><Plus size={15} /></button>
        <button title={t('delete')} disabled={orchs.length < 2} onClick={() => { const rest = orchs.filter((x) => x !== o); setOrchs(rest); setAid(rest[0].id) }} className="btn-press p-1.5 rounded-lg text-dim hover:text-status-err disabled:opacity-30"><Trash2 size={15} /></button>
        <input value={o.name} onChange={(e) => upd((c) => ({ ...c, name: e.target.value }))} placeholder={t('orchName')} className={`${field} w-44`} />
        <button title={t('orchIsoTip')} onClick={() => upd((c) => ({ ...c, iso: !c.iso }))} disabled={running || !inTauri} className={`btn-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${o.iso ? 'border-accent text-accent' : 'border-line text-dim'} disabled:opacity-40`}><GitBranch size={13} />{t('orchIso')}</button>
        <select value="" onChange={(e) => newFromTemplate(e.target.value)} title={t('orchTpl')} className={`${field} w-32`}>
          <option value="">{t('orchTpl')}</option>
          <optgroup label={t('orchTplBuiltin')}>{builtin(lang).map((x, i) => <option key={i} value={`b${i}`} className="bg-panel">{x.name}</option>)}</optgroup>
          {saved.length > 0 && <optgroup label={t('orchTplSaved')}>{saved.map((x, i) => <option key={i} value={`s${i}`} className="bg-panel">{x.name}</option>)}</optgroup>}
        </select>
        <button title={t('orchTplSave')} onClick={saveTemplate} className="btn-press p-1.5 rounded-lg text-dim hover:text-fg hover:bg-panel"><BookmarkPlus size={15} /></button>
        {o.iso && o.wt && !running && <>{(['diff', 'apply', 'discard'] as const).map((w) => <button key={w} onClick={() => review(w)} className={`btn-press px-2.5 py-1.5 rounded-lg text-xs border border-line ${w === 'discard' ? 'text-dim hover:text-status-err' : 'text-fg hover:border-accent'}`}>{t(w === 'diff' ? 'orchDiff' : w === 'apply' ? 'orchApply' : 'orchDiscard')}</button>)}</>}
        {!running && est > 0 && <span title={t('orchEstTip')} className="text-micro text-dim tabular-nums shrink-0">≈ ↑{k(est)}</span>}
        <button title={t('orchRuns')} onClick={() => setShowRuns((v) => !v)} className={`btn-press p-1.5 rounded-lg hover:text-fg hover:bg-panel ${showRuns ? 'text-fg bg-panel' : 'text-dim'}`}><History size={15} /></button>
        {spent.n > 0 && <span title={t('orchUseTip')} className="text-micro text-dim tabular-nums shrink-0">↑{k(spent.input)} ⟳{k(spent.cached)} ↓{k(spent.output)}{spent.cost > 0 && ` · $${spent.cost.toFixed(2)}`}</span>}
      </div>
      {showRuns && <div className="anim-fade absolute right-4 top-12 z-20 w-96 max-h-80 overflow-auto rounded-xl bg-surface border border-line shadow-float p-3 flex flex-col gap-2 text-xs">
        {(o.runs ?? []).length === 0 ? <p className="text-dim">{t('orchRunsEmpty')}</p> : [...(o.runs ?? [])].reverse().map((r) => (
          <details key={r.at}><summary className="cursor-pointer tabular-nums">{hm(r.at)} · {k(r.tokens)} tok{r.cost > 0 && ` · $${r.cost.toFixed(2)}`}{r.failed.length > 0 && <span className="text-status-err"> · ✕ {r.failed.join(', ')}</span>}</summary>
            {r.final && <pre className="mt-1 whitespace-pre-wrap text-micro text-mut">{r.final}</pre>}</details>))}
      </div>}
      <div ref={canvas} onPointerDown={pan} onContextMenu={canvasMenu} className="flex-1 min-h-0 overflow-auto relative cursor-grab">
        <div className="relative" style={{ width: 3000, height: 2000 }}>
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {o.edges.map(([a, b]) => {
              const [x1, y1] = pos(a, 'out'), [x2, y2] = pos(b, 'in'), dx = Math.max(50, Math.abs(x2 - x1) / 2)
              const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
              const ck = `${a}>${b}`, cond = o.cond?.[ck], next = { undefined: 'ok', ok: 'bad', bad: undefined }[String(cond) as 'undefined' | 'ok' | 'bad'] as 'ok' | 'bad' | undefined
              return <g key={a + b}><path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" opacity=".9" strokeDasharray={cond ? '6 4' : undefined} />
                {cond && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize="11" fill="var(--accent)" className="pointer-events-none">{t(cond === 'ok' ? 'orchEdgeOk' : 'orchEdgeBad')}</text>}
                <path d={d} fill="none" stroke="transparent" strokeWidth="12" className="pointer-events-auto cursor-pointer"
                  onClick={() => upd((c) => { const { [ck]: _, ...rest } = c.cond ?? {}; return { ...c, cond: next ? { ...rest, [ck]: next } : rest } })}
                  onContextMenu={(e) => onMenu(e, [{ label: t('orchUnlink'), danger: true, onClick: () => upd((c) => ({ ...c, edges: c.edges.filter((x) => !(x[0] === a && x[1] === b)) })) }])}><title>{t('orchEdgeTip')}</title></path></g>
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
                <button title={t('orchRerun')} disabled={running} onClick={() => run(undefined, false, n.id)} className={`p-1 rounded text-dim hover:text-accent disabled:opacity-30 ${n.kind === 'start' ? 'ml-auto' : ''}`}><RotateCcw size={12} /></button>
                {n.kind !== 'start' && <button title={t('delete')} onClick={() => remove(n.id)} className="p-1 rounded text-dim hover:text-status-err"><X size={12} /></button>}
              </div>
              {n.kind !== 'rules' && <div className="flex items-center gap-1.5 px-5 py-1.5 border-b border-line min-w-0">
                  <select value={`${n.agent ?? 'claude'}:${n.model ?? MODELS.claude[0][0]}`} onChange={(e) => { if (e.target.value.startsWith('preset:')) return patch(n.id, { ...resolve(PRESETS[+e.target.value.slice(7)]), role: PRESETS[+e.target.value.slice(7)][lang], review: undefined }); const [agent, model] = e.target.value.split(':') as [Agent, string]; patch(n.id, { agent, model, role: undefined, tools: undefined, review: undefined, ...(agent !== 'claude' && { effort: undefined }) }) }}
                    className="min-w-0 bg-transparent text-micro outline-none text-mut">
                    <optgroup label={`★ ${lang === 'ru' ? 'Рекомендуемые' : 'Recommended'}`}>{PRESETS.map((p, i) => <option key={i} value={`preset:${i}`} className="bg-panel">{presetLabel(p)}</option>)}</optgroup>
                    {(['claude', 'agy', 'codex', 'deepseek', 'nano'] as const).map((a) => <optgroup key={a} label={NAMES[a]}>
                      {models(a).map(([v, l]) => <option key={v} value={`${a}:${v}`} disabled={a === 'codex'} className="bg-panel">{a === 'codex' ? 'Codex — Coming soon' : l}</option>)}</optgroup>)}
                  </select>
                {n.role && <span className="text-micro text-accent truncate shrink-0 max-w-[45%]">· {n.role}{n.review ? ` ↻${n.review}` : ''}</span>}
                {n.kind === 'model' && <button title={t('orchRole')} onClick={(e) => onMenu(e, [
                  ...ROLES.map((r) => ({ label: r[lang], onClick: () => applyRole(n, r) })),
                  { label: t('orchNoRole'), sep: true, onClick: () => applyRole(n, null) }])} className="btn-press ml-auto p-0.5 rounded text-dim hover:text-accent shrink-0"><Plus size={13} /></button>}
              </div>}
              {n.kind === 'model' && <span title={t('orchIn')} className={`${dot} -left-1.5 pointer-events-none`} />}
              <button title={t('orchOut')} onPointerDown={(e) => startWire(n.id, e)} className={`${dot} -right-1.5 cursor-crosshair`} />
              <div className="p-3 flex flex-col gap-2">
                <textarea value={n.text} onChange={(e) => patch(n.id, { text: e.target.value })} rows={3} spellCheck={false}
                  placeholder={n.kind === 'rules' ? t('orchRulesPh') : n.kind === 'start' ? t('orchStartPh') : t('orchCtxPh')} className={`${field} resize-none`} />
                {n.kind !== 'rules' && (n.agent ?? 'claude') === 'claude' && <select value={n.effort ?? (n.kind === 'start' ? 'low' : '')} onChange={(e) => patch(n.id, { effort: e.target.value || undefined })} title={t('orchEffort')} className={field}>
                  {n.kind !== 'start' && <option value="">{t('orchEffort')}: auto</option>}{EFFORTS.map((x) => <option key={x} value={x}>{t('orchEffort')}: {x}</option>)}</select>}
                {n.kind === 'start' && <span className="text-micro text-dim">{t('orchMapCtx', { n: notes.length, k: mapTok })}</span>}
                {n.state === 'run' && n.since && <Elapsed since={n.since} />}
                {n.use && <span title={t('orchUseTip')} className="text-micro text-dim tabular-nums">{n.use.same ? t('orchSame') : `↑${k(n.use.input)} ⟳${k(n.use.cached)} ↓${k(n.use.output)}${n.use.cost > 0 ? ` · $${n.use.cost.toFixed(3)}` : ''}`}</span>}
                {n.kind === 'start' && n.out && <pre className={`max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-field ${n.state === 'err' ? 'text-status-err' : 'text-mut'}`}>{n.out}</pre>}
                {n.kind === 'start' && n.final && <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-accent-dim text-fg">{n.final}</pre>}
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
    <Dialogue log={log} busy={running} onStop={() => { stopped.current = true; stopAgents().catch(console.error) }} queue={!!o.queue} onQueue={() => upd((c) => ({ ...c, queue: !c.queue }))} leadChat={!!o.leadChat} onLeadChat={() => upd((c) => ({ ...c, leadChat: !c.leadChat }))} onSend={ask} onClear={() => upd((c) => ({ ...c, log: [], nodes: c.nodes.map((n) => ({ ...n, sid: undefined, mapSum: undefined, sum: undefined })) }))}
      agents={o.nodes.filter((n) => n.kind !== 'rules').map((n) => ({ id: n.id, name: who(n), role: n.role ?? (n.kind === 'model' ? n.text.split(/\r?\n/)[0].slice(0, 60) : undefined), state: n.state, task: [...log].reverse().find((e) => e.kind === 'task' && e.toId === n.id)?.text }))} />
    </div>
  )
}

/** How long the block's current call has been running; turns to a warning past SLOW seconds. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return <span className={`text-micro tabular-nums ${s > SLOW ? 'text-status-err' : 'text-dim'}`}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

const DOT = { run: 'bg-accent animate-pulse', ok: 'bg-status-ok', err: 'bg-status-err' } as const
const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Replaces the chat sidebar on this tab: who is doing what, the saved dialogue between agents, and a box to write to any of them. */
function Dialogue({ log, agents, busy, onStop, queue, onQueue, leadChat, onLeadChat, onSend, onClear }: {
  log: Entry[]; busy: boolean; onStop: () => void; queue: boolean; onQueue: () => void; leadChat: boolean; onLeadChat: () => void; onSend: (id: string, text: string) => void; onClear: () => void
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
                  : <><Markdown text={e.text} /><StoredImg src={e.img} id={e.imgId} /></>}
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
        <div className="flex gap-2">
          <button title={t(queue ? 'orchQueueTip' : 'orchParTip')} onClick={onQueue} className="btn-press px-3 py-1 rounded-full border border-line text-xs text-dim hover:text-fg">{t(queue ? 'orchQueue' : 'orchPar')}</button>
          {target === agents[0]?.id && <button title={t(leadChat ? 'orchChatTip' : 'orchRebriefTip')} onClick={onLeadChat} className="btn-press px-3 py-1 rounded-full border border-line text-xs text-dim hover:text-fg">{t(leadChat ? 'orchChatOnly' : 'orchRebrief')}</button>}
        </div>
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
