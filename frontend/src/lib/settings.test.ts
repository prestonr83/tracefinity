// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { getSettings, saveSettings } from './settings'

describe('default paper size setting', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to A4', () => {
    expect(getSettings().defaultPaperSize).toBe('a4')
  })

  it('keeps the saved sheet alongside the other settings', () => {
    saveSettings({ bedSize: 300 })
    saveSettings({ defaultPaperSize: 'letter' })
    expect(getSettings()).toMatchObject({ bedSize: 300, defaultPaperSize: 'letter' })
  })

  it('falls back to A4 when the stored value is not a known sheet', () => {
    localStorage.setItem('tracefinity-settings', JSON.stringify({ bedSize: 256, defaultPaperSize: 'a5' }))
    expect(getSettings().defaultPaperSize).toBe('a4')
  })

  it('fills the sheet in for settings saved before it existed', () => {
    localStorage.setItem('tracefinity-settings', JSON.stringify({ bedSize: 300 }))
    expect(getSettings()).toMatchObject({ bedSize: 300, defaultPaperSize: 'a4' })
  })
})
