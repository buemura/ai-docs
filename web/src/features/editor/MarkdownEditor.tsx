import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef, useState } from 'react'
import type { TextRange } from '../document/schema'

export type MarkdownEditorProps = {
  value: string
  onChange(value: string): void
  onSelectionChange?(range: TextRange): void
  dark: boolean
  extensions?: Extension[]
}

const NO_EXTENSIONS: Extension[] = []

/** Marks transactions that come from the `value` prop so they are not echoed to onChange. */
const External = Annotation.define<boolean>()

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '16px 0' },
  '&.cm-focused': { outline: 'none' },
})

/** Smallest single change that turns `current` into `next` (shared prefix/suffix kept). */
function minimalChange(current: string, next: string) {
  const max = Math.min(current.length, next.length)
  let start = 0
  while (start < max && current[start] === next[start]) start++
  let endCurrent = current.length
  let endNext = next.length
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent--
    endNext--
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) }
}

export function MarkdownEditor({
  value,
  onChange,
  onSelectionChange,
  dark,
  extensions = NO_EXTENSIONS,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const [compartments] = useState(() => ({ theme: new Compartment(), extra: new Compartment() }))

  useEffect(() => {
    onChangeRef.current = onChange
    onSelectionChangeRef.current = onSelectionChange
  })

  // Create the view once. Later prop changes are synced by the effects below.
  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor' }),
          baseTheme,
          compartments.theme.of(dark ? oneDark : []),
          compartments.extra.of(extensions),
          EditorView.updateListener.of((update) => {
            const external = update.transactions.some((tr) => tr.annotation(External))
            if (update.docChanged && !external) {
              onChangeRef.current(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) {
              const { from, to } = update.state.selection.main
              onSelectionChangeRef.current?.({ from, to })
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is created once; props are synced below
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: minimalChange(current, value), annotations: External.of(true) })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.theme.reconfigure(dark ? oneDark : []) })
  }, [dark, compartments])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.extra.reconfigure(extensions) })
  }, [extensions, compartments])

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
}
