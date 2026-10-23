/* eslint-disable react-refresh/only-export-components -- test helpers */
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ModelProvider } from '../features/ai/ModelProvider'
import { DocumentProvider, useDocument } from '../features/document/DocumentProvider'
import { DOCUMENT_STORAGE_KEY } from '../features/document/schema'
import { SuggestionProvider, useSuggestion } from '../features/suggestions/SuggestionProvider'
import type { ResolvedSuggestion, SuggestionTarget } from '../features/suggestions/types'

type Options = {
  content?: string
  onResolved?: (resolved: ResolvedSuggestion) => void
  onStart?: () => void
}

/** Render `ui` inside Document → Model → Suggestion providers with a seeded document. */
export function renderWithAi(ui: ReactNode, { content = '', onResolved, onStart }: Options = {}) {
  localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content, updatedAt: 0 }))
  return render(
    <DocumentProvider>
      <ModelProvider>
        <SuggestionProvider onResolved={onResolved} onStart={onStart}>
          {ui}
        </SuggestionProvider>
      </ModelProvider>
    </DocumentProvider>,
  )
}

export function DocumentContent() {
  const { content } = useDocument()
  return <pre data-testid="document-content">{content}</pre>
}

export function StartSuggestion({
  instruction = 'Improve',
  target = 'auto',
}: {
  instruction?: string
  target?: SuggestionTarget
}) {
  const { start } = useSuggestion()
  return (
    <button type="button" onClick={() => start({ instruction, target })}>
      Start suggestion
    </button>
  )
}

export function SelectRange({ from, to }: { from: number; to: number }) {
  const { setSelection } = useDocument()
  return (
    <button type="button" onClick={() => setSelection({ from, to })}>
      Select range
    </button>
  )
}
