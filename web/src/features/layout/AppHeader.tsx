import type { ReactNode } from 'react'
import { CommandPaletteButton } from '../commands/CommandPaletteButton'
import { ExportButton } from '../document/ExportButton'
import { ThemeToggle } from '../theme/ThemeToggle'

export type AppHeaderProps = { children?: ReactNode; onOpenCommands?: () => void }

export function AppHeader({ children, onOpenCommands }: AppHeaderProps) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
      <h1 className="text-base font-semibold tracking-tight">AI Docs</h1>
      <div className="ml-auto flex items-center gap-2">
        {onOpenCommands && <CommandPaletteButton onClick={onOpenCommands} />}
        {children}
        <ThemeToggle />
        <ExportButton />
      </div>
    </header>
  )
}
