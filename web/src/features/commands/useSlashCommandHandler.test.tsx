import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AI_PRESETS } from './presets'
import { useSlashCommandHandler } from './useSlashCommandHandler'

const fix = AI_PRESETS.find((p) => p.id === 'fix')!

function setup(initialContent: string) {
  const runPresetAt = vi.fn()
  const onAsk = vi.fn()
  const hook = renderHook(
    ({ content }: { content: string }) => useSlashCommandHandler({ content, runPresetAt, onAsk }),
    { initialProps: { content: initialContent } },
  )
  return { ...hook, runPresetAt, onAsk }
}

describe('useSlashCommandHandler', () => {
  it('waits until the document content reflects the deleted slash text', () => {
    const { result, rerender, runPresetAt } = setup('Para\n/fix')
    act(() => result.current({ kind: 'preset', preset: fix, content: 'Para\n', cursor: 5 }))
    expect(runPresetAt).not.toHaveBeenCalled()

    rerender({ content: 'Para\n' })
    expect(runPresetAt).toHaveBeenCalledTimes(1)
    expect(runPresetAt).toHaveBeenCalledWith(fix, 5)

    rerender({ content: 'Para\n' })
    expect(runPresetAt).toHaveBeenCalledTimes(1)
  })

  it('runs immediately when the content is already in sync', () => {
    const { result, runPresetAt } = setup('Para\n')
    act(() => result.current({ kind: 'preset', preset: fix, content: 'Para\n', cursor: 5 }))
    expect(runPresetAt).toHaveBeenCalledWith(fix, 5)
  })

  it('calls onAsk for /ask', () => {
    const { result, rerender, onAsk, runPresetAt } = setup('Hi /ask')
    act(() => result.current({ kind: 'ask', content: 'Hi ', cursor: 3 }))
    rerender({ content: 'Hi ' })
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(runPresetAt).not.toHaveBeenCalled()
  })

  it('returns a stable handler', () => {
    const { result, rerender } = setup('a')
    const first = result.current
    rerender({ content: 'b' })
    expect(result.current).toBe(first)
  })
})
