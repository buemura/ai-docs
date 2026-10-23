import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentProvider, useDocument } from './DocumentProvider'
import { initialContent } from './initialContent'
import { DOCUMENT_STORAGE_KEY } from './schema'

const wrapper = ({ children }: { children: ReactNode }) => (
  <DocumentProvider>{children}</DocumentProvider>
)

function stored(): { content: string; updatedAt: number } | null {
  const raw = localStorage.getItem(DOCUMENT_STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

describe('DocumentProvider', () => {
  describe('loading', () => {
    it('uses the welcome content when nothing is stored', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      expect(result.current.content).toBe(initialContent)
      expect(result.current.selection).toEqual({ from: 0, to: 0 })
    })

    it('restores stored content', () => {
      localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content: 'Saved', updatedAt: 1 }))
      const { result } = renderHook(() => useDocument(), { wrapper })
      expect(result.current.content).toBe('Saved')
    })

    it('ignores invalid stored data', () => {
      localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content: 42 }))
      const { result } = renderHook(() => useDocument(), { wrapper })
      expect(result.current.content).toBe(initialContent)
    })
  })

  describe('editing', () => {
    beforeEach(() => {
      localStorage.setItem(
        DOCUMENT_STORAGE_KEY,
        JSON.stringify({ content: 'Hello world', updatedAt: 1 }),
      )
    })

    it('setContent replaces the content and clamps the selection', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setSelection({ from: 6, to: 11 }))
      act(() => result.current.setContent('Hi'))
      expect(result.current.content).toBe('Hi')
      expect(result.current.selection).toEqual({ from: 2, to: 2 })
    })

    it('setSelection clamps and orders the range', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setSelection({ from: 50, to: 3 }))
      expect(result.current.selection).toEqual({ from: 3, to: 11 })
    })

    it('replaceRange splices text and collapses the selection after it', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.replaceRange({ from: 6, to: 11 }, 'there'))
      expect(result.current.content).toBe('Hello there')
      expect(result.current.selection).toEqual({ from: 11, to: 11 })
    })

    it('replaceRange applies to the latest content when called twice in one batch', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => {
        result.current.replaceRange({ from: 0, to: 5 }, 'Howdy')
        result.current.replaceRange({ from: 11, to: 11 }, '!')
      })
      expect(result.current.content).toBe('Howdy world!')
    })
  })

  describe('autosave', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('saves 300 ms after the last change', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setContent('Draft'))
      act(() => vi.advanceTimersByTime(299))
      expect(stored()).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(stored()).toEqual({
        content: 'Draft',
        updatedAt: Date.parse('2026-01-01T00:00:00.300Z'),
      })
    })

    it('restarts the debounce on every change', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setContent('a'))
      act(() => vi.advanceTimersByTime(200))
      act(() => result.current.setContent('ab'))
      act(() => vi.advanceTimersByTime(200))
      expect(stored()).toBeNull()
      act(() => vi.advanceTimersByTime(100))
      expect(stored()?.content).toBe('ab')
    })

    it('flushes immediately on pagehide', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setContent('Leaving'))
      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })
      expect(stored()?.content).toBe('Leaving')
    })
  })

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useDocument())).toThrow(/DocumentProvider/)
  })
})
