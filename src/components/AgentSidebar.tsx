import { useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, Clock, Copy, CornerDownLeft, Plus, Send, Trash2, X } from 'lucide-react'
import Markdown from './Markdown'
import { useI18n } from '../i18n'
import { graphMap, MAP_INTRO, tokens, type Note } from '../deso'
import { agyModels, inTauri, runAgentCli } from '../vault'

type Id = 'claude' | 'agy'
type Mode = 'cli' | 'api'
type Msg = { role: 'user' | 'assistant'; text: string; at: number; error?: boolean; tin?: number; tout?: number }
type Chat = { id: string; title: string; msgs: Msg[]; at: number }

const AGENTS = {
  claude: { label: 'Claude', cli: 'claude', key: 'Anthropic API Key' },
  agy: { label: 'Antigravity', cli: 'agy', key: 'Gemini API Key' },
} as const

// [id, label]. Every model takes an effort level: Claude via output_config.effort, Gemini via a thinking budget.
const MODELS = {
  claude: [['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-haiku-5-5', 'Claude Haiku 5.5']],
  agy: [['gemini-4-argon', 'Gemini 4 Argon'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite']],
} as const
// [level, Gemini thinking budget]
const EFFORTS = [['low', 1024], ['medium', 4096], ['high', 16384], ['max', 32768]] as const

// What the agent keeps in context: the newest turns that fit. Older turns stay in the saved chat, just not in the prompt.
const MAX_TURNS = 24, MAX_CHARS = 30000
const SYSTEM = (map: string) =>
  `You are the assistant inside DesoVault, a knowledge-graph note app. ${MAP_INTRO} Be concise and answer in the user's language.\n\n# Graph map\n${map}`

const trim = (msgs: Msg[]) => {
  const ok = msgs.filter((m) => !m.error)
  let out = ok.slice(-MAX_TURNS), size = out.reduce((n, m) => n + m.text.length, 0)
  while (out.length > 1 && size > MAX_CHARS) size -= out.shift()!.text.length
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

async function callApi(id: Id, key: string, system: string, msgs: Msg[], model: string, effort: number): Promise<string> {
  const [level, budget] = EFFORTS[effort]
  if (id === 'claude') {
    // Claude 5.x: adaptive thinking + effort; budget_tokens is rejected with a 400. The graph map is cached between turns.
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: level },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: msgs.map((m) => ({ role: m.role, content: m.text })) }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message ?? r.statusText)
    return (j.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
      generationConfig: { thinkingConfig: { thinkingBudget: budget } } }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message ?? r.statusText)
  return (j.candidates?.[0]?.content?.parts as { text?: string }[] | undefined)?.map((p) => p.text ?? '').join('') ?? ''
}

/** The CLIs are single-shot, so the saved conversation is replayed inside the prompt. */
const cliPrompt = (system: string, msgs: Msg[]) =>
  `${system}\n\n# Conversation\n` + msgs.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n') + '\n\nAssistant:'

// ---- persistence: settings are global, chats are per project ----
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return d } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { console.error(e) } }
const CFG = 'desovault.agent'
type Cfg = { id: Id; models: Record<Id, string>; modes: Record<Id, Mode>; effort: number }
const DEFAULT: Cfg = { id: 'claude', models: { claude: MODELS.claude[0][0], agy: MODELS.agy[0][0] }, modes: { claude: inTauri ? 'cli' : 'api', agy: inTauri ? 'cli' : 'api' }, effort: 1 }
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

