import { describe, expect, it } from 'vitest'
import { diverse, staleSchema, topHits, type Note } from './deso'

const note = (name: string, path: string, extra = '') => ({ name, content: `# ${path}\n?path: ${path}\n?about: ${name} checkout rules\n${extra}` }) as Note

describe('link marks', () => {
  it('shows links named in the source before guessed (~) ones', () => {
    const n = note('shop', 'shop.py', '?calls: ~a.py(X), b.py(Y), ~c.py(Z)\n?callers: ~d.py, e.py\n')
    const line = topHits([n, note('x1', 'x1.py'), note('x2', 'x2.py')], 'shop checkout')
    expect(line).toContain('uses b.py(Y), ~a.py(X), ~c.py(Z)')
    expect(line).toContain('used by e.py, ~d.py')
  })
  it('flags a graph from an older scanner', () => {
    expect(staleSchema([{ name: 'project-map', content: '# project-map\n' }])).toBe(true)
    expect(staleSchema([{ name: 'project-map', content: '# project-map\n?schema: 2\n' }])).toBe(false)
    expect(staleSchema([{ name: 'a', content: '# a\n' }])).toBe(false) // a hand-written vault has no project-map
  })
})

describe('diverse', () => {
  const ranked = [...'abcdef'].map((c) => note(c, `gen/${c}.ts`)).concat(note('z', 'src/z.ts'))
  it('keeps one folder from filling the list, then fills up with the rest', () => {
    expect(diverse(ranked, 4, 2).map((n) => n.name)).toEqual(['a', 'b', 'z', 'c'])
    expect(diverse(ranked, 4, 2, false).map((n) => n.name)).toEqual(['a', 'b', 'c', 'd'])
  })
})

import { vi } from 'vitest'
// @ts-expect-error plain .mjs without types
import { debounced } from '../mcp/watch.mjs'

describe('debounced', () => {
  it('runs once after a burst of calls', () => {
    vi.useFakeTimers()
    const fn = vi.fn(), d = debounced(fn, 3000)
    d(); vi.advanceTimersByTime(2000); d(); vi.advanceTimersByTime(2999)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

// @ts-expect-error plain .mjs without types
import { configure } from '../mcp/setup.mjs'

describe('setup', () => {
  const opts = { graph: '/g', tools: '/t' }
  it('adds the hooks without a matcher and drops the connectors', () => {
    const s = configure({}, opts)
    expect(s.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false')
    expect(s.hooks.SessionStart[0].matcher).toBeUndefined()
    expect(s.hooks.SubagentStart[0].hooks[0].command).toContain('"/g" subagent')
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toContain('"/g" prompt "/t"')
  })
  it('is idempotent and keeps what was there', () => {
    const own = { hooks: [{ type: 'command', command: 'echo mine' }] }
    const once = configure({ permissions: { allow: ['Read'] }, env: { A: '1' }, hooks: { SessionStart: [own] } }, opts)
    expect(configure(once, opts)).toEqual(once)
    expect(once.permissions.allow).toEqual(['Read'])
    expect(once.env.A).toBe('1')
    expect(once.hooks.SessionStart).toHaveLength(2)
    expect(configure(once, { ...opts, keepConnectors: true }).env).toEqual({ A: '1' })
  })
})

// @ts-expect-error plain .mjs without types
import { SKIP } from '../mcp/watch.mjs'

describe('watch filter', () => {
  it('ignores build and vendor folders with both path separators, not source', () => {
    for (const p of ['node_modules/x/i.js', 'node_modules\\x\\i.js', 'src-tauri\\target\\debug\\a.rs', '.git/HEAD']) expect(SKIP.test(p)).toBe(true)
    for (const p of ['src/App.tsx', 'src\\targets.ts', 'distance.py']) expect(SKIP.test(p)).toBe(false)
  })
})
