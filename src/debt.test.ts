import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs without types
import { findDebt } from '../mcp/debt.mjs'

describe('findDebt', () => {
  it('finds shortcut: comments in several comment styles, with line numbers', () => {
    const src = ['let a = 1 // shortcut: no cache, add one past 1k rows', '# shortcut: regex, not a parser', '/* shortcut: one file */', ' * shortcut: javadoc style', 'const text = "shortcut: inside a string"'].join('\n')
    expect(findDebt(src, 'x.ts')).toEqual([
      { file: 'x.ts', line: 1, text: 'no cache, add one past 1k rows' },
      { file: 'x.ts', line: 2, text: 'regex, not a parser' },
      { file: 'x.ts', line: 3, text: 'one file' },
      { file: 'x.ts', line: 4, text: 'javadoc style' },
    ])
  })
})
