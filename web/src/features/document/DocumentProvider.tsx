import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { loadJson, saveJson } from '../../lib/storage'
import { initialContent } from './initialContent'
import { DOCUMENT_STORAGE_KEY, storedDocumentSchema, type TextRange } from './schema'

export type DocumentContextValue = {
  content: string
  selection: TextRange
  setContent(content: string): void
  setSelection(range: TextRange): void
  replaceRange(range: TextRange, text: string): void
}

type State = { content: string; selection: TextRange }

type Action =
  | { type: 'setContent'; content: string }
  | { type: 'setSelection'; range: TextRange }
  | { type: 'replaceRange'; range: TextRange; text: string }

const AUTOSAVE_DELAY_MS = 300

function clampRange(range: TextRange, length: number): TextRange {
  const a = Math.min(Math.max(range.from, 0), length)
  const b = Math.min(Math.max(range.to, 0), length)
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setContent':
      return {
        content: action.content,
        selection: clampRange(state.selection, action.content.length),
      }
    case 'setSelection':
      return { ...state, selection: clampRange(action.range, state.content.length) }
    case 'replaceRange': {
      const { from, to } = clampRange(action.range, state.content.length)
      const content = state.content.slice(0, from) + action.text + state.content.slice(to)
      const cursor = from + action.text.length
      return { content, selection: { from: cursor, to: cursor } }
    }
  }
}

function loadInitialState(): State {
  const stored = loadJson(DOCUMENT_STORAGE_KEY, storedDocumentSchema.nullable(), null)
  return { content: stored?.content ?? initialContent, selection: { from: 0, to: 0 } }
}

function persist(content: string): void {
  saveJson(DOCUMENT_STORAGE_KEY, { content, updatedAt: Date.now() })
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

export function DocumentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState)
  const latestContent = useRef(state.content)
  const hasUnsavedChange = useRef(false)

  useEffect(() => {
    latestContent.current = state.content
    hasUnsavedChange.current = true
    const timer = setTimeout(() => {
      persist(state.content)
      hasUnsavedChange.current = false
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state.content])

  useEffect(() => {
    const flush = () => {
      if (!hasUnsavedChange.current) return
      persist(latestContent.current)
      hasUnsavedChange.current = false
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  const value = useMemo<DocumentContextValue>(
    () => ({
      content: state.content,
      selection: state.selection,
      setContent: (content) => dispatch({ type: 'setContent', content }),
      setSelection: (range) => dispatch({ type: 'setSelection', range }),
      replaceRange: (range, text) => dispatch({ type: 'replaceRange', range, text }),
    }),
    [state],
  )

  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useDocument(): DocumentContextValue {
  const value = useContext(DocumentContext)
  if (!value) throw new Error('useDocument must be used inside <DocumentProvider>')
  return value
}
