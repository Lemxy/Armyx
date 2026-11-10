import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebounced } from '../debounce'
import { ArrowUp, Check, ChevronDown, Clock, Copy, CornerDownLeft, FolderOpen, Paperclip, Plus, Sparkles, Trash2, X } from 'lucide-react'
import Segmented from './Segmented'
import Markdown from './Markdown'
import { useI18n } from '../i18n'
import { graphMap, MAP_INTRO, sure, tokens, topHits, type Note } from '../deso'
import { mapOpts, recordRead } from '../mapmem'
import { getKey, setKey } from '../keys'
import { dsChat } from '../deepseek'
import { nanoAgy, nanoImage } from '../nano'
import { getImg, imgId, putImg } from '../imgs'
import StoredImg from './StoredImg'
import { picPath, readPics } from '../pics'
import { agyModels, agyUsage, claudeUsage, inTauri, openRoot, runAgent, saveImage } from '../vault'

type Id = 'claude' | 'agy' | 'deepseek' | 'nano'
type Mode = 'cli' | 'api'
type Msg = { role: 'user' | 'assistant'; text: string; at: number; error?: boolean; tin?: number; tout?: number; img?: string; imgId?: string; pics?: string[]; via?: string } // img = a generated picture; only imgId is saved (src/imgs.ts). pics = ids of pictures you attached
type Chat = { id: string; title: string; msgs: Msg[]; at: number }

const AGENTS = {
  claude: { label: 'Claude', cli: 'claude', key: 'Anthropic API Key' },
  agy: { label: 'Antigravity', cli: 'agy', key: 'Gemini API Key' },
  deepseek: { label: 'DeepSeek', cli: '', key: 'DeepSeek API Key' }, // API only: no CLI
  nano: { label: 'Nano Banana', cli: '', key: 'Gemini API Key' }, // API only, draws pictures; uses the Gemini key of Antigravity
} as const

// [id, label]. Every model takes an effort level: Claude via output_config.effort, Gemini via a thinking budget.
export const MODELS = {
  claude: [['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-haiku-5-5', 'Claude Haiku 5.5']],
  agy: [['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite']],
  nano: [['gemini-2.5-flash-image', 'Nano Banana'], ['gemini-3-pro-image-preview', 'Nano Banana Pro']], // image models: the orchestra and the chat
  deepseek: [['deepseek-v4-flash', 'DeepSeek V4 Flash'], ['deepseek-v4-pro', 'DeepSeek V4 Pro'], ['deepseek-chat', 'DeepSeek V3 (chat)'], ['deepseek-reasoner', 'DeepSeek R1 (reasoner)']],
} as const
// Where a simple lookup goes when "cheap model for simple lookups" is on.
const CHEAP = { claude: MODELS.claude[2][0], agy: MODELS.agy[1][0], deepseek: MODELS.deepseek[0][0] } as const
// [level, Gemini thinking budget]
const EFFORTS = [['low', 1024], ['medium', 4096], ['high', 16384], ['max', 32768]] as const

// What the agent keeps in context: the newest turns that fit. Older turns stay in the saved chat, just not in the prompt.
const MAX_TURNS = 24, MAX_CHARS = 30000
const SYSTEM = (map: string) =>
  `You are the assistant inside Taurium, a knowledge-graph note app. ${MAP_INTRO} Be concise and answer in the user's language.\n\n# Graph map\n${map}`

