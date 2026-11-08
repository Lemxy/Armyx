import { expect, test } from 'vitest'
import { graphMap, links, mapVsSource, scoredHits, tokens, toMarkdown } from './deso'

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

test('graphMap: focus lifts a leaf note, shortened lines keep every note findable', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `n${i}`, content: `# n${i}\n?path: src/file${i}.ts\n?about: thing ${i}\n->@n${(i + 1) % 300}` }))
  const leaf = { name: 'mail', content: '# mail\n?path: Server/lib/mail.js\n?about: Outgoing e-mail (reset codes).' }
  const notes = [...many, leaf]
  expect(graphMap(notes, 1000)).not.toContain('Server/lib/mail.js')
  expect(graphMap(notes, 1000, 'which file sends emails?')).toContain('Server/lib/mail.js — Outgoing e-mail')
  const m = graphMap(many.slice(0, 120), 3000)
  expect(m.split('\n').filter((l) => !l.includes('->')).length).toBeGreaterThan(0) // some shortened lines
})

test('scoredHits: symbols and camelCase terms are searchable, intent words steer, config files lose', () => {
  const note = (name: string, path: string, extra = '') => ({ name, content: `# ${name}\n?path: ${path}\n${extra}` })
  const notes = [
    note('pay', 'Server/routes/pay.js', '?symbols: /api/pay/create, PAY_LIMIT'),
    note('auth', 'NovaLauncher/src-tauri/src/auth.rs', '?symbols: auth_create_payment'),
    note('ctx', 'NovaLauncher/src/core/AuthContext.tsx', '?about: login state'),
    note('tc', 'NovaLauncher/rust-toolchain.toml', '?about: rust toolchain pin'),
    ...Array.from({ length: 10 }, (_, i) => note(`f${i}`, `Server/lib/file${i}.js`, `?about: helper number ${i}`)),
  ]
  const top = (q: string) => scoredHits(notes, q)[0]?.note.name
  expect(top('which file defines /api/pay/create?')).toBe('pay')
  expect(top('where is auth_create_payment')).toBe('auth')
  expect(top('the auth context component')).toBe('ctx')
  expect(top('which Rust file pins the toolchain')).toBe('tc') // asked for explicitly, so it is not penalised
  expect(top('which Rust file does the auth payment')).toBe('auth')
})
