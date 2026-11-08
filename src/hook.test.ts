import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const hook = new URL('../mcp/claude-hook.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const note = (path: string, about: string) => `# ${path}\n?path: ${path}\n?about: ${about}\n`

const project = () => {
  const p = mkdtempSync(join(tmpdir(), 'hook-'))
  mkdirSync(join(p, '.armyx', 'graph'), { recursive: true })
  writeFileSync(join(p, '.armyx', 'graph', 'a.deso'), note('src/billing.ts', 'invoice and payment rules'))
  writeFileSync(join(p, '.armyx', 'graph', 'b.deso'), note('src/login.ts', 'login and session tokens'))
  writeFileSync(join(p, '.armyx', 'graph', 'c.deso'), note('src/mail.ts', 'outgoing email templates')) // the ranking ignores words in 40%+ of notes, so it needs 3
  return p
}
const run = (p: string, mode: string, input: object = {}, env: Record<string, string> = {}, tools = 'auto') =>
  spawnSync('node', ['--experimental-strip-types', '--no-warnings', hook, 'auto', mode, tools], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: p, HOME: p, USERPROFILE: p, ...env } }).stdout

describe('claude-hook', () => {
  it('gives the map at session start and to subagents (as additionalContext)', () => {
    const p = project()
    expect(run(p, 'session')).toContain('src/billing.ts')
    const sub = JSON.parse(run(p, 'subagent', { agent_type: 'Explore' }))
    expect(sub.hookSpecificOutput.hookEventName).toBe('SubagentStart')
    expect(sub.hookSpecificOutput.additionalContext).toContain('src/login.ts')
  })
  it('limits subagents by agent type when a matcher is set, and survives a bad regex', () => {
    const p = project()
    expect(run(p, 'subagent', { agent_type: 'Plan' }, { ARMYX_SUBAGENT_MATCHER: 'explore|general' })).toBe('')
    expect(run(p, 'subagent', { agent_type: 'Explore' }, { ARMYX_SUBAGENT_MATCHER: 'explore|general' })).toContain('SubagentStart')
    expect(run(p, 'subagent', { agent_type: 'Plan' }, { ARMYX_SUBAGENT_MATCHER: '(' })).toContain('SubagentStart')
  })
  it('is silent when switched off or when there is no graph', () => {
    const p = project()
    expect(run(p, 'session', {}, { ARMYX: '0' })).toBe('')
    writeFileSync(join(p, '.armyx', 'off'), '')
    expect(run(p, 'session')).toBe('')
    expect(run(mkdtempSync(join(tmpdir(), 'hook-empty-')), 'session')).toBe('')
  })
  it('adds best matches for a prompt, and skills only for a prompt with real words', () => {
    const p = project()
    mkdirSync(join(p, '.armyx', 'skills'), { recursive: true })
    writeFileSync(join(p, '.armyx', 'skills', 's.deso'), note('skills/pdf/SKILL.md', 'merge split and fill pdf files'))
    writeFileSync(join(p, '.armyx', 'skills', 't.deso'), note('skills/xlsx/SKILL.md', 'edit spreadsheet files'))
    writeFileSync(join(p, '.armyx', 'skills', 'u.deso'), note('skills/docx/SKILL.md', 'create word documents'))
    const out = run(p, 'prompt', { prompt: 'merge these pdf files' }, { HOME: p }, join(p, '.armyx', 'skills'))
    expect(out).toContain('skills/pdf/SKILL.md')
    expect(run(p, 'prompt', { prompt: 'pdf' }, {}, join(p, '.armyx', 'skills'))).not.toContain('Matching skills')
    expect(run(p, 'prompt', { prompt: 'invoice payment rules' })).toContain('src/billing.ts')
  })
})
