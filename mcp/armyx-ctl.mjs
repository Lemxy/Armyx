// Behind the /armyx commands (they run it before the model sees anything, so a command costs no tokens).
//   status             on or off, how many notes the project graph and the skills index have
//   on | off           the hooks speak or stay silent in this project (a file .armyx/off)
//   skills [dir...]    index SKILL.md files (default: ~/.claude/skills and ~/.claude/plugins) into ~/.armyx/skills
//   connectors off|on  drop (or restore) the claude.ai connectors for this project: ~44k tokens per call in our measurement
//   scan               rebuild the project graph (needs the Armyx repo: set ARMYX_REPO to it; its scanner is Rust)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNotes } from './load.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const flag = join(project, '.armyx', 'off')
const settings = join(project, '.claude', 'settings.local.json')
const skillsDir = join(homedir(), '.armyx', 'skills')
const KEY = 'ENABLE_CLAUDEAI_MCP_SERVERS'

export const connectors = (current, on) => {
  const env = { ...current.env }
  if (on) delete env[KEY]; else env[KEY] = 'false'
  const out = { ...current, env }
  if (!Object.keys(env).length) delete out.env
  return out
}

const [cmd, ...rest] = process.argv.slice(2)
if (process.argv[1]?.endsWith('armyx-ctl.mjs')) {
  if (cmd === 'on') { rmSync(flag, { force: true }); console.log('armyx: on') }
  else if (cmd === 'off') { mkdirSync(dirname(flag), { recursive: true }); writeFileSync(flag, ''); console.log('armyx: off for this project') }
  else if (cmd === 'skills') {
    const dirs = rest.length ? rest : [join(homedir(), '.claude', 'skills'), join(homedir(), '.claude', 'plugins')]
    execFileSync('node', ['--experimental-strip-types', '--no-warnings', join(here, 'tools-to-notes.mjs'), skillsDir, ...dirs], { stdio: 'inherit' })
  } else if (cmd === 'connectors' && (rest[0] === 'on' || rest[0] === 'off')) {
    let current = {}
    try { current = JSON.parse(readFileSync(settings, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') { console.error(`${settings} is not valid JSON, not touching it`); process.exit(1) } }
    mkdirSync(dirname(settings), { recursive: true })
    writeFileSync(settings, JSON.stringify(connectors(current, rest[0] === 'on'), null, 2) + '\n')
    console.log(`armyx: claude.ai connectors ${rest[0] === 'on' ? 'allowed' : 'dropped'} for this project (takes effect in a new session)`)
  } else if (cmd === 'scan') {
    const repo = process.env.ARMYX_REPO
    if (!repo || !existsSync(join(repo, 'src-tauri'))) { console.log('armyx: scanning needs the Armyx repo (its scanner is Rust). Set ARMYX_REPO to it, then run this again.'); process.exit(0) }
    execFileSync('cargo', ['run', '-q', '--example', 'scan', '--', project, join(project, '.armyx', 'graph')], { cwd: join(repo, 'src-tauri'), stdio: 'inherit' })
  } else if (cmd === 'status' || cmd === undefined) {
    console.log(`armyx: ${existsSync(flag) ? 'off' : 'on'} | graph ${loadNotes(join(project, '.armyx', 'graph')).length} notes | skills ${loadNotes(skillsDir).length} notes`)
  } else { console.error('usage: status | on | off | skills [dir...] | connectors on|off | scan'); process.exit(1) }
}
