import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentProvider } from '../document/DocumentProvider'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  it('shows the app name, extra controls, theme toggle and export button', () => {
    render(
      <ThemeProvider>
        <DocumentProvider>
          <AppHeader>
            <button type="button">Extra</button>
          </AppHeader>
        </DocumentProvider>
      </ThemeProvider>,
    )
    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent('AI Docs')
    expect(screen.getByRole('button', { name: 'Extra' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeInTheDocument()
  })
})