const trim = (msgs: Msg[]) => {
  const ok = msgs.filter((m) => !m.error)
  let out = ok.slice(-MAX_TURNS), size = out.reduce((n, m) => n + m.text.length, 0)
  while (out.length > 1 && size > MAX_CHARS) size -= out.shift()!.text.length
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

const mime = (d: string) => d.slice(5, d.indexOf(';'))
const b64 = (d: string) => d.split(',')[1]

async function callApi(id: Id, key: string, system: string, msgs: Msg[], model: string, effort: number, pics: Map<string, string>): Promise<string> {
  const have = (m: Msg) => (m.pics ?? []).filter((i) => pics.has(i))
  const [level, budget] = EFFORTS[effort]
  if (id === 'claude') {
    // Claude 5.x: adaptive thinking + effort; budget_tokens is rejected with a 400. The graph map is cached between turns.
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: level },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: msgs.map((m) => ({ role: m.role, content: have(m).length ? [...have(m).map((i) => ({ type: 'image', source: { type: 'base64', media_type: mime(pics.get(i)!), data: b64(pics.get(i)!) } })), { type: 'text', text: m.text }] : m.text })) }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message ?? r.statusText)
    return (j.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  if (id === 'deepseek') {
    const j = await dsChat(key, { model, messages: [{ role: 'system', content: system }, ...msgs.map((m) => ({ role: m.role, content: m.text }))] })
    return j.choices?.[0]?.message?.content ?? ''
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }, ...have(m).map((i) => ({ inlineData: { mimeType: mime(pics.get(i)!), data: b64(pics.get(i)!) } }))] })),
      generationConfig: { thinkingConfig: { thinkingBudget: budget } } }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message ?? r.statusText)
  return (j.candidates?.[0]?.content?.parts as { text?: string }[] | undefined)?.map((p) => p.text ?? '').join('') ?? ''
}

/** The CLIs are single-shot, so the saved conversation is replayed inside the prompt. */
const cliPrompt = (system: string, msgs: Msg[], paths: Map<string, string>, hits: string) =>
  `${system}\n\n# Conversation\n` + msgs.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}${(m.pics ?? []).filter((i) => paths.has(i)).map((i) => ` [Image: ${paths.get(i)}]`).join('')}`).join('\n\n') + (hits && `\n\n# Best matches for the last message\n${hits}`) + '\n\nAssistant:'

// ---- persistence: settings are global, chats are per project ----
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return d } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { console.error(e) } }
const CFG = 'desovault.agent'
type Cfg = { id: Id; models: Record<Id, string>; modes: Record<Id, Mode>; effort: number; auto?: boolean }
type Row = { title?: string; k: 'usage5h' | 'usage7d'; pct: number; reset: string }
const DEFAULT: Cfg = { id: 'claude', models: { claude: MODELS.claude[0][0], agy: MODELS.agy[0][0], deepseek: MODELS.deepseek[0][0], nano: MODELS.nano[0][0] }, modes: { claude: inTauri ? 'cli' : 'api', agy: inTauri ? 'cli' : 'api', deepseek: 'api', nano: 'api' }, effort: 1 }
const uid = () => Math.random().toString(36).slice(2, 10)

/** Reveals `text` progressively (~4s max) so replies appear typed. */
function useTypewriter(text: string, on: boolean) {
  const [n, setN] = useState(on ? 0 : text.length)
  useEffect(() => {
    if (!on) return setN(text.length)
    setN(0)
    const step = Math.max(2, Math.ceil(text.length / 240))
    const id = setInterval(() => setN((c) => Math.min(text.length, c + step)), 16)
    return () => clearInterval(id)
  }, [text, on])
  return { shown: text.slice(0, n), typing: n < text.length, skip: () => setN(text.length) }
}

