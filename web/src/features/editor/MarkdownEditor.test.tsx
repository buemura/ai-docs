import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownEditor, type MarkdownEditorProps } from './MarkdownEditor'

function setup(overrides: Partial<MarkdownEditorProps> = {}) {
  const props: MarkdownEditorProps = {
    value: 'Hello',
    onChange: vi.fn(),
    onSelectionChange: vi.fn(),
    dark: false,
    ...overrides,
  }
  const utils = render(<MarkdownEditor {...props} />)
  const getView = () => {
    const dom = utils.container.querySelector<HTMLElement>('.cm-editor')
    if (!dom) throw new Error('editor not rendered')
    const view = EditorView.findFromDOM(dom)
    if (!view) throw new Error('view not found')
    return view
  }
  return { ...utils, props, getView }
}

describe('MarkdownEditor', () => {
  it('renders the value in an accessibly labelled editor', () => {
    setup()
    expect(screen.getByLabelText('Markdown editor')).toHaveTextContent('Hello')
  })

  it('calls onChange with the full document after a user edit', () => {
    const { props, getView } = setup()
    act(() => {
      getView().dispatch({ changes: { from: 5, insert: ' world' } })
    })
    expect(props.onChange).toHaveBeenCalledWith('Hello world')
  })

  it('reports selection changes as an ordered range', () => {
    const { props, getView } = setup()
    act(() => {
      getView().dispatch({ selection: { anchor: 4, head: 1 } })
    })
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ from: 1, to: 4 })
  })

  it('applies external value changes without calling onChange', () => {
    const { props, rerender, getView } = setup()
    rerender(<MarkdownEditor {...props} value="Hello there" />)
    expect(getView().state.doc.toString()).toBe('Hello there')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('keeps the cursor in place when external text is appended after it', () => {
    const { props, rerender, getView } = setup()
    act(() => {
      getView().dispatch({ selection: { anchor: 2 } })
    })
    rerender(<MarkdownEditor {...props} value="Hello!" />)
    expect(getView().state.selection.main.head).toBe(2)
  })

  it('switches the dark theme on and off', () => {
    const { props, rerender, getView } = setup()
    expect(getView().state.facet(EditorView.darkTheme)).toBe(false)
    rerender(<MarkdownEditor {...props} dark />)
    expect(getView().state.facet(EditorView.darkTheme)).toBe(true)
    rerender(<MarkdownEditor {...props} dark={false} />)
    expect(getView().state.facet(EditorView.darkTheme)).toBe(false)
  })

  it('reconfigures extra extensions when the prop changes', () => {
    const { props, rerender, getView } = setup()
    expect(getView().state.readOnly).toBe(false)
    rerender(<MarkdownEditor {...props} extensions={[EditorState.readOnly.of(true)]} />)
    expect(getView().state.readOnly).toBe(true)
  })

  it('destroys the view on unmount', () => {
    const { unmount, container } = setup()
    unmount()
    expect(container.querySelector('.cm-editor')).toBeNull()
  })
})
