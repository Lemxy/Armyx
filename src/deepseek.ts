// DeepSeek chat call that tries several OpenAI-compatible gateways and keeps the first one that answers 200.
// The last working gateway is remembered and tried first next time.
import { getKey } from './keys'
import { sse } from './sse'
import { httpPost, inTauri } from './vault'

const GATEWAYS = ['https://api.deepseek.com', 'https://api.reformboss.com/v1']
const NV = 'https://integrate.api.nvidia.com/v1'
const LAST = 'desovault.dsGateway'
const TIMEOUT = 90_000 // ms per gateway call: a hung gateway falls through to the next one instead of freezing the run

/** onText: stream the answer and report the text so far as it grows (the result then holds the text only, no usage). */
export async function dsChat(key: string, body: object, onText?: (soFar: string) => void, only?: string): Promise<any> {
  const custom = getKey('dsGateway').replace(/\/+$/, '') // user's own gateway from Settings
  const all = [...new Set([...(custom ? [custom] : []), ...GATEWAYS])]
  const last = localStorage.getItem(LAST)
  const order = only ? [only] : last && all.includes(last) ? [last, ...all.filter((g) => g !== last)] : all // `only`: one fixed gateway, no fallback, DeepSeek's memory untouched
  let err = ''
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` }
  const stream = async (r: Response) => { let s = ''; await sse(r, (e) => { const d = e.choices?.[0]?.delta?.content; if (d) onText!((s += d)) }); return { choices: [{ message: { content: s } }] } }
  const post = async (g: string, b: object) => {
    if (inTauri && g === NV) { // no CORS on NVIDIA's side: Rust makes the call, the answer comes whole (no streaming)
      const raw = await httpPost(g + '/chat/completions', key, JSON.stringify(b)), cut = raw.lastIndexOf('\n'), status = +raw.slice(cut + 1)
      const j = (() => { try { return JSON.parse(raw.slice(0, cut)) } catch { return {} } })(); if (status < 300 && onText) onText(j.choices?.[0]?.message?.content ?? '')
      return { r: { ok: status < 300, statusText: String(status) } as Response, j }
    }
    const r = await fetch(`${g}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(onText ? { ...b, stream: true } : b), signal: AbortSignal.timeout(TIMEOUT) }); return { r, j: r.ok && onText ? await stream(r) : await r.json().catch(() => ({})) } }
  for (const g of order) {
    try {
      let { r, j } = await post(g, body)
      if (!only && !r.ok && /model/i.test(j.error?.message ?? '')) { // gateway names the model differently: pick one it actually lists
        const ids: string[] = ((await (await fetch(`${g}/models`, { headers, signal: AbortSignal.timeout(TIMEOUT) })).json().catch(() => ({}))).data ?? []).map((m: { id: string }) => m.id).filter((id: string) => /deepseek/i.test(id))
        const alt = ids.find((id) => /flash/i.test(id)) ?? ids[0]
        if (alt) ({ r, j } = await post(g, { ...body, model: alt }))
      }
      if (r.ok) { if (!only) localStorage.setItem(LAST, g); return j }
      err ||= j.error?.message ?? r.statusText
    } catch (e) { err ||= String(e) }
  }
  throw new Error(err)
}

/** OpenRouter (OpenAI-compatible): same call, its own gateway. Free models are the ids ending in ":free". */
export const orChat = (key: string, body: object, onText?: (soFar: string) => void) => dsChat(key, body, onText, 'https://openrouter.ai/api/v1')

/** NVIDIA NIM (OpenAI-compatible, build.nvidia.com key "nvapi-…"): same call, its own gateway. */
export const nvChat = (key: string, body: object, onText?: (soFar: string) => void) => dsChat(key, body, onText, NV)
