import { describe, expect, it } from 'vitest'
import { exportFilename } from './exportFilename'

describe('exportFilename', () => {
  it.each([
    ['# Hello World\n\nBody', 'hello-world.md'],
    ['Intro line\n\n# My Doc\n', 'my-doc.md'],
    ['# Title ##', 'title.md'],
    ['# Café & Crème!', 'cafe-creme.md'],
    ['#   Spaced   Out  ', 'spaced-out.md'],
  ])('slugs the first H1: %j → %s', (content, expected) => {
    expect(exportFilename(content)).toBe(expected)
  })

  it.each([[''], ['No heading at all'], ['## Only a subheading'], ['#NoSpace'], ['# !!!']])(
    'falls back to document.md for %j',
    (content) => {
      expect(exportFilename(content)).toBe('document.md')
    },
  )

  it('caps the slug at 80 characters without a trailing dash', () => {
    const name = exportFilename(`# ${'word '.repeat(40)}`)
    const slug = name.replace(/\.md$/, '')
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })
})
