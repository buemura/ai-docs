import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from '../../lib/download'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useTheme } from '../theme/ThemeProvider'
import { CommandPalette } from './CommandPalette'
import { useRunPreset } from './useRunPreset'

vi.mock('./useRunPreset', () => ({ useRunPreset: vi.fn() }))
vi.mock('../document/DocumentProvider', () => ({ useDocument: vi.fn() }))
vi.mock('../theme/ThemeProvider', () => ({ useTheme: vi.fn() }))
vi.mock('../ai/ModelProvider', () => ({ useModels: vi.fn() }))
vi.mock('../../lib/download', () => ({ downloadTextFile: vi.fn() }))

const runPreset = vi.fn()
const toggleTheme = vi.fn()
const setSelectedModel = vi.fn()

function setup({ canRun = true } = {}) {
  vi.mocked(useRunPreset).mockReturnValue({ canRun, runPreset, runPresetAt: vi.fn() })
  vi.mocked(useDocument).mockReturnValue({
    content: '# My Doc\n\nHello',
    selection: { from: 0, to: 0 },
    setContent: vi.fn(),
    setSelection: vi.fn(),
    replaceRange: vi.fn(),
  } as ReturnType<typeof useDocument>)
  vi.mocked(useTheme).mockReturnValue({ theme: 'light', setTheme: vi.fn(), toggleTheme })
  vi.mocked(useModels).mockReturnValue({
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    selectedModel: 'claude-sonnet-5-5',
    setSelectedModel,
    status: 'ready',
  } as ReturnType<typeof useModels>)

  const onOpenChange = vi.fn()
  const onSwitchTab = vi.fn()
  const onAskAi = vi.fn()
  render(
    <CommandPalette open onOpenChange={onOpenChange} onSwitchTab={onSwitchTab} onAskAi={onAskAi} />,
  )
  return { onOpenChange, onSwitchTab, onAskAi, user: userEvent.setup() }
}

describe('CommandPalette', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists presets and filters them by search text', async () => {
    const { user } = setup()
    expect(screen.getByRole('option', { name: /improve writing/i })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Type a command or search…'), 'concise')
    expect(screen.getByRole('option', { name: /make more concise/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /improve writing/i })).not.toBeInTheDocument()
  })

  it('matches whole words, not scattered letters', async () => {
    const { user } = setup()
    // Fuzzy matching would also accept "Expand with more detail" (e-x-p…o-r…t).
    await user.type(screen.getByPlaceholderText('Type a command or search…'), 'export')
    expect(screen.getByRole('option', { name: 'Export as Markdown' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /expand/i })).not.toBeInTheDocument()
  })

  it('matches presets by slash name and items by keywords', async () => {
    const { user } = setup()
    const input = screen.getByPlaceholderText('Type a command or search…')
    await user.type(input, 'tldr')
    expect(screen.getByRole('option', { name: /add tl;dr summary/i })).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'dark')
    expect(screen.getByRole('option', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })

  it('runs a preset and closes', async () => {
    const { user, onOpenChange } = setup()
    await user.click(screen.getByRole('option', { name: /make more concise/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(runPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'shorten' }))
  })

  it('disables AI commands when presets cannot run', async () => {
    const { user } = setup({ canRun: false })
    const item = screen.getByRole('option', { name: /improve writing/i })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /ask ai/i })).toHaveAttribute('aria-disabled', 'true')
    await user.click(item)
    expect(runPreset).not.toHaveBeenCalled()
  })

  it('asks AI with a custom instruction', async () => {
    const { user, onAskAi, onOpenChange } = setup()
    await user.click(screen.getByRole('option', { name: /ask ai/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onAskAi).toHaveBeenCalledTimes(1)
  })

  it('switches tabs', async () => {
    const { user, onSwitchTab } = setup()
    await user.click(screen.getByRole('option', { name: 'Go to Preview' }))
    expect(onSwitchTab).toHaveBeenCalledWith('preview')
  })

  it('toggles the theme and exports the document', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('option', { name: 'Switch to dark theme' }))
    expect(toggleTheme).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('option', { name: 'Export as Markdown' }))
    expect(downloadTextFile).toHaveBeenCalledWith('my-doc.md', '# My Doc\n\nHello')
  })

  it('switches the model', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('option', { name: /use claude haiku 5\.5/i }))
    expect(setSelectedModel).toHaveBeenCalledWith('claude-haiku-5-5')
  })

  it('shows a keyboard shortcut summary', () => {
    setup()
    expect(screen.getByText(/slash commands/i)).toBeInTheDocument()
  })
})
