import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useModels } from '../ai/ModelProvider'
import { useFocusRequest } from '../commands/useFocusRequest'
import { useDocument } from '../document/DocumentProvider'
import { useSuggestion } from './SuggestionProvider'

export type AskAiBarProps = {
  focusRequested?: boolean
  onFocusHandled?(): void
  quickActions?: ReactNode
}

export function AskAiBar({ focusRequested = false, onFocusHandled, quickActions }: AskAiBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useFocusRequest(inputRef, focusRequested, onFocusHandled)
  const { selection } = useDocument()
  const { start, isBusy } = useSuggestion()
  const { selectedModel, status } = useModels()
  const [instruction, setInstruction] = useState('')

  const hasSelection = selection.from !== selection.to
  const unavailable = isBusy || !selectedModel
  const canSubmit = !unavailable && instruction.trim().length > 0

  const placeholder = isBusy
    ? 'Finish reviewing the current suggestion first…'
    : status === 'loading'
      ? 'Loading models…'
      : !selectedModel
        ? 'AI unavailable'
        : 'Ask AI to edit, e.g. “make this more concise”'

  const submit = () => {
    if (!canSubmit) return
    start({ instruction: instruction.trim(), target: 'auto' })
    setInstruction('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <form
        aria-label="Ask AI"
        data-tour="ask-ai"
        onSubmit={handleSubmit}
        className="flex items-center gap-2"
      >
        <span
          aria-live="polite"
          className="shrink-0 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        >
          {hasSelection ? 'Selection' : 'Whole document'}
        </span>
        <input
          ref={inputRef}
          aria-label="AI instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={unavailable}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suggest
        </button>
      </form>
      {quickActions}
    </div>
  )
}
