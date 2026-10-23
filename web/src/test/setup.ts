import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { ONBOARDING_STORAGE_KEY } from '../features/onboarding/tourStorage'
import { TOUR_VERSION } from '../features/onboarding/tourSteps'

// No test may hit the network. Tests that need the API call mockApi() from ./sse.
beforeEach(() => {
  // Every suite starts as a returning user; onboarding tests remove this key to see the tour.
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: TOUR_VERSION }))
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('fetch is not mocked in this test'))),
  )
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

// CodeMirror measures text with Range rects, which jsdom does not implement.
const emptyRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON() {
    return this
  },
} as DOMRect
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => emptyRect
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList
}

// cmdk measures its list with ResizeObserver and scrolls the active item into view;
// jsdom implements neither.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
