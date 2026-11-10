import { expect, test } from 'vitest'
import { graphMap, links, mapIds, mapVsSource, scoredHits, sliceFor, subMap, sure, tokens, toMarkdown, topHits, trimBatch } from './deso'
import { sse } from './sse'

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

test('map numbers never move: a new file is one more line at the end, so the cached start of the prompt survives', () => {
  const mk = (names: string[]) => names.map((n) => ({ name: n, content: `# ${n}\n?path: src/${n}.ts` }))
  const before = mk(['b', 'c', 'd']), ids = mapIds(before)
  const after = mk(['a', 'b', 'c', 'd']) // the new note sorts first
  const m1 = graphMap(before, undefined, '', { ids }), m2 = graphMap(after, undefined, '', { ids })
  expect(m2).toBe(`${m1}\n4 src/a.ts`)
  expect(graphMap(after).startsWith('1 src/a.ts')).toBe(true) // without the saved numbers every line shifts
  expect(mapIds(after, ids).get('a')).toBe(4)
  expect(mapIds(mk(['__proto__', 'constructor'])).get('__proto__')).toBe(1)
})

test('the files closest to the question say where their definitions are; the static map does not', () => {
  const notes = [
    { name: 'd', content: '# d\n?path: src/deso.ts\n?exports: graphMap\n?spans: tokens:12-16, graphMap:169-206, outline:220-224' },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, content: `# f${i}\n?path: lib/file${i}.ts\n?about: helper number ${i}` })),
  ]
  expect(graphMap(notes, undefined, 'how does graphMap rank notes')).toContain('{graphMap@169-206, tokens@12-16, outline@220-224}')
  expect(graphMap(notes)).not.toContain('@')
  expect(topHits(notes, 'graphMap')).toContain('src/deso.ts {graphMap@169-206')
})

test('subMap: the files a brief names, the files they link to and the files read together with them', () => {
  const notes = [
    { name: 'a', content: '# a\n?path: src/a.ts\n?about: entry\n?spans: mainEntry:3-40\n->@b' },
    { name: 'b', content: '# b\n?path: src/b.ts' }, { name: 'c', content: '# c\n?path: lib/c.ts' }, { name: 'x', content: '# x\n?path: a.ts' },
  ]
  expect(subMap(notes, 'fix the bug in src/a.ts please')).toBe('src/a.ts — entry {mainEntry@3-40}\nsrc/b.ts') // `a.ts` alone is another file
  expect(subMap(notes, 'look at src/a.ts', new Map([['lib/c.ts|src/a.ts', 2]]))).toContain('lib/c.ts')
  expect(subMap(notes, 'look at src/a.ts', new Map([['lib/c.ts|src/a.ts', 1]]))).not.toContain('lib/c.ts') // once is chance
  expect(subMap(notes, 'no file is named here')).toBe('')
})

test('a file agents keep opening earns a line in a map that had no room for it', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `n${i}`, content: `# n${i}\n?path: src/file${i}.ts\n?about: thing ${i}\n->@n${(i + 1) % 300}` }))
  const notes = [...many, { name: 'mail', content: '# mail\n?path: Server/lib/mail.js' }]
  expect(graphMap(notes, 1000)).not.toContain('Server/lib/mail.js')
  expect(graphMap(notes, 1000, '', { heat: new Map([['Server/lib/mail.js', 7]]) })).toContain('Server/lib/mail.js')
})

test('sure: one file far ahead of the rest', () => {
  const notes = [{ name: 'p', content: '# p\n?path: Server/pay.js\n?symbols: PAY_LIMIT' }, ...Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, content: `# f${i}\n?path: lib/file${i}.js\n?about: helper number ${i}` }))]
  expect(sure(notes, 'where is PAY_LIMIT')).toBe(true)
  expect(sure(notes, 'which helper file')).toBe(false)
  expect(sure(notes, 'nothing matches zzz')).toBe(false)
})

test('sliceFor: the lines of the definition a sure question names, nothing when unsure or when the file changed', async () => {
  const notes = [
    { name: 'pay', content: '# pay\n?path: src/pay.ts\n?symbols: PAY_LIMIT, chargeCard\n?spans: chargeCard:2-4, refund:6-8' },
    { name: 'util', content: '# util\n?path: src/util.ts\n?symbols: helper' },
    { name: 'other', content: '# other\n?path: src/other.ts\n?symbols: helperTwo' },
  ]
  const src = 'const PAY_LIMIT = 5\nexport function chargeCard() {\n  return PAY_LIMIT\n}\n\nexport function refund() {\n  return 0\n}'
  expect(await sliceFor(notes, 'what does chargeCard return', async () => src)).toBe('# src/pay.ts lines 2-4\nexport function chargeCard() {\n  return PAY_LIMIT\n}')
  expect(await sliceFor(notes, 'which helper file', async () => src)).toBe('')
  expect(await sliceFor(notes, 'what does chargeCard return', async () => '// rewritten\n' + src)).toBe('')
})

test('trimBatch: the start of the history stays put between overflows', () => {
  const msgs = Array.from({ length: 40 }, (_, i) => ({ i, text: 'x'.repeat(10) })), len = (m: { text: string }) => m.text.length
  const starts = Array.from({ length: 40 }, (_, n) => trimBatch(msgs.slice(0, n + 1), 24, 30000, len)[0].i)
  expect(new Set(starts)).toEqual(new Set([0, 12, 24])) // two moves in 40 messages; one message per turn would move 16 times
  expect(trimBatch(msgs, 24, 30000, len).length).toBe(16)
  expect(trimBatch(msgs, 24, 100, len).map((m) => m.i)).toEqual([36, 37, 38, 39]) // the size limit cuts in the same steps
})

test('sse: JSON of every data line, also when the network cuts a line in two', async () => {
  const body = new ReadableStream({ start(c) { for (const p of ['data: {"a"', ':1}\n\nevent: x\ndata: [DONE]\ndata: {"a":2}\n']) c.enqueue(new TextEncoder().encode(p)); c.close() } })
  const got: number[] = []
  await sse(new Response(body), (j) => got.push(j.a))
  expect(got).toEqual([1, 2])
})
