import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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

  it('shows a tour button only when onStartTour is given', async () => {
    const user = userEvent.setup()
    const onStartTour = vi.fn()
    const { rerender } = render(
      <ThemeProvider>
        <DocumentProvider>
          <AppHeader />
        </DocumentProvider>
      </ThemeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Take the tour' })).not.toBeInTheDocument()
    rerender(
      <ThemeProvider>
        <DocumentProvider>
          <AppHeader onStartTour={onStartTour} />
        </DocumentProvider>
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(onStartTour).toHaveBeenCalledOnce()
  })
})
