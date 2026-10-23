import { EditorView } from '@codemirror/view'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { DOCUMENT_STORAGE_KEY } from './features/document/schema'

function getEditorView(container: HTMLElement): EditorView {
  const dom = container.querySelector<HTMLElement>('.cm-editor')
  const view = dom && EditorView.findFromDOM(dom)
  if (!view) throw new Error('editor view not found')
  return view
}

afterEach(() => {
  document.documentElement.className = ''
})

describe('App', () => {
  it('shows the header and three tabs with the editor active', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent('AI Docs')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI Review' })).toBeInTheDocument()
    expect(screen.getByLabelText('Markdown editor')).toHaveTextContent('Welcome to AI Docs')
  })

  it('renders edits from the editor in the preview and autosaves them', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const view = getEditorView(container)
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Fresh title\n' } })
    })

    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Fresh title' })).toBeVisible()

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(DOCUMENT_STORAGE_KEY) ?? 'null')?.content).toBe(
        '# Fresh title\n',
      )
    })
  })

  it('shows the AI Review placeholder', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'AI Review' }))
    expect(screen.getByText('AI suggestions will appear here.')).toBeVisible()
  })

  it('toggles dark mode for the page and the editor', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(getEditorView(container).state.facet(EditorView.darkTheme)).toBe(true)
  })
})
