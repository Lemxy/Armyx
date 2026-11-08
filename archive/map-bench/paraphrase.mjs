// Makes generated questions (bench/genq.mjs) harder for grep: the quoted docstring is rewritten by a model so that it means the same
// but shares no word of 5+ letters with the original and none of the item's name. Questions that cannot be rewritten that way are dropped.
//   node bench/paraphrase.mjs <questions.json> > paraphrased.json
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const qs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const words = (s) => new Set((s.toLowerCase().match(/[a-z]{5,}/g) ?? []).map((w) => w.replace(/(ing|es|ed|s)$/, '')))
const ask = (prompt) => new Promise((res) => {
  const p = spawn('claude', ['-p', '--model', 'claude-haiku-5-5', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'])
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.on('close', () => res(out.trim().split('\n')[0].replace(/^["'`]|["'`]$/g, '')))
  p.stdin.end(prompt)
})

const result = []
let next = 0
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < qs.length) {
    const q = qs[next++]
    const doc = q.q.match(/documented as: "(.+)"\? Reply/)?.[1]
    if (!doc) continue
    const banned = new Set([...words(doc), ...words(q.verify.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'))])
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await ask(`Rewrite this one-line description of a piece of code so it means the same thing but reuses none of its distinctive words (no word of 5 or more letters from the original) and does not mention the name "${q.verify}". Reply with the new description only, one line, no quotes.\n\nOriginal: ${doc}`)
      if (text && ![...words(text)].some((w) => banned.has(w))) { result.push({ ...q, q: q.q.replace(doc, text), original: doc }); break }
    }
  }
}))
console.error(`${result.length} of ${qs.length} questions rewritten`)
console.log(JSON.stringify(result, null, 1))
