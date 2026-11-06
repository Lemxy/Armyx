import { expect, test } from 'vitest'
import { graphMap, links, mapVsSource, toMarkdown } from './deso'

test('toMarkdown converts props, data, todos and links', () => {
  const { md, kinds } = toMarkdown('?type: core\n!cpu 4GHz\n+done\n-todo ->@kernel')
  expect(md).toBe('---\ntype: core\n---\n| key | value |\n|---|---|\n| cpu | 4GHz |\n- [x] done\n- [ ] todo [[kernel]]')
  expect(Object.keys(kinds).sort()).toEqual(['data', 'props', 'todos'])
})

test('links finds only ->@ links, once each', () => {
  expect(links('->@a @b me@mail.com ->@a')).toEqual(['a'])
})

test('graphMap lists path, exports and only existing links', () => {
  const notes = [
    { name: 'a', content: '# a\n?path: src/a.ts\n?exports: foo, bar\n->@b ->@ghost' },
    { name: 'b', content: '# b\n' },
  ]
  expect(graphMap(notes)).toBe('a: src/a.ts — [foo, bar] -> b\nb: b')
})

test('mapVsSource compares the map to scanned source size', () => {
  expect(mapVsSource([{ name: 'a', content: '# a' }])).toBeNull()
  const r = mapVsSource([{ name: 'project-map', content: '# project-map\n?source_bytes: 40000' }])
  expect(r?.src).toBe(10000)
})
