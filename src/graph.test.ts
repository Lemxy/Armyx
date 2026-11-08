import { expect, test } from 'vitest'
import { communities, layout } from './layout'

test('layout puts each note right of the notes linking to it, and survives cycles', () => {
  const p = layout(['a', 'b', 'c', 'd'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a' }])
  expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c', 'd'])
  expect(p.b.x).toBeGreaterThan(p.a.x)
  expect(p.c.x).toBeGreaterThan(p.b.x)
})

test('communities split two clusters and name each by its hub', () => {
  const clique = (ns: string[]) => ns.flatMap((a, i) => ns.slice(i + 1).map((b) => ({ from: a, to: b })))
  const A = ['a1', 'a2', 'a3', 'a4'], B = ['b1', 'b2', 'b3', 'b4']
  const c = communities([...A, ...B, 'solo'], [...clique(A), ...clique(B), { from: 'a1', to: 'b1' }])
  expect(c.map((g) => g.members.length)).toEqual([4, 4])
  expect(c.flatMap((g) => g.members)).not.toContain('solo')
})