function Assistant({ m, fresh, canInsert, onInsert, onTick }: { m: Msg; fresh: boolean; canInsert: boolean; onInsert: () => void; onTick: () => void }) {
  const { t } = useI18n()
  const { shown, typing, skip } = useTypewriter(m.text, fresh && !m.error)
  const [copied, setCopied] = useState(false)
  useEffect(() => { onTick() }, [shown]) // keep the view pinned to the bottom while typing
  return (
    <div className="flex flex-col gap-1.5" onClick={typing ? skip : undefined}>
      {m.error ? <p className="text-xs text-rose-300 whitespace-pre-wrap">{m.text}</p> : <Markdown text={shown} />}
      {typing && <span className="inline-block w-1.5 h-3.5 bg-fg/70 animate-pulse" />}
      {!typing && !m.error && (
        <div className="flex items-center gap-1 text-[11px] text-dim">
          <button onClick={() => { navigator.clipboard.writeText(m.text).catch(console.error); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-fg hover:bg-panel">{copied ? <Check size={12} /> : <Copy size={12} />}{t('copy')}</button>
          <button onClick={onInsert} disabled={!canInsert} className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-fg hover:bg-panel disabled:opacity-40"><CornerDownLeft size={12} />{t('insert')}</button>
          {m.tin != null && <span className="ml-auto">{m.tin} {t('tokIn')} · {m.tout} {t('tokOut')}</span>}
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
  const [keys, setKeys] = useState<Record<Id, string>>({ claude: '', agy: '' }) // never persisted
  const [chats, setChats] = useState<Chat[]>(() => load<Chat[]>(`desovault.chats.${project}`, []))
  const [activeId, setActiveId] = useState(() => chats[0]?.id ?? '')
  const [showCfg, setShowCfg] = useState(false)
  const [showHist, setShowHist] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [freshAt, setFreshAt] = useState(0)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { save(CFG, cfg) }, [cfg])
  useEffect(() => { save(`desovault.chats.${project}`, chats) }, [chats, project])

  const { id, modes, effort } = cfg
  const a = AGENTS[id], mode = modes[id], key = keys[id]
  const [agyList, setAgyList] = useState<[string, string][]>([])
  useEffect(() => { if (inTauri) agyModels().then(setAgyList).catch(console.error) }, [])
  // `agy` in CLI mode: the models the installed CLI reports (its ids differ from the Gemini API's).
  const fromCli = id === 'agy' && mode === 'cli' && agyList.length > 0
  const list: readonly (readonly [string, string])[] = fromCli ? agyList : MODELS[id]
  const model = list.some((m) => m[0] === cfg.models[id]) ? cfg.models[id] : list[0][0]
  // `agy --effort` conflicts with --model, so there effort is part of the model name (…-high).
  const effortFixed = id === 'agy' && mode === 'cli'
  const real = mode === 'cli' ? inTauri : !!key
  const status = t(real ? (mode === 'cli' ? 'online' : 'ready') : mode === 'cli' ? 'simBrowser' : 'simKey')

  const map = graphMap(notes)
  const chat = chats.find((c) => c.id === activeId)
  const msgs = chat?.msgs ?? []
  const set = (p: Partial<Cfg>) => setCfg((c) => ({ ...c, ...p }))

  const patch = (cid: string, f: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === cid ? f(c) : c)))
  const newChat = () => { setActiveId(''); setShowHist(false); setPrompt('') }

  const send = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    const user: Msg = { role: 'user', text, at: Date.now() }
    let cid = activeId
    if (!chat) { cid = uid(); setChats((cs) => [{ id: cid, title: text.slice(0, 48), msgs: [user], at: Date.now() }, ...cs]); setActiveId(cid) }
    else patch(cid, (c) => ({ ...c, msgs: [...c.msgs, user], at: Date.now() }))
    setPrompt(''); setBusy(true)
    const history = trim([...msgs, user])
    const system = SYSTEM(map)
    const tin = tokens(system + history.map((m) => m.text).join('\n'))
    let reply: Msg
    try {
      if (!real) throw new Error(status)
      const out = mode === 'cli'
        ? await runAgentCli(a.cli, cliPrompt(system, history), model, effortFixed ? '' : EFFORTS[effort][0])
        : await callApi(id, key, system, history, model, effort)
      reply = { role: 'assistant', text: out.trim(), at: Date.now(), tin, tout: tokens(out) }
    } catch (e) {
      reply = { role: 'assistant', text: `Error: ${e instanceof Error ? e.message : e}`, at: Date.now(), error: true }
    }
    patch(cid, (c) => ({ ...c, msgs: [...c.msgs, reply], at: Date.now() }))
    setFreshAt(reply.at); setBusy(false)
  }

  const scroll = () => end.current?.scrollIntoView({ block: 'end' })
  useEffect(() => { scroll() }, [msgs.length, busy])

  const seg = (on: boolean) => `flex-1 py-1.5 rounded-md text-xs font-medium ${on ? 'bg-panel text-fg' : 'text-dim hover:text-fg'}`
  const group = 'flex gap-1 p-1 rounded-lg bg-bg border border-line'
  const label = 'text-[10px] font-semibold uppercase tracking-wider text-dim'
  const icon = 'p-1.5 rounded-md text-dim hover:text-fg hover:bg-panel'
  const effortName = effortFixed ? '' : ` · ${t(EFFORTS[effort][0])}`

  return (
    <aside className="w-[26rem] shrink-0 border-l border-line bg-surface flex flex-col text-[13px] relative">
      <div className="flex items-center gap-1 px-3 h-12 border-b border-line">
        <Bot size={15} className="text-mut ml-1" />
        <span className="font-semibold tracking-tight truncate ml-1">{chat?.title ?? t('chatNew')}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-dim mr-1"><span className={`w-1.5 h-1.5 rounded-full ${real ? 'bg-emerald-400' : 'bg-amber-400'}`} />{status}</span>
        <button onClick={newChat} title={t('chatNew')} className={icon}><Plus size={15} /></button>
        <button onClick={() => setShowHist((v) => !v)} title={t('history')} className={`${icon} ${showHist ? 'bg-panel text-fg' : ''}`}><Clock size={15} /></button>
        <button onClick={onClose} title={t('close')} className={icon}><X size={15} /></button>
      </div>

      {showHist && (
        <div className="absolute inset-x-0 top-12 bottom-0 z-10 bg-surface overflow-auto p-3 flex flex-col gap-1">
          {chats.length === 0 && <p className="text-dim text-xs p-2">{t('historyEmpty')}</p>}
          {chats.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-lg border ${c.id === activeId ? 'bg-panel border-line2' : 'border-transparent hover:bg-panel/60'}`}>
              <button onClick={() => { setActiveId(c.id); setShowHist(false) }} className="flex-1 min-w-0 text-left px-3 py-2">
                <span className="block truncate">{c.title}</span>
                <span className="block text-[11px] text-dim">{c.msgs.length} · {ago(c.at)}</span>
              </button>
              <button onClick={() => { setChats((cs) => cs.filter((x) => x.id !== c.id)); if (c.id === activeId) setActiveId('') }} title={t('delete')}
                className="p-2 mr-1 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-rose-300"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setShowCfg((v) => !v)} className="flex items-center gap-2 px-4 py-2 border-b border-line text-[11px] text-dim hover:text-fg text-left">
        <span className="truncate">{a.label} · {mode === 'cli' ? t('modeCli') : t('modeApi')} · {list.find((m) => m[0] === model)?.[1]}{effortName}</span>
        <ChevronDown size={13} className={`ml-auto shrink-0 transition-transform ${showCfg ? 'rotate-180' : ''}`} />
      </button>
      {showCfg && (
        <div className="p-4 flex flex-col gap-3 border-b border-line">
          <div className={group}>{(Object.keys(AGENTS) as Id[]).map((k) => <button key={k} onClick={() => set({ id: k })} className={seg(id === k)}>{AGENTS[k].label}</button>)}</div>
          <div className={group}>{(['cli', 'api'] as Mode[]).map((m) => <button key={m} onClick={() => set({ modes: { ...modes, [id]: m } })} className={seg(mode === m)}>{m === 'cli' ? t('modeCli') : t('modeApi')}</button>)}</div>
          {mode === 'api' && <input type="password" value={key} onChange={(e) => setKeys((s) => ({ ...s, [id]: e.target.value }))} placeholder={a.key}
            className="px-3 py-2 rounded-lg bg-bg border border-line focus:border-line2 outline-none text-xs placeholder:text-dim" />}
          <label className="flex flex-col gap-1.5"><span className={label}>{t('model')}</span>
            <select value={model} onChange={(e) => set({ models: { ...cfg.models, [id]: e.target.value } })}
              className="px-3 py-2 rounded-lg bg-bg border border-line focus:border-line2 outline-none text-xs text-fg">
              {list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className={label}>{t('reasoning')}</span>
            {effortFixed
              ? <p className="px-3 py-2 rounded-lg bg-bg border border-line text-[11px] leading-relaxed text-dim">{t('effortInName')}</p>
              : <div className={group}>{EFFORTS.map(([k], i) => <button key={k} onClick={() => set({ effort: i })} className={seg(effort === i)}>{t(k)}</button>)}</div>}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 py-4 flex flex-col gap-5">
        {msgs.length === 0 && (
          <p className="m-auto text-center text-xs text-dim max-w-[16rem] leading-relaxed">{t('chatEmpty', { n: notes.length, k: tokens(map) })}</p>
        )}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={m.at} className="self-end max-w-[85%] px-3 py-2 rounded-lg bg-panel border border-line whitespace-pre-wrap text-[12.5px]">{m.text}</div>
          : <Assistant key={m.at} m={m} fresh={m.at === freshAt && i === msgs.length - 1} canInsert={!!note} onTick={scroll} onInsert={() => onInsert(m.text)} />)}
        {busy && <span className="text-xs text-dim animate-pulse">{t('thinking')}</span>}
        <div ref={end} />
      </div>

      <div className="p-3 border-t border-line">
        <div className="flex items-end gap-2 p-2 rounded-lg bg-bg border border-line focus-within:border-line2">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} spellCheck={false} placeholder={t('promptPh')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[13px] placeholder:text-dim max-h-40" />
          <button onClick={send} disabled={busy || !prompt.trim()} title={t('send')}
            className="p-2 rounded-md bg-fg text-bg hover:bg-fg/90 disabled:opacity-30"><Send size={14} /></button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-dim">{t('sendHint')}</p>
      </div>
    </aside>
  )
}
