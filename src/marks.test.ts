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
    expect(staleSchema([{ name: 'project-map', content: '# project-map\n?schema: 3\n' }])).toBe(false)
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
