import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { createId } from '../../lib/id'
import { streamSuggestion } from '../ai/api'
import { useModels } from '../ai/ModelProvider'
import type { SuggestionRequestBody } from '../ai/schemas'
import { useDocument } from '../document/DocumentProvider'
import { applySegments, countByStatus, getHunks, setHunkStatuses } from './diff'
import { locateRegion, resolveTarget } from './locateRegion'
import { hasAccepted, suggestionReducer } from './suggestionReducer'
import type {
  HunkStatus,
  RefineTurn,
  ResolvedSuggestion,
  StartSuggestionInput,
  Suggestion,
  SuggestionScope,
  TextRange,
} from './types'

export type SuggestionContextValue = {
  suggestion: Suggestion | null
  isBusy: boolean
  start(input: StartSuggestionInput): void
  stop(): void
  retry(): void
  refine(instruction: string): void
  setHunkStatus(hunkId: string, status: HunkStatus): void
  acceptAll(): void
  rejectAll(): void
  discard(): void
}

export type SuggestionProviderProps = {
  children: ReactNode
  onResolved?(resolved: ResolvedSuggestion): void
  onStart?(): void
}

const SuggestionContext = createContext<SuggestionContextValue | null>(null)

function toRequestBody(
  document: string,
  scope: SuggestionScope,
  instruction: string,
  model: string,
  history: RefineTurn[],
): SuggestionRequestBody {
  return {
    model,
    document,
    selection: scope.kind === 'selection' ? { start: scope.range.from, end: scope.range.to } : null,
    instruction,
    history,
  }
}

function scopeForRegion(content: string, region: TextRange): SuggestionScope {
  const wholeDocument = region.from === 0 && region.to === content.length
  return wholeDocument || region.from === region.to
    ? { kind: 'document' }
    : { kind: 'selection', range: region }
}

function regionHint(suggestion: Suggestion): number {
  return suggestion.scope.kind === 'selection' ? suggestion.scope.range.from : 0
}

function toResolved(
  suggestion: Suggestion,
  contentBefore: string,
  contentAfter: string,
  accepted: number,
): ResolvedSuggestion {
  return {
    instruction: suggestion.instruction,
    history: suggestion.history,
    model: suggestion.model,
    contentBefore,
    contentAfter,
    acceptedCount: accepted,
    totalCount: getHunks(suggestion.segments).length,
  }
}

