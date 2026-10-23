import { describe, expect, it } from 'vitest'
import { AI_PRESETS, ASK_SLASH, blockRangeAt, resolvePresetTarget, type AiPreset } from './presets'

describe('AI_PRESETS', () => {
  it('has unique ids and slash names', () => {
    const ids = AI_PRESETS.map((p) => p.id)
    const slashes = AI_PRESETS.map((p) => p.slash)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slashes).size).toBe(slashes.length)
  })

  it('uses lowercase dash-separated slash names and never the reserved ask name', () => {
    for (const preset of AI_PRESETS) {
      expect(preset.slash).toMatch(/^[a-z][a-z-]*$/)
      expect(preset.slash).not.toBe(ASK_SLASH)
      expect(preset.instruction.trim().length).toBeGreaterThan(10)
    }
  })

  it('includes the core writing presets', () => {
    expect(AI_PRESETS.map((p) => p.id)).toEqual([
      'improve',
      'fix',
      'shorten',
      'expand',
      'tone-professional',
      'tone-casual',
      'tone-friendly',
      'restructure',
      'tldr',
    ])
  })
})

describe('blockRangeAt', () => {
  const doc = 'a\nb\n\nc'

  it('returns the multi-line paragraph containing the position', () => {
    expect(blockRangeAt(doc, 0)).toEqual({ from: 0, to: 3 })
    expect(blockRangeAt(doc, 2)).toEqual({ from: 0, to: 3 })
  })

  it('returns a later paragraph', () => {
    expect(blockRangeAt(doc, 5)).toEqual({ from: 5, to: 6 })
    expect(blockRangeAt(doc, 6)).toEqual({ from: 5, to: 6 })
  })

  it('returns an empty range on a blank line', () => {
    expect(blockRangeAt(doc, 4)).toEqual({ from: 4, to: 4 })
  })

  it('excludes the trailing newline and the heading above', () => {
    const text = '# T\n\npara one\npara two\n'
    expect(blockRangeAt(text, 8)).toEqual({ from: 5, to: 22 })
    expect(text.slice(5, 22)).toBe('para one\npara two')
  })

  it('treats whitespace-only lines as blank', () => {
    const text = 'one\n   \ntwo'
    expect(blockRangeAt(text, 9)).toEqual({ from: 8, to: 11 })
  })

  it('clamps out-of-range positions', () => {
    expect(blockRangeAt('abc', 99)).toEqual({ from: 0, to: 3 })
    expect(blockRangeAt('abc', -5)).toEqual({ from: 0, to: 3 })
    expect(blockRangeAt('', 0)).toEqual({ from: 0, to: 0 })
  })
})

describe('resolvePresetTarget', () => {
  const content = 'First para.\n\nSecond para.'
  const blockPreset: AiPreset = {
    id: 'b',
    label: 'B',
    slash: 'b',
    instruction: 'Do the block thing.',
    target: 'block',
  }
  const docPreset: AiPreset = { ...blockPreset, id: 'd', slash: 'd', target: 'document' }
  const autoPreset: AiPreset = { ...blockPreset, id: 'a', slash: 'a', target: 'auto' }

  it('prefers a non-empty selection for every preset kind', () => {
    const selection = { from: 0, to: 5 }
    expect(resolvePresetTarget(blockPreset, content, selection)).toEqual({ from: 0, to: 5 })
    expect(resolvePresetTarget(docPreset, content, selection)).toEqual({ from: 0, to: 5 })
    expect(resolvePresetTarget(autoPreset, content, selection)).toEqual({ from: 0, to: 5 })
  })

  it('resolves block presets to the paragraph at the cursor', () => {
    expect(resolvePresetTarget(blockPreset, content, { from: 15, to: 15 })).toEqual({
      from: 13,
      to: 25,
    })
  })

  it('falls back to the whole document when the cursor is on a blank line', () => {
    expect(resolvePresetTarget(blockPreset, content, { from: 12, to: 12 })).toBe('document')
  })

  it('passes document and auto targets through when nothing is selected', () => {
    expect(resolvePresetTarget(docPreset, content, { from: 3, to: 3 })).toBe('document')
    expect(resolvePresetTarget(autoPreset, content, { from: 3, to: 3 })).toBe('auto')
  })
})
