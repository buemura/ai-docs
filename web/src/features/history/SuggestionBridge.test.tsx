import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentProvider } from '../document/DocumentProvider'
import type { ResolvedSuggestion } from '../suggestions/types'
import { SuggestionBridge } from './SuggestionBridge'
import { useVersions, VersionsProvider } from './VersionsProvider'

const captured = vi.hoisted(
  () => ({}) as { onResolved?: (r: ResolvedSuggestion) => void; onStart?: () => void },
)

vi.mock('../suggestions/SuggestionProvider', () => ({
  SuggestionProvider: ({
    children,
    onResolved,
    onStart,
  }: {
    children: ReactNode
    onResolved?: (r: ResolvedSuggestion) => void
    onStart?: () => void
  }) => {
    captured.onResolved = onResolved
    captured.onStart = onStart
    return <>{children}</>
  },
}))

function VersionsProbe() {
  const { versions } = useVersions()
  return (
    <output data-testid="versions">
      {JSON.stringify(
        versions.map(({ source, label, model, content }) => ({ source, label, model, content })),
      )}
    </output>
  )
}

function renderBridge(onStart?: () => void) {
  localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
  return render(
    <DocumentProvider>
      <VersionsProvider>
        <SuggestionBridge onStart={onStart}>
          <VersionsProbe />
        </SuggestionBridge>
      </VersionsProvider>
    </DocumentProvider>,
  )
}

function shownVersions() {
  return JSON.parse(screen.getByTestId('versions').textContent ?? '[]') as unknown[]
}

function resolved(overrides: Partial<ResolvedSuggestion> = {}): ResolvedSuggestion {
  return {
    instruction: 'Shorter',
    history: [],
    model: 'claude-sonnet-5-5',
    contentBefore: '# Hello\n',
    contentAfter: '# Hi\n',
    acceptedCount: 1,
    totalCount: 1,
    ...overrides,
  }
}

describe('SuggestionBridge', () => {
  it('records an AI version labelled with the refine chain', () => {
    renderBridge()
    act(() => {
      captured.onResolved?.(resolved({ history: [{ instruction: 'Formal', proposal: 'x' }] }))
    })
    expect(shownVersions()).toEqual([
      { source: 'initial', label: 'Initial version', content: '# Hello\n' },
      { source: 'ai', label: 'Formal → Shorter', model: 'claude-sonnet-5-5', content: '# Hi\n' },
    ])
  })

  it('records manual edits before the AI version when the document drifted', () => {
    renderBridge()
    act(() => {
      captured.onResolved?.(resolved({ contentBefore: '# Hello edited\n' }))
    })
    expect(shownVersions()).toEqual([
      { source: 'initial', label: 'Initial version', content: '# Hello\n' },
      { source: 'manual', label: 'Manual edits', content: '# Hello edited\n' },
      { source: 'ai', label: 'Shorter', model: 'claude-sonnet-5-5', content: '# Hi\n' },
    ])
  })

  it('passes onStart through to SuggestionProvider', () => {
    const onStart = vi.fn()
    renderBridge(onStart)
    captured.onStart?.()
    expect(onStart).toHaveBeenCalledOnce()
  })
})