export function SuggestionProvider({ children, onResolved, onStart }: SuggestionProviderProps) {
  const { content, selection, replaceRange } = useDocument()
  const { selectedModel } = useModels()
  const [suggestion, dispatch] = useReducer(suggestionReducer, null)
  const runRef = useRef<{ id: string; controller: AbortController } | null>(null)

  useEffect(() => {
    const runs = runRef
    return () => runs.current?.controller.abort()
  }, [])

  const runStream = useCallback(async (id: string, body: SuggestionRequestBody) => {
    runRef.current?.controller.abort()
    const controller = new AbortController()
    runRef.current = { id, controller }
    for await (const event of streamSuggestion(body, controller.signal)) {
      if (controller.signal.aborted) break
      if (event.type === 'delta') dispatch({ type: 'delta', id, text: event.text })
      else if (event.type === 'done') dispatch({ type: 'done', id })
      else dispatch({ type: 'error', id, error: { code: event.code, message: event.message } })
    }
    if (runRef.current?.id === id) runRef.current = null
  }, [])

  const start = useCallback(
    (input: StartSuggestionInput) => {
      const instruction = input.instruction.trim()
      if (suggestion || runRef.current || !selectedModel || !instruction) return
      const range = resolveTarget(input.target, selection, content.length)
      const scope: SuggestionScope = range ? { kind: 'selection', range } : { kind: 'document' }
      const baseText = range ? content.slice(range.from, range.to) : content
      const id = createId()
      dispatch({
        type: 'start',
        id,
        scope,
        baseText,
        instruction,
        model: selectedModel,
        history: [],
      })
      onStart?.()
      void runStream(id, toRequestBody(content, scope, instruction, selectedModel, []))
    },
    [suggestion, selectedModel, selection, content, onStart, runStream],
  )

  const retry = useCallback(() => {
    if (!suggestion || suggestion.status !== 'error' || !selectedModel) return
    const region = locateRegion(content, suggestion.baseText, regionHint(suggestion))
    if (!region) {
      dispatch({
        type: 'error',
        id: suggestion.id,
        error: {
          code: 'target_changed',
          message: 'The text this suggestion targets has changed. Discard it and ask again.',
        },
      })
      return
    }
    const scope = scopeForRegion(content, region)
    const id = createId()
    dispatch({
      type: 'start',
      id,
      scope,
      baseText: suggestion.baseText,
      instruction: suggestion.instruction,
      model: selectedModel,
      history: suggestion.history,
    })
    onStart?.()
    void runStream(
      id,
      toRequestBody(content, scope, suggestion.instruction, selectedModel, suggestion.history),
    )
  }, [suggestion, selectedModel, content, onStart, runStream])

  const stop = useCallback(() => {
    const run = runRef.current
    if (!run) return
    run.controller.abort()
    runRef.current = null
    dispatch({ type: 'error', id: run.id, error: { code: 'aborted', message: 'Stopped.' } })
  }, [])

  const refine = useCallback(
    (rawInstruction: string) => {
      const instruction = rawInstruction.trim()
      if (
        !suggestion ||
        suggestion.status !== 'reviewing' ||
        suggestion.stale ||
        hasAccepted(suggestion) ||
        suggestion.proposedText === '' || // backend rejects empty refine proposals (phase 3)
        !selectedModel ||
        !instruction
      ) {
        return
      }
      const region = locateRegion(content, suggestion.baseText, regionHint(suggestion))
      if (!region) {
        dispatch({ type: 'markStale' })
        return
      }
      const scope = scopeForRegion(content, region)
      const history = [
        ...suggestion.history,
        { instruction: suggestion.instruction, proposal: suggestion.proposedText },
      ]
      const id = createId()
      dispatch({ type: 'refine', id, instruction, scope, model: selectedModel })
      onStart?.()
      void runStream(id, toRequestBody(content, scope, instruction, selectedModel, history))
    },
    [suggestion, selectedModel, content, onStart, runStream],
  )

  const decide = useCallback(
    (hunkIds: string[], status: HunkStatus) => {
      if (
        !suggestion ||
        suggestion.status !== 'reviewing' ||
        suggestion.stale ||
        hunkIds.length === 0
      ) {
        return
      }
      const currentText = applySegments(suggestion.segments)
      const nextSegments = setHunkStatuses(suggestion.segments, hunkIds, status)
      const nextText = applySegments(nextSegments)
      const region = locateRegion(content, currentText, regionHint(suggestion))
      if (!region) {
        dispatch({ type: 'markStale' })
        return
      }
      if (nextText !== currentText) replaceRange(region, nextText)
      dispatch({
        type: 'setHunkStatus',
        hunkIds,
        status,
        contentBefore: content,
        range: { from: region.from, to: region.from + nextText.length },
      })

      const counts = countByStatus(nextSegments)
      if (counts.pending > 0) return
      if (counts.accepted > 0) {
        const contentAfter = content.slice(0, region.from) + nextText + content.slice(region.to)
        onResolved?.(
          toResolved(
            suggestion,
            suggestion.contentBeforeFirstAccept ?? content,
            contentAfter,
            counts.accepted,
          ),
        )
      }
      dispatch({ type: 'discard' })
    },
    [suggestion, content, replaceRange, onResolved],
  )

  const setHunkStatus = useCallback(
    (hunkId: string, status: HunkStatus) => decide([hunkId], status),
    [decide],
  )

  const pendingIds = useCallback(
    () =>
      suggestion
        ? getHunks(suggestion.segments)
            .filter((hunk) => hunk.status === 'pending')
            .map((hunk) => hunk.id)
        : [],
    [suggestion],
  )

  const acceptAll = useCallback(() => decide(pendingIds(), 'accepted'), [decide, pendingIds])
  const rejectAll = useCallback(() => decide(pendingIds(), 'rejected'), [decide, pendingIds])

  const discard = useCallback(() => {
    runRef.current?.controller.abort()
    runRef.current = null
    if (suggestion?.status === 'reviewing') {
      const { accepted } = countByStatus(suggestion.segments)
      if (accepted > 0) {
        onResolved?.(
          toResolved(suggestion, suggestion.contentBeforeFirstAccept ?? content, content, accepted),
        )
      }
    }
    dispatch({ type: 'discard' })
  }, [suggestion, content, onResolved])

  const value = useMemo<SuggestionContextValue>(
    () => ({
      suggestion,
      isBusy: suggestion !== null,
      start,
      stop,
      retry,
      refine,
      setHunkStatus,
      acceptAll,
      rejectAll,
      discard,
    }),
    [suggestion, start, stop, retry, refine, setHunkStatus, acceptAll, rejectAll, discard],
  )

  return <SuggestionContext.Provider value={value}>{children}</SuggestionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useSuggestion(): SuggestionContextValue {
  const value = useContext(SuggestionContext)
  if (!value) throw new Error('useSuggestion must be used inside <SuggestionProvider>')
  return value
}
