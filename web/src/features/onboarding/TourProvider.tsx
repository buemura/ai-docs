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
import { createPortal } from 'react-dom'
import { TourOverlay } from './TourOverlay'
import { initialTourState, tourReducer, type TourState } from './tourReducer'
import { hasSeenTour, markTourSeen } from './tourStorage'
import { TOUR_STEPS, type TourStep } from './tourSteps'

type TourContextValue = { isActive: boolean; start(): void }

const TourContext = createContext<TourContextValue | null>(null)

function initTour(count: number): TourState {
  return count > 0 && !hasSeenTour() ? { status: 'running', index: 0, count } : initialTourState
}

export function TourProvider({
  children,
  onStart,
  steps = TOUR_STEPS,
}: {
  children: ReactNode
  onStart?(): void
  steps?: TourStep[]
}) {
  const [state, dispatch] = useReducer(tourReducer, steps.length, initTour)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const isActive = state.status === 'running'

  const start = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    onStart?.()
    dispatch({ type: 'start', count: steps.length })
  }, [onStart, steps.length])

  const end = useCallback(() => {
    markTourSeen()
    dispatch({ type: 'end' })
  }, [])
  const next = useCallback(() => dispatch({ type: 'next' }), [])
  const back = useCallback(() => dispatch({ type: 'back' }), [])

  // Restore focus after commit, once the app is no longer inert.
  useEffect(() => {
    if (state.status !== 'idle' || !returnFocusRef.current) return
    returnFocusRef.current.focus()
    returnFocusRef.current = null
  }, [state.status])

  const value = useMemo(() => ({ isActive, start }), [isActive, start])

  return (
    <TourContext.Provider value={value}>
      <div inert={isActive} className="contents">
        {children}
      </div>
      {state.status === 'running' &&
        createPortal(
          <TourOverlay
            step={steps[state.index]}
            index={state.index}
            count={state.count}
            onNext={next}
            onBack={back}
            onEnd={end}
          />,
          document.body,
        )}
    </TourContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useTour(): TourContextValue {
  const context = useContext(TourContext)
  if (!context) throw new Error('useTour must be used inside <TourProvider>')
  return context
}
