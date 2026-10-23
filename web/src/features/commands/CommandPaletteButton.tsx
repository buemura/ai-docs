// eslint-disable-next-line react-refresh/only-export-components -- tiny helper shared with tests
export function shortcutLabel(userAgent: string = navigator.userAgent): string {
  return /Mac|iPhone|iPad/.test(userAgent) ? '⌘K' : 'Ctrl K'
}

export function CommandPaletteButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open command palette"
      className="flex items-center gap-2 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <span>Commands</span>
      <kbd className="rounded bg-slate-100 px-1.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {shortcutLabel()}
      </kbd>
    </button>
  )
}
