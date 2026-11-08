// DeepSeek chat call that tries several OpenAI-compatible gateways and keeps the first one that answers 200.
// The last working gateway is remembered and tried first next time.
import { getKey } from './keys'

const GATEWAYS = ['https://api.deepseek.com', 'https://api.reformboss.com/v1']
const LAST = 'desovault.dsGateway'
const TIMEOUT = 90_000 // ms per gateway call: a hung gateway falls through to the next one instead of freezing the run

export async function dsChat(key: string, body: object): Promise<any> {
  const custom = getKey('dsGateway').replace(/\/+$/, '') // user's own gateway from Settings
  const all = [...new Set([...(custom ? [custom] : []), ...GATEWAYS])]
  const last = localStorage.getItem(LAST)
  const order = last && all.includes(last) ? [last, ...all.filter((g) => g !== last)] : all
  let err = ''
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` }
  const post = async (g: string, b: object) => { const r = await fetch(`${g}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(b), signal: AbortSignal.timeout(TIMEOUT) }); return { r, j: await r.json().catch(() => ({})) } }
  for (const g of order) {
    try {
      let { r, j } = await post(g, body)
      if (!r.ok && /model/i.test(j.error?.message ?? '')) { // gateway names the model differently: pick one it actually lists
        const ids: string[] = ((await (await fetch(`${g}/models`, { headers })).json().catch(() => ({}))).data ?? []).map((m: { id: string }) => m.id).filter((id: string) => /deepseek/i.test(id))
        const alt = ids.find((id) => /flash/i.test(id)) ?? ids[0]
        if (alt) ({ r, j } = await post(g, { ...body, model: alt }))
      }
      if (r.ok) { localStorage.setItem(LAST, g); return j }
      err ||= j.error?.message ?? r.statusText
    } catch (e) { err ||= String(e) }
  }
  throw new Error(err)
}
