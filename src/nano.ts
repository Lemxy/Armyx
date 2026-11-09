// Nano Banana = Gemini image models. One call: the conversation so far in, text plus one inline image out. Shared by the chat sidebar and the orchestra.
export type NanoOut = { text: string; img: string; input: number; output: number }

export async function nanoImage(key: string, model: string, turns: { role: 'user' | 'assistant'; text: string }[]): Promise<NanoOut> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ contents: turns.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })), generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
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
