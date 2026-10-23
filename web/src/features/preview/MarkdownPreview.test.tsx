import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'

describe('MarkdownPreview', () => {
  it('renders headings, emphasis and lists', () => {
    render(<MarkdownPreview content={'# Title\n\nSome **bold** text\n\n- one\n- two'} />)
    const article = screen.getByRole('article', { name: 'Markdown preview' })
    expect(within(article).getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(within(article).getByText('bold').tagName).toBe('STRONG')
    expect(within(article).getAllByRole('listitem')).toHaveLength(2)
  })

  it('supports GitHub-flavored tables and task lists', () => {
    render(<MarkdownPreview content={'| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done'} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('opens links in a new tab', () => {
    render(<MarkdownPreview content="[site](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('shows an empty state for blank content', () => {
    render(<MarkdownPreview content={'  \n'} />)
    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument()
  })
})
