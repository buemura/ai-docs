export type TourAnchor =
  'editor' | 'ask-ai' | 'quick-actions' | 'model-select' | 'tabs' | 'commands' | 'export'

export type TourStep = { id: string; anchor: TourAnchor | null; title: string; body: string }

// Bump when the UI changes enough that returning users should see the tour again.
export const TOUR_VERSION = 1

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    anchor: null,
    title: 'Welcome to AI Docs',
    body: 'Write Markdown and let an AI co-author suggest edits. Nothing changes until you accept it. This quick tour shows you around.',
  },
  {
    id: 'editor',
    anchor: 'editor',
    title: 'Your document',
    body: 'Write Markdown here. It autosaves in this browser. Type / for AI commands without leaving the keyboard.',
  },
  {
    id: 'ask-ai',
    anchor: 'ask-ai',
    title: 'Ask AI',
    body: 'Describe an edit and press Suggest (⌘↵ / Ctrl ↵). Select text first to edit just that part; otherwise the AI works on the whole document.',
  },
  {
    id: 'quick-actions',
    anchor: 'quick-actions',
    title: 'Quick actions',
    body: 'One-click presets for common edits, like improving or shortening the paragraph under your cursor.',
  },
  {
    id: 'model',
    anchor: 'model-select',
    title: 'Pick a model',
    body: 'Choose which model writes the suggestions. Your choice is remembered.',
  },
  {
    id: 'tabs',
    anchor: 'tabs',
    title: 'Preview and review',
    body: 'Preview renders your Markdown. AI Review shows each suggestion as a side-by-side diff: accept or reject changes one by one, refine the request, or restore an earlier version.',
  },
  {
    id: 'commands',
    anchor: 'commands',
    title: 'Command palette',
    body: 'Press ⌘K (Ctrl K on Windows and Linux) to run any action from the keyboard.',
  },
  {
    id: 'export',
    anchor: 'export',
    title: 'Take it with you',
    body: 'Download your document as a .md file. You can replay this tour anytime from the ? button.',
  },
]

export function anchorSelector(anchor: TourAnchor): string {
  return `[data-tour="${anchor}"]`
}
