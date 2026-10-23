import type { ReactNode } from 'react'
import { ExportButton } from '../document/ExportButton'
import { ThemeToggle } from '../theme/ThemeToggle'

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
      <h1 className="text-base font-semibold tracking-tight">AI Docs</h1>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <ThemeToggle />
        <ExportButton />
      </div>
    </header>
  )
}
