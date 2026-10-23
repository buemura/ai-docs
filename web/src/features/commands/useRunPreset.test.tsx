import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useSuggestion } from '../suggestions/SuggestionProvider'
import { AI_PRESETS } from './presets'
import { useRunPreset } from './useRunPreset'

vi.mock('../document/DocumentProvider', () => ({ useDocument: vi.fn() }))
vi.mock('../ai/ModelProvider', () => ({ useModels: vi.fn() }))
vi.mock('../suggestions/SuggestionProvider', () => ({ useSuggestion: vi.fn() }))

const content = 'First para.\n\nSecond para.'
const improve = AI_PRESETS.find((p) => p.id === 'improve')!
const restructure = AI_PRESETS.find((p) => p.id === 'restructure')!
const start = vi.fn()

function mockDocument(selection = { from: 15, to: 15 }) {
  vi.mocked(useDocument).mockReturnValue({
    content,
    selection,
    setContent: vi.fn(),
    setSelection: vi.fn(),
    replaceRange: vi.fn(),
  } as ReturnType<typeof useDocument>)
}

function mockModels(overrides: Partial<ReturnType<typeof useModels>> = {}) {
  vi.mocked(useModels).mockReturnValue({
    models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }],
    selectedModel: 'claude-sonnet-5-5',
    setSelectedModel: vi.fn(),
    status: 'ready',
    ...overrides,
  } as ReturnType<typeof useModels>)
}

function mockSuggestion(isBusy = false) {
  vi.mocked(useSuggestion).mockReturnValue({
    suggestion: null,
    isBusy,
    start,
    stop: vi.fn(),
    retry: vi.fn(),
    refine: vi.fn(),
    setHunkStatus: vi.fn(),
    acceptAll: vi.fn(),
    rejectAll: vi.fn(),
    discard: vi.fn(),
  } as ReturnType<typeof useSuggestion>)
}

describe('useRunPreset', () => {
  beforeEach(() => {
    start.mockReset()
    mockDocument()
    mockModels()
    mockSuggestion()
  })

  it('starts a block preset on the paragraph at the cursor', () => {
    const { result } = renderHook(() => useRunPreset())
    expect(result.current.canRun).toBe(true)
    result.current.runPreset(improve)
    expect(start).toHaveBeenCalledWith({
      instruction: improve.instruction,
      target: { from: 13, to: 25 },
    })
  })

  it('uses a non-empty selection as the target', () => {
    mockDocument({ from: 0, to: 5 })
    const { result } = renderHook(() => useRunPreset())
    result.current.runPreset(restructure)
    expect(start).toHaveBeenCalledWith({
      instruction: restructure.instruction,
      target: { from: 0, to: 5 },
    })
  })

  it('runPresetAt resolves the target from the given cursor', () => {
    mockDocument({ from: 0, to: 5 })
    const { result } = renderHook(() => useRunPreset())
    result.current.runPresetAt(improve, 2)
    expect(start).toHaveBeenCalledWith({
      instruction: improve.instruction,
      target: { from: 0, to: 11 },
    })
  })

  it('cannot run while a suggestion is active', () => {
    mockSuggestion(true)
    const { result } = renderHook(() => useRunPreset())
    expect(result.current.canRun).toBe(false)
    result.current.runPreset(improve)
    result.current.runPresetAt(improve, 2)
    expect(start).not.toHaveBeenCalled()
  })

  it('cannot run without a ready model catalog and a selected model', () => {
    mockModels({ status: 'error' })
    expect(renderHook(() => useRunPreset()).result.current.canRun).toBe(false)
    mockModels({ status: 'loading' })
    expect(renderHook(() => useRunPreset()).result.current.canRun).toBe(false)
    mockModels({ selectedModel: null })
    expect(renderHook(() => useRunPreset()).result.current.canRun).toBe(false)
  })
})
