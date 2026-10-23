import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export type TabId = 'editor' | 'preview' | 'review'

type TabsProps = {
  active: TabId
  onChange(id: TabId): void
  panels: Record<TabId, ReactNode>
  badges?: Partial<Record<TabId, ReactNode>>
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'AI Review' },
]

export function Tabs({ active, onChange, panels, badges }: TabsProps) {
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  const select = (id: TabId) => {
    onChange(id)
    tabRefs.current[id]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = TABS.length
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    select(TABS[target].id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Document views"
        data-tour="tabs"
        className="flex gap-1 border-b border-slate-200 px-4 dark:border-slate-800"
      >
        {TABS.map((tab, index) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-500 ${
                selected
                  ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
              {badges?.[tab.id]}
            </button>
          )
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
          className="min-h-0 flex-1"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  )
}
