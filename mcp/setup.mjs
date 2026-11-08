// One command to wire a project: writes <project>/.claude/settings.local.json (local, not committed) with
//   - the graph hooks (map once per session, best matches and skills per prompt) with no matcher, so a /compact brings the map back
//   - ENABLE_CLAUDEAI_MCP_SERVERS=false, which drops the claude.ai connectors (about 44k tokens per call in our measurement)
// Existing settings are kept; running it twice changes nothing.
//   node mcp/setup.mjs <project dir> <graph dir> [--tools <skill notes dir>] [--keep-connectors]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const hook = fileURLToPath(new URL('./claude-hook.mjs', import.meta.url)).replaceAll('\\', '/')
const ours = (c) => c.includes(hook)

export const configure = (settings, { graph, tools, keepConnectors }) => {
  const cmd = (mode) => `node --experimental-strip-types --no-warnings "${hook}" "${graph}" ${mode}${mode === 'prompt' && tools ? ` "${tools}"` : ''}`
  const out = { ...settings, hooks: { ...settings.hooks }, env: { ...settings.env } }
  for (const [event, mode] of [['SessionStart', 'session'], ['UserPromptSubmit', 'prompt']]) {
    const others = (out.hooks[event] ?? []).filter((g) => !g.hooks?.some((h) => ours(h.command ?? '')))
    out.hooks[event] = [...others, { hooks: [{ type: 'command', command: cmd(mode) }] }]
  }
  if (keepConnectors) delete out.env.ENABLE_CLAUDEAI_MCP_SERVERS
  else out.env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'
  if (!Object.keys(out.env).length) delete out.env
  return out
}

if (process.argv[1]?.endsWith('setup.mjs')) {
  const args = process.argv.slice(2)
  const flag = (f) => args.includes(f)
  const val = (f) => args[args.indexOf(f) + 1]
  const [project, graph] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--tools')
  if (!project || !graph) { console.error('usage: setup.mjs <project dir> <graph dir> [--tools <dir>] [--keep-connectors]'); process.exit(1) }
  const file = join(project, '.claude', 'settings.local.json')
  let current = {}
  try { current = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') { console.error(`${file} is not valid JSON, not touching it`); process.exit(1) } }
  mkdirSync(join(project, '.claude'), { recursive: true })
  writeFileSync(file, JSON.stringify(configure(current, { graph: resolve(graph).replaceAll('\\', '/'), tools: flag('--tools') ? resolve(val('--tools')).replaceAll('\\', '/') : undefined, keepConnectors: flag('--keep-connectors') }), null, 2) + '\n')
  console.log(`wrote ${file}`)
}
