import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from './download'

describe('downloadTextFile', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-url')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  it('clicks a temporary anchor with the filename and a blob URL, then revokes it', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })

    downloadTextFile('notes.md', '# Hi')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('notes.md')
    expect(clicked[0].href).toBe('blob:mock-url')
    expect(document.querySelector('a[download]')).toBeNull()

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('uses a custom mime type when given', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadTextFile('a.txt', 'x', 'text/plain')
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('text/plain')
  })
})
