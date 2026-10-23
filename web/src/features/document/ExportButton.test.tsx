import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from '../../lib/download'
import { DocumentProvider } from './DocumentProvider'
import { ExportButton } from './ExportButton'
import { DOCUMENT_STORAGE_KEY } from './schema'

vi.mock('../../lib/download', () => ({ downloadTextFile: vi.fn() }))

describe('ExportButton', () => {
  it('downloads the current document with a filename from its title', async () => {
    const content = '# My Notes\n\nhello'
    localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content, updatedAt: 1 }))
    const user = userEvent.setup()
    render(
      <DocumentProvider>
        <ExportButton />
      </DocumentProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Export Markdown' }))

    expect(downloadTextFile).toHaveBeenCalledWith('my-notes.md', content)
  })
})
