import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockApi } from '../../test/sse'
import { MODEL_STORAGE_KEY, ModelProvider, useModels } from './ModelProvider'

function Probe() {
  const { status, selectedModel, models, setSelectedModel } = useModels()
  return (
    <div>
      <p>status: {status}</p>
      <p>selected: {selectedModel ?? 'none'}</p>
      <p>count: {models.length}</p>
      <button type="button" onClick={() => setSelectedModel('claude-haiku-5-5')}>
        pick haiku
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <ModelProvider>
      <Probe />
    </ModelProvider>,
  )
}

describe('ModelProvider', () => {
  it('loads the catalog and selects the server default', async () => {
    mockApi()
    renderProvider()
    expect(screen.getByText('status: loading')).toBeInTheDocument()
    expect(await screen.findByText('status: ready')).toBeInTheDocument()
    expect(screen.getByText('selected: claude-sonnet-5-5')).toBeInTheDocument()
    expect(screen.getByText('count: 2')).toBeInTheDocument()
  })

  it('restores a stored model', async () => {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify('claude-haiku-5-5'))
    mockApi()
    renderProvider()
    expect(await screen.findByText('selected: claude-haiku-5-5')).toBeInTheDocument()
  })

  it('falls back to the server default when the stored model is unknown', async () => {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify('retired-model'))
    mockApi()
    renderProvider()
    expect(await screen.findByText('selected: claude-sonnet-5-5')).toBeInTheDocument()
  })

  it('persists a new selection', async () => {
    const user = userEvent.setup()
    mockApi()
    renderProvider()
    await screen.findByText('status: ready')
    await user.click(screen.getByRole('button', { name: 'pick haiku' }))
    expect(screen.getByText('selected: claude-haiku-5-5')).toBeInTheDocument()
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('"claude-haiku-5-5"')
  })

  it('reports an error when the catalog cannot be loaded', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    renderProvider()
    expect(await screen.findByText('status: error')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('selected: none')).toBeInTheDocument())
  })
})
