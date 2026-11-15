'use client'

import type { Point } from '@/types'
import { formatMm, type ResolvedDimension } from '@/lib/editorGrid'

interface Props {
  dimensions: ResolvedDimension[]
  // multiplies dimension coordinates into SVG user units
  scale?: number
  // SVG user units per CSS pixel, so strokes and text keep their screen size
  ui: number
  // first vertex of a dimension being placed, in dimension coordinates
  pending?: Point | null
  // clicking a dimension removes it
  onRemove?: (id: string) => void
}

export const DIMENSION_COLOUR = 'rgb(245, 158, 11)'
const HALO = 'rgba(2, 6, 23, 0.75)'

export function DimensionOverlay({ dimensions, scale = 1, ui, pending, onRemove }: Props) {
  return (
    <g>
      {dimensions.map(d => {
        const ax = d.a.x * scale, ay = d.a.y * scale
        const bx = d.b.x * scale, by = d.b.y * scale
        const len = Math.hypot(bx - ax, by - ay)
        // unit normal, pointing up on screen so the label sits above the line
        let nx = 0, ny = -1
        if (len > 0) {
          nx = -(by - ay) / len
          ny = (bx - ax) / len
          if (ny > 0) { nx = -nx; ny = -ny }
        }
        const tick = 6 * ui
        const label = formatMm(d.length)
        // label pill, centred above the midpoint; its box is also the click
        // target, together with the middle of the line but never its ends,
        // which sit on vertices the user still needs to click
        const fontSize = 13 * ui
        const pillW = (label.length * 7.6 + 14) * ui
        const pillH = 22 * ui
        const mx = (ax + bx) / 2 + nx * (pillH / 2 + 6 * ui)
        const my = (ay + by) / 2 + ny * (pillH / 2 + 6 * ui)
        return (
          <g
            key={d.id}
            role="group"
            aria-label={`Dimension ${label}`}
            data-dimension-id={d.id}
            className={onRemove ? 'cursor-pointer' : 'pointer-events-none'}
            onClick={onRemove ? (e) => { e.stopPropagation(); onRemove(d.id) } : undefined}
          >
            <title>{`${label} (Δx ${formatMm(Math.abs(d.dx))}, Δy ${formatMm(Math.abs(d.dy))})${onRemove ? '. Click to remove.' : ''}`}</title>
            {onRemove && (
              <line
                x1={ax + (bx - ax) * 0.2} y1={ay + (by - ay) * 0.2}
                x2={ax + (bx - ax) * 0.8} y2={ay + (by - ay) * 0.8}
                stroke="transparent" strokeWidth={14 * ui}
              />
            )}
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={HALO} strokeWidth={4 * ui} className="pointer-events-none" />
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={DIMENSION_COLOUR} strokeWidth={2 * ui} className="pointer-events-none" />
            {[[ax, ay], [bx, by]].map(([x, y], i) => (
              <line
                key={i}
                x1={x + nx * tick} y1={y + ny * tick}
                x2={x - nx * tick} y2={y - ny * tick}
                stroke={HALO} strokeWidth={4 * ui}
                className="pointer-events-none"
              />
            ))}
            {[[ax, ay], [bx, by]].map(([x, y], i) => (
              <line
                key={`t${i}`}
                x1={x + nx * tick} y1={y + ny * tick}
                x2={x - nx * tick} y2={y - ny * tick}
                stroke={DIMENSION_COLOUR} strokeWidth={2 * ui}
                className="pointer-events-none"
              />
            ))}
            <rect
              x={mx - pillW / 2} y={my - pillH / 2} width={pillW} height={pillH} rx={5 * ui}
              fill={HALO} stroke={DIMENSION_COLOUR} strokeWidth={1 * ui}
            />
            <text
              x={mx} y={my}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={600}
              fill={DIMENSION_COLOUR}
              className="pointer-events-none select-none tabular-nums"
            >
              {label}
            </text>
          </g>
        )
      })}
      {pending && (
        <circle
          cx={pending.x * scale} cy={pending.y * scale} r={11 * ui}
          fill="none" stroke={DIMENSION_COLOUR} strokeWidth={2 * ui}
          strokeDasharray={`${4 * ui},${3 * ui}`}
          className="pointer-events-none"
          data-pending-vertex
        />
      )}
    </g>
  )
}