function Assistant({ label, m, fresh, canInsert, onInsert, onInsertImage, onTick }: { label: string; m: Msg; fresh: boolean; canInsert: boolean; onInsert: () => void; onInsertImage: () => void; onTick: () => void }) {
  const { t } = useI18n()
  const { shown, typing, skip } = useTypewriter(m.text, fresh && !m.error)
  const [copied, setCopied] = useState(false)
  useEffect(() => { onTick() }, [shown]) // keep the view pinned to the bottom while typing
  return (
    <div className="flex flex-col gap-2 anim-rise" onClick={typing ? skip : undefined}>
      <span className="flex items-center gap-1.5 text-micro text-accent"><Sparkles size={11} />{label}</span>
      {m.error ? <p className="text-sm text-status-err whitespace-pre-wrap">{m.text}</p> : <Markdown text={shown} />}
      {m.img || m.imgId ? <StoredImg src={m.img} id={m.imgId} /> : null}
      {typing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
      {!typing && !m.error && (
        <div className="flex items-center gap-1 text-micro text-dim">
          <button onClick={() => { navigator.clipboard.writeText(m.text).catch(console.error); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:text-fg hover:bg-panel">{copied ? <Check size={12} /> : <Copy size={12} />}{t('copy')}</button>
          <button onClick={onInsert} disabled={!canInsert} className="flex items-center gap-1 px-2 py-1 rounded-md hover:text-fg hover:bg-panel disabled:opacity-40"><CornerDownLeft size={12} />{t('insert')}</button>
          {(m.img || m.imgId) && <button onClick={onInsertImage} disabled={!canInsert || !inTauri} title={inTauri ? undefined : t('desktopOnly')} className="flex items-center gap-1 px-2 py-1 rounded-md hover:text-fg hover:bg-panel disabled:opacity-40"><CornerDownLeft size={12} />{t('insertImage')}</button>}
          {m.tin != null && <span className="ml-auto">{m.via && `${m.via} · `}{m.tin} {t('tokIn')} · {m.tout} {t('tokOut')}</span>}
        </div>
      )}
    </div>
  )
}

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000)
  return m < 1 ? '·' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

export default function AgentSidebar({ notes, note, project, onInsert, onClose }: { notes: Note[]; note?: Note; project: string; onInsert: (t: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [cfg, setCfg] = useState<Cfg>(() => ({ ...DEFAULT, ...load<Partial<Cfg>>(CFG, {}) }))
  const [keys, setKeys] = useState<Record<Id, string>>(() => ({ claude: getKey('claude'), agy: getKey('agy'), deepseek: getKey('deepseek'), nano: getKey('agy') })) // kept in local storage (src/keys.ts)
  const [chats, setChats] = useState<Chat[]>(() => load<Chat[]>(`desovault.chats.${project}`, []))
  const [activeId, setActiveId] = useState(() => chats[0]?.id ?? '')
  const [showCfg, setShowCfg] = useState(true) // settings are visible on entry
  const [plans, setPlans] = useState<Partial<Record<Id, Row[]>>>({})
  const [planErr, setPlanErr] = useState<Partial<Record<Id, string>>>({})
  const lastClaude = useRef(0)
  const [showHist, setShowHist] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ id: string; data: string }[]>([]) // pictures attached to the message being written
  const [freshAt, setFreshAt] = useState(0)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { save(CFG, cfg) }, [cfg])
  useEffect(() => { save(`desovault.chats.${project}`, chats.map((c) => ({ ...c, msgs: c.msgs.map(({ img, ...m }) => m) }))) }, [chats, project]) // pictures are too big for localStorage: they live in the image store

  const { id, modes, effort } = cfg
  const apiOnly = id === 'deepseek' || id === 'nano'
  const a = AGENTS[id], mode: Mode = apiOnly ? 'api' : modes[id], key = keys[id]
  const [agyList, setAgyList] = useState<[string, string][]>([])
  useEffect(() => { if (inTauri) agyModels().then(setAgyList).catch(console.error) }, [])
  // `agy` in CLI mode: the models the installed CLI reports (its ids differ from the Gemini API's).
  const fromCli = id === 'agy' && mode === 'cli' && agyList.length > 0
  const list: readonly (readonly [string, string])[] = fromCli ? agyList : MODELS[id]
  const model = list.some((m) => m[0] === cfg.models[id]) ? cfg.models[id] : list[0][0]
  // `agy --effort` conflicts with --model, so there effort is part of the model name (…-high).
  const effortFixed = id === 'agy' && mode === 'cli'
  const real = mode === 'cli' ? inTauri : !!key || (id === 'nano' && inTauri) // Nano Banana without a key is drawn by the Antigravity CLI
  // Claude is routed in CLI mode only (Haiku is called there without an effort level); the CLI's own agy list has no known cheap entry.
  const routable = id === 'claude' ? mode === 'cli' : id !== 'nano' && !fromCli
  const status = t(real ? (mode === 'cli' ? 'online' : 'ready') : mode === 'cli' ? 'simBrowser' : 'simKey')

  const slowNotes = useDebounced(notes) // note edits settle before the map is rebuilt
  const map = useMemo(() => graphMap(slowNotes, undefined, '', mapOpts(slowNotes)), [slowNotes]) // was recomputed on every keystroke in the chat box
  const chat = chats.find((c) => c.id === activeId)
  const msgs = chat?.msgs ?? []
  const set = (p: Partial<Cfg>) => setCfg((c) => ({ ...c, ...p }))

  const patch = (cid: string, f: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === cid ? f(c) : c)))
  const newChat = () => { setActiveId(''); setShowHist(false); setPrompt('') }

  const send = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    if (text === '/clear') { newChat(); setPending([]); return } // a fresh conversation; the old one stays in the history
    const user: Msg = { role: 'user', text, at: Date.now(), pics: pending.length ? pending.map((p) => p.id) : undefined }
    let cid = activeId
    if (!chat) { cid = uid(); setChats((cs) => [{ id: cid, title: text.slice(0, 48), msgs: [user], at: Date.now() }, ...cs]); setActiveId(cid) }
    else patch(cid, (c) => ({ ...c, msgs: [...c.msgs, user], at: Date.now() }))
    setPrompt(''); setPending([]); setBusy(true)
    // the map stays identical between questions, so the provider's prompt cache can reuse it
    const history = trim([...msgs, user])
    const system = SYSTEM(map)
    const tin = tokens(system + history.map((m) => m.text).join('\n'))
    let reply: Msg
    // A short lookup the map answers with confidence (one file far ahead of the rest) does not need the big model.
    const easy = !!cfg.auto && routable && !user.pics && text.length <= 200 && sure(notes, text)
    const useModel = easy ? CHEAP[id as keyof typeof CHEAP] : model, level = EFFORTS[easy ? 0 : effort][0]
    try {
      if (!real) throw new Error(status)
      if (id === 'deepseek' && user.pics) throw new Error(t('noImagesDs'))
      // the newest 4 pictures of the conversation go along: as data for the APIs, as files on disk for the CLIs
      const pics = new Map<string, string>(), paths = new Map<string, string>()
      for (const i of history.flatMap((m) => m.pics ?? []).slice(-4)) {
        const d = await getImg(i)
        if (d) pics.set(i, d)
        if (d && mode === 'cli') paths.set(i, await picPath(i))
      }
      if (id === 'nano') { // a picture: the conversation so far is the prompt, no map
        // the newest picture goes along with its turn, so "make it darker" changes that picture instead of drawing a new one
        const last = [...history].reverse().find((m) => m.img || m.imgId)
        const pic = last ? last.img ?? await getImg(last.imgId!).catch(() => undefined) : undefined
        const turns = history.map((m) => ({ role: m.role, text: m.text, imgs: [...(m === last && pic ? [pic] : []), ...(m.pics ?? []).flatMap((i) => pics.get(i) ?? [])] }))
        const r = key ? await nanoImage(key, model, turns) : await nanoAgy(turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n'), turns.flatMap((m) => m.imgs))
        const iid = imgId(); putImg(iid, r.img)
        reply = { role: 'assistant', text: r.text, img: r.img, imgId: iid, at: Date.now(), tin: r.input, tout: r.output }
      } else {
        // The CLI agent can open files, so it also gets the closest files with the lines of their definitions (after the dialogue: the cached start is untouched).
        const run = () => runAgent(a.cli, cliPrompt(system, history, paths, topHits(notes, text, 5)), useModel, effortFixed || useModel.includes('haiku') ? '' : level).then((r) => { recordRead(r.files); return r.text })
        const out = mode === 'cli' ? await run() : await callApi(id, key, system, history, useModel, easy ? 0 : effort, pics)
        reply = { role: 'assistant', text: out.trim(), at: Date.now(), tin, tout: tokens(out), via: easy ? list.find((m) => m[0] === useModel)?.[1] ?? useModel : undefined } // via = the cheaper model that answered instead of yours
      }
    } catch (e) {
      reply = { role: 'assistant', text: `Error: ${e instanceof Error ? e.message : e}`, at: Date.now(), error: true }
    }
    patch(cid, (c) => ({ ...c, msgs: [...c.msgs, reply], at: Date.now() }))
    setFreshAt(reply.at); setBusy(false)
  }

  // The picture is written next to the notes (images/<id>.png) and a Markdown link to it goes into the open note.
  const insertImage = async (m: Msg) => {
    try {
      const data = m.img ?? (m.imgId ? await getImg(m.imgId) : undefined)
      if (!data || !m.imgId) return
      const [head, b64] = data.split(',')
      const ext = head.includes('jpeg') ? 'jpg' : head.includes('webp') ? 'webp' : 'png'
      await saveImage(m.imgId, ext, Array.from(atob(b64), (c) => c.charCodeAt(0)))
      const path = `images/${m.imgId}.${ext}` // relative to the notes, where save_image writes it
      onInsert(`![${m.text.slice(0, 60).replace(/\W+/g, ' ')}](${path})`)
    } catch (e) { console.error(e) }
  }
  const addFiles = async (files: File[]) => { const got = await readPics(files); setPending((l) => [...l, ...got]) }
  const scroll = () => end.current?.scrollIntoView({ block: 'end' })
  useEffect(() => { scroll() }, [msgs.length, busy])

  // Both sources are normalised to "% used" rows. Claude: Anthropic's plan endpoint. Antigravity: the CLI's `/usage` (remaining_fraction per model group).
  const refreshPlan = () => {
    if (!inTauri) return
    const done = (k: Id) => (rows: Row[]) => { setPlans((p) => ({ ...p, [k]: rows })); setPlanErr((e) => ({ ...e, [k]: '' })) }
    const fail = (k: Id) => (e: unknown) => setPlanErr((p) => ({ ...p, [k]: String(e) })) // last good rows stay on screen
    // Anthropic's plan endpoint rate-limits (429) when hit often, so Claude is fetched at most every 2 min.
    if (Date.now() - lastClaude.current < 120000) return agyRefresh()
    lastClaude.current = Date.now()
    claudeUsage().then((r) => {
      const j = JSON.parse(r)
      done('claude')([['usage5h', j.five_hour], ['usage7d', j.seven_day]].flatMap(([k, w]) => w ? [{ k, pct: w.utilization, reset: w.resets_at } as Row] : []))
    }).catch(fail('claude'))
    agyRefresh()
    function agyRefresh() {
    agyUsage().then((r) => {
      const groups = JSON.parse(r).command?.data?.groups ?? []
      done('agy')(groups.flatMap((g: { name: string; buckets: { window: string; remaining_fraction: number; reset_time: string }[] }) =>
        g.buckets.map((b) => ({ title: g.name, k: b.window === '5h' ? 'usage5h' : 'usage7d', pct: (1 - b.remaining_fraction) * 100, reset: b.reset_time } as Row))))
    }).catch(fail('agy'))
    }
  }
  useEffect(() => { if (!inTauri) return; refreshPlan(); const i = setInterval(refreshPlan, 300000); return () => clearInterval(i) }, [])
  useEffect(() => { if (!busy) refreshPlan() }, [busy]) // numbers move after each reply
  const Limits = () => {
    const rows = plans[id]
    return (
      <div className="flex flex-col gap-2.5 pt-1">
        <span className={label}>{t('usage')}</span>
        {rows?.length ? rows.map((w, i) => (
          <div key={i} className="flex flex-col gap-1">
            {w.title && w.title !== rows[i - 1]?.title && <span className="text-micro text-fg pt-1">{w.title}</span>}
            <div className="flex justify-between text-xs"><span>{t(w.k)}</span><span className="tabular-nums">{Math.round(w.pct)}%</span></div>
            <div className="h-1.5 rounded-full bg-field overflow-hidden"><div className={`h-full rounded-full ${w.pct > 90 ? 'bg-status-err' : 'bg-accent'}`} style={{ width: `${Math.min(100, w.pct)}%` }} /></div>
            <span className="text-micro text-dim">{t('resets')} {new Date(w.reset).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )) : <p className="text-micro text-dim">{planErr[id] || (inTauri ? '…' : t('desktopOnly'))}</p>}
      </div>
    )
  }
  const label = 'text-micro text-dim'
  const icon = 'btn-press p-1.5 rounded-lg text-dim hover:text-fg hover:bg-panel'
  const effortName = effortFixed || apiOnly ? '' : ` · ${t(EFFORTS[effort][0])}`

  return (
    <aside className="anim-slide w-[26rem] shrink-0 border-l border-line bg-surface flex flex-col text-sm relative">
      <div className="flex items-center gap-1 px-4 h-14 border-b border-line">
        <span className="font-serif text-lg font-semibold truncate">{chat?.title ?? t('chatNew')}</span>
        <span className="ml-auto flex items-center gap-1.5 text-micro text-dim mr-1 shrink-0"><span className={`w-1.5 h-1.5 rounded-full ${real ? 'bg-status-ok' : 'bg-accent'}`} />{status}</span>
        <button onClick={newChat} title={t('chatNew')} className={icon}><Plus size={15} /></button>
        <button onClick={() => setShowHist((v) => !v)} title={t('history')} className={`${icon} ${showHist ? 'bg-panel text-fg' : ''}`}><Clock size={15} /></button>
        <button onClick={onClose} title={t('close')} className={icon}><X size={15} /></button>
      </div>

      {showHist && (
        <div className="anim-fade absolute inset-x-0 top-14 bottom-0 z-10 bg-surface overflow-auto p-3 flex flex-col gap-1">
          {chats.length === 0 && <p className="text-dim text-xs p-2">{t('historyEmpty')}</p>}
          {chats.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-xl ${c.id === activeId ? 'bg-panel' : 'hover:bg-panel/60'}`}>
              <button onClick={() => { setActiveId(c.id); setShowHist(false) }} className="flex-1 min-w-0 text-left px-3 py-2">
                <span className="block truncate">{c.title}</span>
                <span className="block text-micro text-dim">{c.msgs.length} · {ago(c.at)}</span>
              </button>
              <button onClick={() => { setChats((cs) => cs.filter((x) => x.id !== c.id)); if (c.id === activeId) setActiveId('') }} title={t('delete')}
                className="p-2 mr-1 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-status-err"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setShowCfg((v) => !v)} className="flex items-center gap-2 px-5 py-2.5 border-b border-line text-micro text-dim hover:text-fg text-left">
        <span className="truncate">{a.label} · {mode === 'cli' ? t('modeCli') : t('modeApi')} · {list.find((m) => m[0] === model)?.[1]}{effortName}</span>
        <ChevronDown size={13} data-ease className={`ml-auto shrink-0 ${showCfg ? 'rotate-180' : ''}`} />
      </button>
      {showCfg && (
        <div className="anim-rise px-5 pt-3 pb-5 flex flex-col gap-3.5 border-b border-line">
          <div className="flex flex-col gap-1.5"><span className={label}>Agent</span><Segmented<Id> value={id} onChange={(k) => set({ id: k })} options={(Object.keys(AGENTS) as Id[]).map((k) => [k, AGENTS[k].label] as const)} /></div>
          {!apiOnly && <div className="flex flex-col gap-1.5"><span className={label}>Mode</span><Segmented<Mode> value={mode} onChange={(m) => set({ modes: { ...modes, [id]: m } })} options={[['cli', t('modeCli')], ['api', t('modeApi')]]} /></div>}
          {mode === 'api' && <input type="password" value={key} onChange={(e) => { const v = e.target.value, shared = id === 'agy' || id === 'nano'; setKey(id === 'nano' ? 'agy' : id, v); setKeys((s) => ({ ...s, [id]: v, ...(shared && { agy: v, nano: v }) })) }} placeholder={a.key}
            className="px-3.5 py-2 rounded-xl bg-field border border-line focus:border-accent outline-none text-sm placeholder:text-dim" />}
          <label className="flex flex-col gap-1.5"><span className={label}>{t('model')}</span>
            <select value={model} onChange={(e) => set({ models: { ...cfg.models, [id]: e.target.value } })}
              className="px-3.5 py-2 rounded-xl bg-field border border-line focus:border-accent outline-none text-sm text-fg">
              {list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {!apiOnly && <div className="flex flex-col gap-1.5">
            <span className={label}>{t('reasoning')}</span>
            {effortFixed
              ? <p className="px-3.5 py-2.5 rounded-xl bg-field border border-line text-micro leading-relaxed text-dim">{t('effortInName')}</p>
              : <Segmented value={String(effort)} onChange={(v) => set({ effort: +v })} options={EFFORTS.map(([k], i) => [String(i), t(k)] as const)} />}
          </div>}
          {routable && <label title={t('autoRouteTip')} className="flex items-center gap-2 text-xs text-dim hover:text-fg cursor-pointer"><input type="checkbox" checked={!!cfg.auto} onChange={(e) => set({ auto: e.target.checked })} />{t('autoRoute')}</label>}
          {!apiOnly && <Limits />}
          <button onClick={() => openRoot().catch(console.error)} className="flex items-center gap-2 text-xs text-dim hover:text-fg self-start"><FolderOpen size={14} />{t('openFolder')}</button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-5 pt-5 pb-3 flex flex-col gap-6">
        {msgs.length === 0 && (
          <p className="m-auto text-center text-dim max-w-[17rem] leading-relaxed">{t('chatEmpty', { n: notes.length, k: tokens(map) })}</p>
        )}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={m.at} className="anim-rise self-end max-w-[85%] flex flex-col items-end gap-1">
            {m.pics && <div className="flex flex-wrap justify-end gap-1.5">{m.pics.map((i) => <StoredImg key={i} id={i} plain cls="max-h-28 rounded-lg border border-line" />)}</div>}
            <p className="whitespace-pre-wrap px-4 py-2.5 rounded-2xl rounded-br-md bg-panel border border-line">{m.text}</p>
            <span className="text-micro text-dim">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          : <Assistant key={m.at} label={a.label} m={m} fresh={m.at === freshAt && i === msgs.length - 1} canInsert={!!note} onTick={scroll} onInsert={() => onInsert(m.text)} onInsertImage={() => insertImage(m)} />)}
        {busy && <span className="anim-fade text-micro text-dim animate-pulse">{t('thinking')}</span>}
        <div ref={end} />
      </div>

      <div className="px-4 pt-3 pb-3">
        {pending.length > 0 && <div className="flex flex-wrap gap-1.5 pb-2">{pending.map((p) => (
          <span key={p.id} className="relative"><img src={p.data} className="h-12 w-12 object-cover rounded-lg border border-line" />
            <button onClick={() => setPending((l) => l.filter((x) => x.id !== p.id))} className="absolute -top-1 -right-1 p-0.5 rounded-full bg-surface border border-line text-dim hover:text-status-err"><X size={10} /></button></span>))}</div>}
        <div className="flex items-end gap-2 pl-4 pr-2 py-2 rounded-2xl bg-field border border-line focus-within:border-accent focus-within:shadow-float">
          <label title={t('attachImage')} className="btn-press p-1.5 rounded-lg text-dim hover:text-accent cursor-pointer self-center"><Paperclip size={15} />
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} /></label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} spellCheck={false} placeholder={t('promptPh')}
            onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => x.type.startsWith('image/')); if (f.length) { e.preventDefault(); addFiles(f) } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            className="flex-1 min-w-0 py-1 bg-transparent outline-none resize-none text-sm placeholder:text-dim max-h-40" />
          <button onClick={send} disabled={busy || !prompt.trim()} title={t('send')}
            className="btn-press p-2 rounded-full bg-accent text-bg hover:opacity-90 disabled:opacity-25"><ArrowUp size={15} /></button>
        </div>
        <p className="mt-2 px-1 text-micro text-dim">{t('sendHint')}</p>
      </div>
    </aside>
  )
}
