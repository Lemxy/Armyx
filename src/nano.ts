// Nano Banana = Gemini image models. One call: the conversation so far in, text plus one inline image out. Shared by the chat sidebar and the orchestra.
import { imgId } from './imgs'
import { picNote } from './pics'
import { imagePath, readImage, runAgent, saveImage } from './vault'

export type NanoOut = { text: string; img: string; input: number; output: number }

const inline = (url: string) => { const [head, data] = url.split(','); return { inlineData: { mimeType: head.slice(5, head.indexOf(';')), data } } }

export async function nanoImage(key: string, model: string, turns: { role: 'user' | 'assistant'; text: string; imgs?: string[] }[]): Promise<NanoOut> { // imgs = pictures the model should see (the one to change, ones you attached)
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ contents: turns.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }, ...(m.imgs ?? []).map(inline)] })), generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message ?? r.statusText)
  const parts = (j.candidates?.[0]?.content?.parts ?? []) as { text?: string; inlineData?: { mimeType: string; data: string } }[]
  const im = parts.find((p) => p.inlineData)?.inlineData
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!im) throw new Error(text || 'No image returned')
  const u = j.usageMetadata ?? {}
  return { text: text || '🖼', img: `data:${im.mimeType};base64,${im.data}`, input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 }
}

// No API key: Gemini 3.8 Flash (High) in the Antigravity CLI draws it (your Google subscription pays), told to save the picture where we can read it.
const DRAW = 'You are an image generator. Use your built-in image generation ability to draw exactly what is asked; do not write code, SVG or ASCII art. Save the finished picture as a PNG at the path given below, then answer with one short line describing it. If you cannot generate images, say so plainly and save nothing.'
const AGY_MODEL = 'gemini-3.8-flash-high'

/** `imgs` = data: URLs of pictures to look at or change. Desktop only. */
export async function nanoAgy(prompt: string, imgs: string[] = []): Promise<NanoOut & { cached: number; cost: number }> {
  const id = imgId()
  const refs = await Promise.all(imgs.map((d, i) => saveImage(`${id}-ref${i}`, d.slice(5, d.indexOf(';')).includes('png') ? 'png' : 'jpg', Array.from(atob(d.split(',')[1]), (c) => c.charCodeAt(0)))))
  const target = await imagePath(id, 'png')
  const a = await runAgent('agy', [DRAW, `Save the picture to exactly this path: ${target}`, refs.length ? picNote(refs) : '', `# Request\n${prompt}`].filter(Boolean).join('\n\n'), AGY_MODEL, '')
  const bytes = await readImage(id, 'png').catch(() => { throw new Error(a.text || 'Antigravity returned no image') })
  const img = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })) })
  return { text: a.text || '🖼', img, input: a.input, cached: a.cached, output: a.output, cost: a.cost }
}
