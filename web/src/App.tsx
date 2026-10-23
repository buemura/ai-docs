import { useState } from 'react'
import { ModelProvider } from './features/ai/ModelProvider'
import { ModelSelect } from './features/ai/ModelSelect'
import { DocumentProvider, useDocument } from './features/document/DocumentProvider'
import { MarkdownEditor } from './features/editor/MarkdownEditor'
import { AppHeader } from './features/layout/AppHeader'
import { Tabs, type TabId } from './features/layout/Tabs'
import { MarkdownPreview } from './features/preview/MarkdownPreview'
import { ThemeProvider, useTheme } from './features/theme/ThemeProvider'

function AppShell() {
  const { content, setContent, setSelection } = useDocument()
  const { theme } = useTheme()
  const [activeTab, setActiveTab] = useState<TabId>('editor')

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader>
        <ModelSelect />
      </AppHeader>
      <main className="min-h-0 flex-1">
        <Tabs
          active={activeTab}
          onChange={setActiveTab}
          panels={{
            editor: (
              <MarkdownEditor
                value={content}
                onChange={setContent}
                onSelectionChange={setSelection}
                dark={theme === 'dark'}
              />
            ),
            preview: <MarkdownPreview content={content} />,
            review: (
              <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
                AI suggestions will appear here.
              </p>
            ),
          }}
        />
      </main>
    </div>
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
