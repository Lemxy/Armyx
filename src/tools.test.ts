import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs without types
import { parseSkill, toNote } from '../mcp/tools-to-notes.mjs'
import { sureHits } from './deso'

const skill = (name: string, d: string) => ({ name: `skill-${name}`, content: toNote(parseSkill(`---\nname: ${name}\ndescription: ${d}\n---\nbody`)) })

describe('skill notes', () => {
  it('parses frontmatter and drops files without a description', () => {
    expect(parseSkill('---\nname: a\ndescription: "say \\"hi\\""\n---')).toEqual({ name: 'a', about: 'say "hi"' })
    expect(parseSkill('no frontmatter')).toBeNull()
  })
  it('finds the skill that fits the prompt, and none for an unrelated one', () => {
    const notes = [skill('pdf', 'merge split and fill PDF files'), skill('xlsx', 'edit spreadsheet files'), skill('docx', 'create Word documents')]
    expect(sureHits(notes, 'merge these pdf files', 3)).toContain('skill:pdf')
    expect(sureHits(notes, 'fix the login bug', 3)).toBe('')
  })
})
