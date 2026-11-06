import { expect, test } from 'vitest'
import { graphMap, links, mapVsSource, tokens, toMarkdown } from './deso'

test('toMarkdown converts props, data, todos and links', () => {
  const { md, kinds } = toMarkdown('?type: core\n!cpu 4GHz\n+done\n-todo ->@kernel')
  expect(md).toBe('---\ntype: core\n---\n| key | value |\n|---|---|\n| cpu | 4GHz |\n- [x] done\n- [ ] todo [[kernel]]')
  expect(Object.keys(kinds).sort()).toEqual(['data', 'props', 'todos'])
})

test('links finds only ->@ links, once each', () => {
  expect(links('->@a @b me@mail.com ->@a')).toEqual(['a'])
})

test('graphMap uses short ids, drops dangling links and respects the budget', () => {
  const notes = [
    { name: 'a', content: '# a\n?path: src/a.ts\n?exports: foo, bar\n->@b ->@ghost' },
    { name: 'b', content: '# b\n' },
  ]
  expect(graphMap(notes)).toBe('1 src/a.ts — [foo, bar] -> 2\n2 b')
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `n${i}`, content: `# n${i}\n?path: some/long/path/file${i}.ts\n->@n${(i + 1) % 300}` }))
  const m = graphMap(many, 1000)
  expect(m).toContain('less connected notes omitted')
  expect(tokens(m)).toBeLessThan(1200)
})

test('mapVsSource compares the map to scanned source size', () => {
  expect(mapVsSource([{ name: 'a', content: '# a' }])).toBeNull()
  const r = mapVsSource([{ name: 'project-map', content: '# project-map\n?source_bytes: 40000' }])
  expect(r?.src).toBe(10000)
})
