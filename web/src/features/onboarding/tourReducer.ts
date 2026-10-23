export type TourState = { status: 'idle' } | { status: 'running'; index: number; count: number }

export type TourAction =
  { type: 'start'; count: number } | { type: 'next' } | { type: 'back' } | { type: 'end' }

export const initialTourState: TourState = { status: 'idle' }

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      return action.count > 0 ? { status: 'running', index: 0, count: action.count } : state
    case 'next':
      if (state.status !== 'running') return state
      return { ...state, index: Math.min(state.index + 1, state.count - 1) }
    case 'back':
      if (state.status !== 'running') return state
      return { ...state, index: Math.max(state.index - 1, 0) }
    case 'end':
      return initialTourState
  }
}
