import { useState, type FormEvent } from 'react'
import { countByStatus, getHunks } from './diff'
import { SplitDiffView } from './SplitDiffView'
import { useSuggestion } from './SuggestionProvider'
import type { Suggestion } from './types'

const buttonBase =
  'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton = `${buttonBase} bg-sky-600 text-white hover:bg-sky-700`
const secondaryButton = `${buttonBase} border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800`

export function SuggestionPanel() {
  const { suggestion } = useSuggestion()

  if (!suggestion) {
    return (
      <section
        aria-label="AI suggestion"
        className="m-4 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
      >
        <p className="font-medium">No active suggestion.</p>
        <p className="mt-1">
          In the Editor tab, select some text (or nothing, for the whole document), describe the
          change, and press Suggest.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="AI suggestion" className="flex flex-col gap-4 p-4">
      <SuggestionHeader suggestion={suggestion} />
      {suggestion.status === 'streaming' && <StreamingView suggestion={suggestion} />}
      {suggestion.status === 'error' && <ErrorView suggestion={suggestion} />}
      {suggestion.status === 'reviewing' && <ReviewView suggestion={suggestion} />}
    </section>
  )
}

function SuggestionHeader({ suggestion }: { suggestion: Suggestion }) {
  const scope = suggestion.scope.kind === 'selection' ? 'Selection' : 'Whole document'
  const refinement =
    suggestion.history.length > 0 ? ` · refinement ${suggestion.history.length}` : ''
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {scope} · {suggestion.model}
        {refinement}
      </p>
      <h2 className="text-base font-semibold">“{suggestion.instruction}”</h2>
    </header>
  )
}

function StreamingView({ suggestion }: { suggestion: Suggestion }) {
  const { stop } = useSuggestion()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="animate-pulse text-sm text-slate-500 dark:text-slate-400">AI is writing…</p>
        <button type="button" onClick={stop} className={secondaryButton}>
          Stop
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900">
        {suggestion.proposedText}
      </pre>
    </div>
  )
}

function ErrorView({ suggestion }: { suggestion: Suggestion }) {
  const { retry, discard } = useSuggestion()
  const stopped = suggestion.error?.code === 'aborted'
  return (
    <div className="flex flex-col gap-3">
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      >
        <p className="font-medium">
          {stopped ? 'Suggestion stopped' : 'The AI could not complete this suggestion'}
        </p>
        <p>{suggestion.error?.message}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={retry} className={primaryButton}>
          Retry
        </button>
        <button type="button" onClick={discard} className={secondaryButton}>
          Discard
        </button>
      </div>
    </div>
  )
}

function ReviewView({ suggestion }: { suggestion: Suggestion }) {
  const { setHunkStatus, acceptAll, rejectAll, discard, refine } = useSuggestion()
  const [refineText, setRefineText] = useState('')
  const hunks = getHunks(suggestion.segments)
  const counts = countByStatus(suggestion.segments)

  if (hunks.length === 0) {
    return (
      <div
        role="status"
        className="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
      >
        <p>No changes suggested.</p>
        <button type="button" onClick={discard} className={secondaryButton}>
          Dismiss
        </button>
      </div>
    )
  }

  const refineBlocked = counts.accepted > 0 || suggestion.stale
  const decisionsBlocked = suggestion.stale || counts.pending === 0

  const submitRefine = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = refineText.trim()
    if (!text || refineBlocked) return
    refine(text)
    setRefineText('')
  }

  return (
    <div className="flex flex-col gap-3">
      {suggestion.stale && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          The document changed where this suggestion applies, so it can no longer be applied.
          Discard it and ask again.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-slate-600 dark:text-slate-300">
          {counts.pending} of {hunks.length} changes pending
        </p>
        <button
          type="button"
          onClick={acceptAll}
          disabled={decisionsBlocked}
          className={primaryButton}
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={rejectAll}
          disabled={decisionsBlocked}
          className={secondaryButton}
        >
          Reject all
        </button>
        <button type="button" onClick={discard} className={secondaryButton}>
          Discard
        </button>
      </div>
      <SplitDiffView
        segments={suggestion.segments}
        readOnly={suggestion.stale}
        onSetHunkStatus={setHunkStatus}
      />
      <form onSubmit={submitRefine} className="flex flex-col gap-1">
        <div className="flex gap-2">
          <input
            aria-label="Refine instruction"
            value={refineText}
            onChange={(event) => setRefineText(event.target.value)}
            disabled={refineBlocked}
            placeholder="Refine, e.g. “keep the first sentence, make it friendlier”"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={refineBlocked || !refineText.trim()}
            className={secondaryButton}
          >
            Refine
          </button>
        </div>
        {counts.accepted > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Refine is unavailable after accepting a change.
          </p>
        )}
      </form>
    </div>
  )
}
