// Skill-routing benchmark: does the graph hint replace the always-loaded skill list? Real `claude -p` runs, numbers from the API usage report.
//   base   your Claude Code as is (all skills, all MCP servers and plugins)
//   nomcp  same, MCP servers off          -> what the MCP servers cost
//   v5     MCP off + skills off + mcp/claude-hook.mjs adds the best-matching skill files to the prompt (only when sure)
// Each prompt asks which skill applies; `none` is the right answer when no skill fits.
//   node --experimental-strip-types bench/skills.mjs [model] [out.json]      Env: REPS=1 MODES=base,nomcp,v5
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const [model = 'claude-haiku-5-5', outFile = 'bench/results.skills.json'] = process.argv.slice(2)
const reps = Number(process.env.REPS ?? 1)
const root = mkdtempSync(`${tmpdir()}/armyx-skills-`)
const tools = `${root}/tools`, empty = `${root}/empty`, cwd = `${root}/cwd`
for (const d of [empty, cwd]) mkdirSync(d)
const here = (p) => fileURLToPath(new URL(p, import.meta.url)).replaceAll('\\', '/')
execFileSync('node', ['--experimental-strip-types', '--no-warnings', here('../mcp/tools-to-notes.mjs'), tools, `${homedir()}/.claude/skills`, `${homedir()}/.claude/plugins`], { stdio: 'inherit' })

const cases = [
  ['Merge these three PDF files into one document', 'pdf'],
  ['Turn this sales data into an Excel spreadsheet with formulas', 'xlsx'],
  ['Create a PowerPoint deck for the quarterly review', 'pptx'],
  ['Create a Word document for a contract', 'docx'],
  ['Audit this page against WCAG accessibility rules', 'accessibility-review'],
  ['Write microcopy for an error message and an empty state', 'ux-copy'],
  ['Implement this Figma design as React code', 'figma-design-to-code'],
  ['Synthesize these interview transcripts into themes and insights', 'research-synthesis'],
  ['Review my last commit: is it over-engineered?', 'ponytail-review'],
  ['Draw a sequence diagram of the login flow in FigJam', 'figma-generate-diagram'],
  ['Write a developer handoff spec for this design', 'design-handoff'],
  ['Create a new skill and test it with evals', 'skill-creator'],
  ['Fix the off-by-one bug in my sorting function', 'none'],
  ['What is the capital of France?', 'none'],
]
const ask = (p) => `${p}\n\nIs there a skill for this? Reply with only the skill name (no prefix), or \`none\` if no skill applies. Do not do the task.`

const noMcp = `${root}/no-mcp.json`
writeFileSync(noMcp, '{"mcpServers":{}}')
const hookSettings = `${root}/hook.json`
writeFileSync(hookSettings, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node --experimental-strip-types --no-warnings "${here('../mcp/claude-hook.mjs')}" "${empty}" prompt "${tools}"` }] }] } }))
const modes = {
  base: [],
  nomcp: ['--strict-mcp-config', '--mcp-config', noMcp],
  v5: ['--strict-mcp-config', '--mcp-config', noMcp, '--disable-slash-commands', '--settings', hookSettings],
}
const active = Object.keys(modes).filter((m) => !process.env.MODES || process.env.MODES.split(',').includes(m))

const run = (text, mode) => new Promise((res) => {
  const p = spawn('claude', ['-p', '--output-format', 'json', '--model', model, '--tools', mode === 'v5' ? 'Read' : 'Read,Skill', '--max-budget-usd', '1', '--no-session-persistence', '--max-turns', '4', ...modes[mode]], { cwd })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.on('close', () => {
    try {
      const j = JSON.parse(out), u = j.usage ?? {}
      res({ answer: (j.result ?? '').trim(), turns: j.num_turns, usd: j.total_cost_usd, ms: j.duration_ms,
        input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 })
    } catch { res({ answer: '', turns: 0, usd: 0, input: 0, output: 0, ms: 0, failed: true }) }
  })
  p.stdin.end(text)
})

const warm = {}
for (const m of active) warm[m] = (await run('Reply with OK.', m)).usd
console.log('cache warm-up cost', JSON.stringify(warm))

const jobs = Array.from({ length: reps }, (_, rep) => cases.flatMap(([q, expect]) => active.map((mode) => ({ q, expect, mode, rep })))).flat()
const rows = []
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const { q, expect, mode, rep } = jobs[next++]
    const r = await run(ask(q), mode)
    const last = r.answer.toLowerCase().replace(/[`"'*]/g, '').split(/\s+/).pop() ?? ''
    const ok = expect === 'none' ? last.startsWith('none') : r.answer.toLowerCase().includes(expect)
    rows.push({ q, mode, rep, expect, ok, ...r })
    console.log(mode.padEnd(6), ok ? 'OK  ' : 'MISS', `input=${r.input} $${r.usd?.toFixed(4)}`, JSON.stringify(r.answer.slice(0, 40)), r.failed ? 'FAILED' : '')
  }
}))
const sum = (m, k, f = () => true) => rows.filter((r) => r.mode === m && f(r)).reduce((a, r) => a + (r[k] ?? 0), 0)
for (const m of active) {
  const n = rows.filter((r) => r.mode === m).length
  console.log(m.padEnd(6), 'correct', `${rows.filter((r) => r.mode === m && r.ok).length}/${n}`, 'input/call', Math.round(sum(m, 'input') / n), 'usd', sum(m, 'usd').toFixed(4), 'avg s', (sum(m, 'ms') / n / 1000).toFixed(1))
}
writeFileSync(outFile, JSON.stringify({ model, reps, warm, rows }, null, 2))
