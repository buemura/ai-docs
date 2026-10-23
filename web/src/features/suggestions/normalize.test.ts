import { describe, expect, it } from 'vitest'
import { normalizeProposal } from './normalize'

describe('normalizeProposal', () => {
  it('returns plain proposals unchanged when newline presence matches', () => {
    expect(normalizeProposal('Hello\n', 'Hi\n')).toBe('Hello\n')
    expect(normalizeProposal('Hello', 'Hi')).toBe('Hello')
  })

  it('strips a wrapping markdown fence', () => {
    expect(normalizeProposal('```markdown\nHello\n```', 'Hi\n')).toBe('Hello\n')
    expect(normalizeProposal('```\nHello\nWorld\n```\n', 'Hi\n')).toBe('Hello\nWorld\n')
    expect(normalizeProposal('```md\nHello\n```', 'Hi')).toBe('Hello')
  })

  it('keeps fences when the original text is itself a code block', () => {
    expect(normalizeProposal('```\ny = 2\n```', '```\ny = 1\n```')).toBe('```\ny = 2\n```')
  })

  it('does not strip fences in other languages', () => {
    expect(normalizeProposal('```js\nx\n```', 'Hi')).toBe('```js\nx\n```')
  })

  it('matches the trailing newline of the original', () => {
    expect(normalizeProposal('Hello', 'Hi\n')).toBe('Hello\n')
    expect(normalizeProposal('Hello\n\n', 'Hi')).toBe('Hello')
  })

  it('converts CRLF to LF', () => {
    expect(normalizeProposal('a\r\nb\r\n', 'x\n')).toBe('a\nb\n')
  })
})
