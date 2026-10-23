import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockApi } from '../../test/sse'
import { MODEL_STORAGE_KEY, ModelProvider } from './ModelProvider'
import { ModelSelect } from './ModelSelect'

function renderSelect() {
  return render(
    <ModelProvider>
      <ModelSelect />
    </ModelProvider>,
  )
}

describe('ModelSelect', () => {
  it('lists the models and changes the selection', async () => {
    const user = userEvent.setup()
    mockApi()
    renderSelect()
    await screen.findByRole('option', { name: 'Claude Haiku 5.5' })
    const select = screen.getByRole('combobox', { name: 'AI model' })
    expect(select).toHaveValue('claude-sonnet-5-5')
    expect(select).toBeEnabled()

    await user.selectOptions(select, 'claude-haiku-5-5')
    expect(select).toHaveValue('claude-haiku-5-5')
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('"claude-haiku-5-5"')
  })

  it('is disabled while loading', () => {
    mockApi({ models: () => new Promise<Response>(() => {}) })
    renderSelect()
    expect(screen.getByRole('combobox', { name: 'AI model' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Loading models…' })).toBeInTheDocument()
  })

  it('shows "AI unavailable" when the catalog fails to load', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    renderSelect()
    expect(await screen.findByRole('option', { name: 'AI unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'AI model' })).toBeDisabled()
  })
})
