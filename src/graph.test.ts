import { expect, test } from 'vitest'
import { layout } from './layout'

test('layout puts each note right of the notes linking to it, and survives cycles', () => {
  const p = layout(['a', 'b', 'c', 'd'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a' }])
  expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c', 'd'])
  expect(p.b.x).toBeGreaterThan(p.a.x)
  expect(p.c.x).toBeGreaterThan(p.b.x)
})
