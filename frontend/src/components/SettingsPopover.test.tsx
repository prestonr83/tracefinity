// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SettingsPopover } from './SettingsPopover'
import { getSettings } from '@/lib/settings'

const getAppVersion = vi.fn()

vi.mock('@/lib/api', () => ({
  getAppVersion: () => getAppVersion(),
}))

describe('SettingsPopover version display', () => {
  afterEach(() => {
    cleanup()
    getAppVersion.mockReset()
  })

  it('shows the app version when the popover opens', async () => {
    getAppVersion.mockResolvedValue('0.6.0')
    render(<SettingsPopover />)

    fireEvent.click(screen.getByTitle('Settings'))

    expect(await screen.findByText('Version 0.6.0')).toBeTruthy()
  })

  it('omits the version line when the fetch fails', async () => {
    getAppVersion.mockRejectedValue(new Error('offline'))
    render(<SettingsPopover />)

    fireEvent.click(screen.getByTitle('Settings'))

    expect(await screen.findByText('Settings')).toBeTruthy()
    expect(screen.queryByText(/^Version /)).toBeNull()
  })

  it('omits the version line when version reporting is disabled', async () => {
    // SHOW_APP_VERSION=false makes /api/version return 404
    getAppVersion.mockRejectedValue(new Error('not found'))
    render(<SettingsPopover />)

    fireEvent.click(screen.getByTitle('Settings'))

    expect(await screen.findByText('Settings')).toBeTruthy()
    expect(screen.queryByText(/^Version /)).toBeNull()
  })
})

describe('SettingsPopover default paper size', () => {
  afterEach(() => {
    cleanup()
    getAppVersion.mockReset()
    localStorage.clear()
  })

  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

  it('preselects A4 until another sheet is chosen', () => {
    getAppVersion.mockRejectedValue(new Error('offline'))
    render(<SettingsPopover />)
    fireEvent.click(screen.getByTitle('Settings'))

    expect(pressed('A4')).toBe('true')
    expect(pressed('Letter')).toBe('false')
  })

  it('saves the chosen sheet and shows it again on reopen', () => {
    getAppVersion.mockRejectedValue(new Error('offline'))
    render(<SettingsPopover />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Letter' }))

    expect(pressed('Letter')).toBe('true')
    expect(pressed('A4')).toBe('false')
    expect(getSettings().defaultPaperSize).toBe('letter')

    cleanup()
    render(<SettingsPopover />)
    fireEvent.click(screen.getByTitle('Settings'))
    expect(pressed('Letter')).toBe('true')
  })
})
