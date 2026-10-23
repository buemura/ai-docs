import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentProvider, useDocument } from '../document/DocumentProvider'
import type { Version } from './types'
import { useVersions, VersionsProvider } from './VersionsProvider'

const DOC_KEY = 'ai-docs:document'
const VERSIONS_KEY = 'ai-docs:versions'

function seedDocument(content: string) {
  localStorage.setItem(DOC_KEY, JSON.stringify({ content, updatedAt: 1 }))
}

function seedVersions(versions: Version[]) {
  localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions))
}

function stored(): Version[] {
  return JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? '[]') as Version[]
}

function Probe() {
  const { versions, record, restore } = useVersions()
  const { content } = useDocument()
  return (
    <div>
      <output data-testid="content">{content}</output>
      <output data-testid="versions">
        {JSON.stringify(
          versions.map(({ source, label, content: c }) => ({ source, label, content: c })),
        )}
      </output>
      <button
        type="button"
        onClick={() => record({ source: 'manual', label: 'Snap', content: 'changed\n' })}
      >
        record
      </button>
      <button
        type="button"
        onClick={() =>
          record({ source: 'manual', label: 'Dup', content: versions.at(-1)?.content ?? '' })
        }
      >
        dup
      </button>
      <button type="button" onClick={() => restore(versions[0].id)}>
        restore-first
      </button>
    </div>
  )
}

function renderProbe() {
  return render(
    <DocumentProvider>
      <VersionsProvider>
        <Probe />
      </VersionsProvider>
    </DocumentProvider>,
  )
}

function shownVersions() {
  return JSON.parse(screen.getByTestId('versions').textContent ?? '[]') as Array<
    Pick<Version, 'source' | 'label' | 'content'>
  >
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VersionsProvider', () => {
  it('records an initial version of the stored document when history is empty', () => {
    seedDocument('# Hello\n')
    renderProbe()
    expect(shownVersions()).toEqual([
      { source: 'initial', label: 'Initial version', content: '# Hello\n' },
    ])
    expect(stored()).toHaveLength(1)
  })

  it('loads stored versions without adding an initial version', () => {
    seedDocument('# Hello\n')
    seedVersions([{ id: 'v1', createdAt: 1, source: 'ai', label: 'Shorter', content: '# Hi\n' }])
    renderProbe()
    expect(shownVersions()).toEqual([{ source: 'ai', label: 'Shorter', content: '# Hi\n' }])
  })

  it('falls back to an initial version when stored data is invalid', () => {
    seedDocument('# Hello\n')
    localStorage.setItem(VERSIONS_KEY, JSON.stringify([{ nope: true }]))
    renderProbe()
    expect(shownVersions().map((x) => x.source)).toEqual(['initial'])
  })

  it('records and persists a new version', async () => {
    seedDocument('# Hello\n')
    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'record' }))
    expect(shownVersions().map((x) => x.label)).toEqual(['Initial version', 'Snap'])
    expect(stored().map((x) => x.label)).toEqual(['Initial version', 'Snap'])
    expect(stored()[1].id).not.toBe('')
    expect(typeof stored()[1].createdAt).toBe('number')
  })

  it('ignores a record whose content equals the latest version', async () => {
    seedDocument('# Hello\n')
    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'dup' }))
    expect(shownVersions()).toHaveLength(1)
  })

  it('restores a version into the document and records a restore version', async () => {
    seedDocument('# Hello\n')
    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'record' }))
    await userEvent.click(screen.getByRole('button', { name: 'restore-first' }))
    expect(screen.getByTestId('content').textContent).toBe('# Hello\n')
    expect(shownVersions().at(-1)).toEqual({
      source: 'restore',
      label: 'Restored "Initial version"',
      content: '# Hello\n',
    })
  })

  it('persists only the newest 20 versions when saving hits the storage quota', () => {
    seedDocument('# Hello\n')
    seedVersions(
      Array.from({ length: 30 }, (_, i) => ({
        id: `v${i}`,
        createdAt: i,
        source: 'manual' as const,
        label: `L${i}`,
        content: `c${i}`,
      })),
    )
    const realSetItem = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === VERSIONS_KEY && !failed) {
        failed = true
        throw new DOMException('full', 'QuotaExceededError')
      }
      realSetItem.call(this, key, value)
    })
    act(() => {
      renderProbe()
    })
    expect(stored()).toHaveLength(20)
    expect(stored()[0].id).toBe('v10')
    expect(stored().at(-1)?.id).toBe('v29')
    expect(shownVersions()).toHaveLength(30)
  })

  it('throws when useVersions is used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Orphan() {
      useVersions()
      return null
    }
    expect(() => render(<Orphan />)).toThrow('useVersions must be used within a VersionsProvider')
  })
})
