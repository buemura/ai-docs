import { Command } from 'cmdk'
import { downloadTextFile } from '../../lib/download'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { exportFilename } from '../document/exportFilename'
import type { TabId } from '../layout/Tabs'
import { useTheme } from '../theme/ThemeProvider'
import { AI_PRESETS } from './presets'
import { useRunPreset } from './useRunPreset'

export type CommandPaletteProps = {
  open: boolean
  onOpenChange(open: boolean): void
  onSwitchTab(tab: TabId): void
  onAskAi(): void
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'AI Review' },
]

const itemClass =
  'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 data-[selected=true]:bg-slate-100 dark:data-[selected=true]:bg-slate-800 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50'
const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-slate-500'
const hintClass = 'text-xs text-slate-400'

export function CommandPalette({ open, onOpenChange, onSwitchTab, onAskAi }: CommandPaletteProps) {
  const { content } = useDocument()
  const { theme, toggleTheme } = useTheme()
  const { models, selectedModel, setSelectedModel } = useModels()
  const { canRun, runPreset } = useRunPreset()

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-black/30"
      contentClassName="fixed left-1/2 top-24 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
    >
      <Command.Input
        placeholder="Type a command or search…"
        className="w-full border-b border-slate-200 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:text-slate-100"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">
          No results.
        </Command.Empty>

        <Command.Group heading="AI" className={groupClass}>
          <Command.Item
            value="Ask AI…"
            keywords={['custom', 'instruction', 'ask']}
            disabled={!canRun}
            onSelect={() => run(onAskAi)}
            className={itemClass}
          >
            <span>Ask AI…</span>
            <span className={hintClass}>/ask</span>
          </Command.Item>
          {AI_PRESETS.map((preset) => (
            <Command.Item
              key={preset.id}
              value={preset.label}
              keywords={[preset.slash]}
              disabled={!canRun}
              onSelect={() => run(() => runPreset(preset))}
              className={itemClass}
            >
              <span>{preset.label}</span>
              <span className={hintClass}>/{preset.slash}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="View" className={groupClass}>
          {TABS.map((tab) => (
            <Command.Item
              key={tab.id}
              value={`Go to ${tab.label}`}
              onSelect={() => run(() => onSwitchTab(tab.id))}
              className={itemClass}
            >
              Go to {tab.label}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Document" className={groupClass}>
          <Command.Item
            value="Toggle theme"
            keywords={['dark', 'light', 'theme']}
            onSelect={() => run(toggleTheme)}
            className={itemClass}
          >
            {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          </Command.Item>
          <Command.Item
            value="Export as Markdown"
            keywords={['download', 'save', 'md']}
            onSelect={() => run(() => downloadTextFile(exportFilename(content), content))}
            className={itemClass}
          >
            Export as Markdown
          </Command.Item>
        </Command.Group>

        {models.length > 0 && (
          <Command.Group heading="Model" className={groupClass}>
            {models.map((model) => (
              <Command.Item
                key={model.id}
                value={`Use ${model.label}`}
                keywords={['model', model.id]}
                onSelect={() => run(() => setSelectedModel(model.id))}
                className={itemClass}
              >
                <span>Use {model.label}</span>
                {model.id === selectedModel && <span aria-hidden="true">✓</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-700">
        <span>
          <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> toggle
        </span>
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> run
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
        <span>
          Type <kbd>/</kbd> in the editor for slash commands
        </span>
      </footer>
    </Command.Dialog>
  )
}
