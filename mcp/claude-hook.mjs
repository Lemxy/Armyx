// Claude Code hook that gives the agent the map (mode v3 of the benchmark) instead of graph tools:
//   session  (SessionStart)      prints the graph map once per session
//   pretool  (PreToolUse, matcher "Grep|Glob")  denies project search so the agent works from the map and Reads files (opt-in)
//   readgate (PreToolUse, matcher "Read")  denies a whole-file Read of a big file (READ_GATE_BYTES, default 30000): ask for offset/limit instead.
//             NOT RECOMMENDED: measured on a 29 KB file (limit 20000) it cost 1-2 extra turns, no saving
//   prompt   (UserPromptSubmit)  prints the best-matching files for the user's prompt
// Hook stdout is added to the agent's context. Run: node --experimental-strip-types mcp/claude-hook.mjs <graph dir> session|prompt|pretool
import { readFileSync, statSync } from 'node:fs'
import { loadNotes } from './load.mjs'
import { MAP_INTRO, SMALL_PROJECT, graphMap, sureHits, topHits } from '../src/deso.ts'

const [dir, mode, toolsDir] = process.argv.slice(2) // toolsDir (optional): notes made by mcp/tools-to-notes.mjs
if (mode === 'pretool') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Project search is disabled. The map and "Best matches" in your context name the files (with what each uses and what uses it); Read the file you need.' } }))
  process.exit(0)
}
if (mode === 'readgate') {
  let t = {}
  try { t = JSON.parse(readFileSync(0, 'utf8')).tool_input ?? {} } catch {} // a broken payload must not block the Read
  let big = false
  try { big = t.offset === undefined && t.limit === undefined && statSync(t.file_path).size > Number(process.env.READ_GATE_BYTES ?? 30000) } catch {} // unreadable path: let Read report it
  if (big) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'File is big. Read it with offset and limit (use Grep or the map to find the lines first); a whole-file Read costs thousands of tokens on every later turn.' } }))
  process.exit(0)
}
const load = loadNotes
const notes = load(dir)
// big project: no map, and best matches only when sure (measured: anything more costs more than plain search); small: lean map and hits
const big = notes.length > SMALL_PROJECT
if (mode === 'session') { if (!big) process.stdout.write(`${MAP_INTRO}\n\n# Graph map\n${graphMap(notes, 2500)}\n`) }
else if (mode === 'prompt') {
  let prompt = ''
  try { prompt = JSON.parse(readFileSync(0, 'utf8')).prompt ?? '' } catch {} // a broken payload must not block the user's prompt
  const hits = prompt.trim() ? (big ? sureHits(notes, prompt) : topHits(notes, prompt)) : ''
  if (hits) process.stdout.write(`# Best matches\n${hits}\n`)
  // top 3 even when not sure: skills are few and a wrong hint costs one line (measured: the sure-only rule dropped routing from 13/14 to 7/14)
  const skills = toolsDir && prompt.trim() ? topHits(load(toolsDir), prompt, 3) : ''
  if (skills) process.stdout.write(`# Matching skills (Read the file for its instructions)\n${skills}\n`)
} else { console.error('mode must be session, prompt or pretool'); process.exit(1) }
