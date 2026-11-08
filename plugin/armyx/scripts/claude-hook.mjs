// Claude Code hook that gives the agent the map (mode v3 of the benchmark) instead of graph tools:
//   session  (SessionStart)      prints the graph map once per session (no matcher: /compact brings it back)
//   subagent (SubagentStart)     the same map for each subagent, which never sees SessionStart context
//                                ARMYX_SUBAGENT_MATCHER=<regex> limits it to agent types that match (e.g. "explore|general")
//   prompt   (UserPromptSubmit)  prints the best-matching files, and with a skills dir the best-matching skills
//   pretool  (PreToolUse, matcher "Grep|Glob")  denies project search so the agent works from the map and Reads files (opt-in)
//   readgate (PreToolUse, matcher "Read")  denies a whole-file Read of a big file (READ_GATE_BYTES, default 30000): ask for offset/limit instead.
//             NOT RECOMMENDED: measured on a 29 KB file (limit 20000) it cost 1-2 extra turns, no saving
// "auto" as graph dir = <project>/.armyx/graph, as skills dir = ~/.armyx/skills. Off switch: a file <project>/.armyx/off or ARMYX=0.
// Hook stdout is added to the agent's context. Run: node --experimental-strip-types mcp/claude-hook.mjs <graph dir|auto> <mode> [skills dir|auto]
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadNotes } from './load.mjs'
import { MAP_INTRO, SMALL_PROJECT, graphMap, sureHits, terms, topHits } from './deso.ts'

const [graphArg, mode, toolsArg] = process.argv.slice(2)
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const dir = graphArg === 'auto' ? process.env.ARMYX_GRAPH || join(project, '.armyx', 'graph') : graphArg // ARMYX_GRAPH keeps a graph outside the project
const toolsDir = toolsArg === 'auto' ? join(homedir(), '.armyx', 'skills') : toolsArg
if (process.env.ARMYX === '0' || existsSync(join(project, '.armyx', 'off'))) process.exit(0)

const payload = () => { try { return JSON.parse(readFileSync(0, 'utf8')) } catch { return {} } } // a broken payload must not block the user
const say = (event, context) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }))

if (mode === 'pretool') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Project search is disabled. The map and "Best matches" in your context name the files (with what each uses and what uses it); Read the file you need.' } }))
  process.exit(0)
}
if (mode === 'readgate') {
  const t = payload().tool_input ?? {}
  let big = false
  try { big = t.offset === undefined && t.limit === undefined && statSync(t.file_path).size > Number(process.env.READ_GATE_BYTES ?? 30000) } catch {} // unreadable path: let Read report it
  if (big) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'File is big. Read it with offset and limit (use Grep or the map to find the lines first); a whole-file Read costs thousands of tokens on every later turn.' } }))
  process.exit(0)
}
const notes = loadNotes(dir)
// big project: no map, and best matches only when sure (measured: anything more costs more than plain search); small: lean map and hits
const big = notes.length > SMALL_PROJECT
const map = () => `${MAP_INTRO}\n\n# Graph map\n${graphMap(notes, 2500)}\n`
if (mode === 'session') { if (!big && notes.length) process.stdout.write(map()) }
else if (mode === 'subagent') {
  let wanted = true
  try { if (process.env.ARMYX_SUBAGENT_MATCHER) wanted = new RegExp(process.env.ARMYX_SUBAGENT_MATCHER, 'i').test(payload().agent_type ?? '') } catch {} // a bad regex means "no filter"
  if (wanted && !big && notes.length) say('SubagentStart', map())
} else if (mode === 'prompt') {
  const prompt = payload().prompt ?? ''
  const hits = prompt.trim() && notes.length ? (big ? sureHits(notes, prompt) : topHits(notes, prompt)) : ''
  if (hits) process.stdout.write(`# Best matches\n${hits}\n`)
  // top 3 even when not sure: skills are few and a wrong hint costs one line (measured: the sure-only rule dropped routing from 13/14 to 7/14).
  // Skipped for a prompt of fewer than 2 real words ("hi", "ok thanks"): nothing to match, and the hint would only add noise.
  const real = terms(prompt).filter((w) => w.length > 2).length >= 2
  const skills = toolsDir && real ? topHits(loadNotes(toolsDir), prompt, 3) : ''
  if (skills) process.stdout.write(`# Matching skills (Read the file for its instructions)\n${skills}\n`)
} else { console.error('mode must be session, subagent, prompt, pretool or readgate'); process.exit(1) }
