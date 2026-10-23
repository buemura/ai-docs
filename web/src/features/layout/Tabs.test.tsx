import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Tabs, type TabId } from './Tabs'

const panels = {
  editor: <p>Editor panel</p>,
  preview: <p>Preview panel</p>,
  review: <p>Review panel</p>,
}

function Harness({ onChange }: { onChange?: (id: TabId) => void }) {
  const [active, setActive] = useState<TabId>('editor')
  return (
    <Tabs
      active={active}
      onChange={(id) => {
        setActive(id)
        onChange?.(id)
      }}
      panels={panels}
      badges={{ review: <span>3</span> }}
    />
  )
}

describe('Tabs', () => {
  it('renders the three tabs in order with the active one selected', () => {
    render(<Harness />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Editor', 'Preview', 'AI Review3'])
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tablist', { name: 'Document views' })).toBeInTheDocument()
  })

  it('keeps every panel mounted and hides the inactive ones', () => {
    render(<Harness />)
    expect(screen.getByText('Editor panel')).toBeVisible()
    expect(screen.getByText('Preview panel')).not.toBeVisible()
    expect(screen.getByText('Review panel')).not.toBeVisible()
  })

  it('activates a tab on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(onChange).toHaveBeenCalledWith('preview')
    expect(screen.getByText('Preview panel')).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Preview' })).toBeVisible()
  })

  it('supports arrow, Home and End keys with focus following selection', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('tab', { name: 'Editor' }))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /AI Review/ })).toHaveFocus()
    expect(screen.getByRole('tab', { name: /AI Review/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /AI Review/ })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveFocus()
  })

  it('makes only the active tab tabbable', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('tabindex', '-1')
  })
})
