import type { PaperSize } from '@/types'

export const PAPER_SIZE_OPTIONS: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'a3', label: 'A3' },
  { value: 'tabloid', label: 'Tabloid' },
]

// the sheet assumed before the user chooses one or saves a preference
export const DEFAULT_PAPER_SIZE: PaperSize = 'a4'

export function isPaperSize(value: unknown): value is PaperSize {
  return PAPER_SIZE_OPTIONS.some(option => option.value === value)
}
