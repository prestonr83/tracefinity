'use client'

import { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { getAppVersion } from '@/lib/api'
import { BED_SIZE_MAX_MM, BED_SIZE_MIN_MM, getSettings, saveSettings } from '@/lib/settings'
import { DEFAULT_PAPER_SIZE, PAPER_SIZE_OPTIONS } from '@/lib/paperSizes'
import { IconButton } from '@/components/IconButton'
import { NumericInput } from '@/components/NumericInput'
import type { PaperSize } from '@/types'

export function SettingsPopover() {
  const [open, setOpen] = useState(false)
  const [bedSize, setBedSize] = useState(256)
  const [paperSize, setPaperSize] = useState<PaperSize>(DEFAULT_PAPER_SIZE)
  const [version, setVersion] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const settings = getSettings()
    setBedSize(settings.bedSize)
    setPaperSize(settings.defaultPaperSize)
  }, [])

  useEffect(() => {
    if (!open || version !== null) return
    getAppVersion().then(setVersion).catch(() => {})
  }, [open, version])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleBedSizeChange(v: number) {
    setBedSize(v)
    saveSettings({ bedSize: v })
  }

  function handlePaperSizeChange(size: PaperSize) {
    setPaperSize(size)
    saveSettings({ defaultPaperSize: size })
  }

  const pct = ((bedSize - BED_SIZE_MIN_MM) / (BED_SIZE_MAX_MM - BED_SIZE_MIN_MM)) * 100

  return (
    <div ref={ref} className="relative">
      <IconButton onClick={() => setOpen(!open)} title="Settings">
        <Settings className="w-4 h-4" />
      </IconButton>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 glass rounded-[10px] shadow-xl z-50 p-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Settings</h3>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-primary tracking-[0.3px]">Default Bed Size</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={BED_SIZE_MIN_MM}
                max={BED_SIZE_MAX_MM}
                step={1}
                value={bedSize}
                onChange={(e) => handleBedSizeChange(parseInt(e.target.value))}
                className="flex-1 min-w-0"
                style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
              />
              <div className="flex items-center gap-1">
                <NumericInput
                  min={BED_SIZE_MIN_MM}
                  max={BED_SIZE_MAX_MM}
                  step={1}
                  value={bedSize}
                  onChange={handleBedSizeChange}
                  className="w-14 h-7 bg-elevated text-right text-xs font-semibold text-text-primary rounded pr-2 focus:outline-none"
                />
                <span className="text-[10px] text-text-muted w-5">mm</span>
              </div>
            </div>
            <p className="text-[11px] text-text-muted leading-tight mt-1">
              Bins wider than this are automatically split into printable pieces.
            </p>
          </div>

          <div className="space-y-1.5 mt-4" role="group" aria-label="Default Paper Size">
            <span className="text-xs text-text-primary tracking-[0.3px]">Default Paper Size</span>
            <div className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-elevated p-0.5 w-full">
              {PAPER_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handlePaperSizeChange(option.value)}
                  aria-pressed={paperSize === option.value}
                  className={`h-7 px-2 rounded text-xs font-medium whitespace-nowrap ${
                    paperSize === option.value
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-muted leading-tight mt-1">
              Preselected when setting the corners of a new photo. Each photo can still use another sheet.
            </p>
          </div>

          {version && (
            <p className="text-[10px] text-text-muted mt-4 pt-3 border-t border-border">
              Version {version}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
