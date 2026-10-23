import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { placeCard, SPOTLIGHT_PADDING } from './placement'
import type { TourStep } from './tourSteps'
import { useAnchorRect, useElementSize, useViewportSize } from './useAnchorRect'

const CARD_FALLBACK_SIZE = { width: 320, height: 200 }

export type TourOverlayProps = {
  step: TourStep
  index: number
  count: number
  onNext(): void
  onBack(): void
  onEnd(): void
}

export function TourOverlay({ step, index, count, onNext, onBack, onEnd }: TourOverlayProps) {
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const anchorRect = useAnchorRect(step.anchor)
  const cardSize = useElementSize(cardRef, CARD_FALLBACK_SIZE)
  const viewport = useViewportSize()
  const isFirst = index === 0
  const isLast = index === count - 1
  const position = placeCard(anchorRect, cardSize, viewport)

  useEffect(() => {
    primaryRef.current?.focus()
  }, [index])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const actions: Record<string, () => void> = {
      Escape: onEnd,
      ArrowRight: isLast ? onEnd : onNext,
      ArrowLeft: onBack,
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        onMouseDown={(event) => event.preventDefault()}
      />
      {anchorRect ? (
        <div
          data-testid="tour-spotlight"
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg shadow-[0_0_0_9999px_rgb(2_6_23/0.55)] ring-2 ring-sky-500 motion-safe:transition-all"
          style={{
            top: anchorRect.top - SPOTLIGHT_PADDING,
            left: anchorRect.left - SPOTLIGHT_PADDING,
            width: anchorRect.width + SPOTLIGHT_PADDING * 2,
            height: anchorRect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-950/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        style={{ top: position.top, left: position.left }}
        className="fixed w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-4 text-slate-900 shadow-xl motion-safe:transition-all dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Step {index + 1} of {count}
        </p>
        <h2 id={titleId} className="mt-1 text-base font-semibold">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {!isLast && (
            <button
              type="button"
              onClick={onEnd}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Skip tour
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            disabled={isFirst}
            className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Back
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={isLast ? onEnd : onNext}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
