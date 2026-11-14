import type { BinDefaults, PaperSize } from '@/types'
import { DEFAULT_PAPER_SIZE, isPaperSize } from './paperSizes'

export interface UserSettings {
  bedSize: number
  // sheet preselected for a new photo; the photo's own choice wins once saved
  defaultPaperSize: PaperSize
  binDefaults?: Partial<BinDefaults>
}

export const BED_SIZE_MIN_MM = 150
export const BED_SIZE_MAX_MM = 500

const DEFAULTS: UserSettings = { bedSize: 256, defaultPaperSize: DEFAULT_PAPER_SIZE }
const KEY = 'tracefinity-settings'

export function getSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const settings: UserSettings = { ...DEFAULTS, ...JSON.parse(raw) }
    // a stored value from an older or hand-edited file must not reach the API
    if (!isPaperSize(settings.defaultPaperSize)) settings.defaultPaperSize = DEFAULT_PAPER_SIZE
    return settings
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(partial: Partial<UserSettings>): void {
  if (typeof window === 'undefined') return
  try {
    const current = getSettings()
    const next: Record<string, unknown> = { ...current, ...partial }
    for (const key of Object.keys(next)) {
      if (next[key] === undefined) delete next[key]
    }
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // localStorage can be unavailable in private browsing or restricted contexts.
  }
}
