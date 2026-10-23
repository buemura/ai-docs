import { useCallback, useMemo, useState } from 'react'
import { ModelProvider } from './features/ai/ModelProvider'
import { ModelSelect } from './features/ai/ModelSelect'
import { CommandPalette } from './features/commands/CommandPalette'
import { PresetChips } from './features/commands/PresetChips'
import { slashCommands } from './features/commands/slashCommands'
import { useCommandPaletteShortcut } from './features/commands/useCommandPaletteShortcut'
import { useRunPreset } from './features/commands/useRunPreset'
import { useSlashCommandHandler } from './features/commands/useSlashCommandHandler'
import { DocumentProvider, useDocument } from './features/document/DocumentProvider'
import { MarkdownEditor } from './features/editor/MarkdownEditor'
import { AiReviewTab } from './features/history/AiReviewTab'
import { SuggestionBridge } from './features/history/SuggestionBridge'
import { VersionsProvider } from './features/history/VersionsProvider'
import { AppHeader } from './features/layout/AppHeader'
import { Tabs, type TabId } from './features/layout/Tabs'
import { MarkdownPreview } from './features/preview/MarkdownPreview'
import { AskAiBar } from './features/suggestions/AskAiBar'
import { countByStatus } from './features/suggestions/diff'
import { useSuggestion } from './features/suggestions/SuggestionProvider'
import { ThemeProvider, useTheme } from './features/theme/ThemeProvider'

function Workspace({ activeTab, onTabChange }: { activeTab: TabId; onTabChange(id: TabId): void }) {
  const { content, setContent, setSelection } = useDocument()
  const { theme } = useTheme()
  const { suggestion } = useSuggestion()
  const { canRun, runPreset, runPresetAt } = useRunPreset()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [askAiFocusRequested, setAskAiFocusRequested] = useState(false)

  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), [])
  useCommandPaletteShortcut(togglePalette)

  const focusAskAi = useCallback(() => {
    onTabChange('editor')
    setAskAiFocusRequested(true)
  }, [onTabChange])
  const clearAskAiFocus = useCallback(() => setAskAiFocusRequested(false), [])

  const handleSlash = useSlashCommandHandler({ content, runPresetAt, onAsk: focusAskAi })
  const editorExtensions = useMemo(() => [slashCommands(handleSlash)], [handleSlash])

  const pending = suggestion ? countByStatus(suggestion.segments).pending : 0
  const reviewBadge = suggestion?.status === 'streaming' ? '…' : pending > 0 ? pending : null

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader onOpenCommands={() => setPaletteOpen(true)}>
        <ModelSelect />
      </AppHeader>
      <main className="min-h-0 flex-1">
        <Tabs
          active={activeTab}
          onChange={onTabChange}
          badges={
            reviewBadge === null
              ? undefined
              : {
                  review: (
                    <span className="rounded-full bg-sky-600 px-1.5 text-xs leading-5 text-white">
                      {reviewBadge}
                    </span>
                  ),
                }
          }
          panels={{
            editor: (
              <div className="flex h-full flex-col">
                <AskAiBar
                  focusRequested={askAiFocusRequested}
                  onFocusHandled={clearAskAiFocus}
                  quickActions={<PresetChips disabled={!canRun} onPick={runPreset} />}
                />
                <div className="min-h-0 flex-1">
                  <MarkdownEditor
                    value={content}
                    onChange={setContent}
                    onSelectionChange={setSelection}
                    dark={theme === 'dark'}
                    extensions={editorExtensions}
                  />
                </div>
              </div>
            ),
            preview: <MarkdownPreview content={content} />,
            review: (
              <div className="h-full overflow-y-auto">
                <AiReviewTab />
              </div>
            ),
          }}
        />
      </main>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSwitchTab={onTabChange}
        onAskAi={focusAskAi}
      />
    </div>
  )
}

function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>('editor')
  const openReview = useCallback(() => setActiveTab('review'), [])

  return (
    <VersionsProvider>
      <SuggestionBridge onStart={openReview}>
        <Workspace activeTab={activeTab} onTabChange={setActiveTab} />
      </SuggestionBridge>
    </VersionsProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DocumentProvider>
        <ModelProvider>
          <AppShell />
        </ModelProvider>
      </DocumentProvider>
    </ThemeProvider>
  )
}
