import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, DEFAULT_THEME, loadTheme, nextTheme, THEME_STORAGE_KEY } from './theme'

afterEach(() => {
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
})

describe('theme helpers', () => {
  it('defaults to light', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(loadTheme()).toBe('light')
  })

  it('loads a stored theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify('dark'))
    expect(loadTheme()).toBe('dark')
  })

  it('falls back to light for an invalid stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify('purple'))
    expect(loadTheme()).toBe('light')
  })

  it('toggles between light and dark', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })

  it('applies the dark class and color-scheme to the root element', () => {
    applyTheme('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
