import { z } from 'zod'
import { loadJson } from '../../lib/storage'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ai-docs:theme'
export const themeSchema = z.enum(['light', 'dark'])
export const DEFAULT_THEME: Theme = 'light'

export function loadTheme(): Theme {
  return loadJson(THEME_STORAGE_KEY, themeSchema, DEFAULT_THEME)
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}
