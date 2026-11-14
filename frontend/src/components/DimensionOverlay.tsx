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
        const tick = 5 * ui
        const mx = (ax + bx) / 2 + nx * 9 * ui
        const my = (ay + by) / 2 + ny * 9 * ui
        const label = formatMm(d.length)
        // click targets: the label and the middle of the line, never its
        // ends, which sit on vertices the user still needs to click
        const hitW = (label.length * 6.5 + 10) * ui
        const hitH = 16 * ui
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
              <>
                <line
                  x1={ax + (bx - ax) * 0.2} y1={ay + (by - ay) * 0.2}
                  x2={ax + (bx - ax) * 0.8} y2={ay + (by - ay) * 0.8}
                  stroke="transparent" strokeWidth={14 * ui}
                />
                <rect x={mx - hitW / 2} y={my - hitH / 2} width={hitW} height={hitH} fill="transparent" />
              </>
            )}
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={HALO} strokeWidth={3.5 * ui} className="pointer-events-none" />
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={DIMENSION_COLOUR} strokeWidth={1.5 * ui} className="pointer-events-none" />
            {[[ax, ay], [bx, by]].map(([x, y], i) => (
              <line
                key={i}
                x1={x + nx * tick} y1={y + ny * tick}
                x2={x - nx * tick} y2={y - ny * tick}
                stroke={DIMENSION_COLOUR} strokeWidth={1.5 * ui}
                className="pointer-events-none"
              />
            ))}
            <text
              x={mx} y={my}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11 * ui}
              fontWeight={600}
              fill={DIMENSION_COLOUR}
              stroke={HALO}
              strokeWidth={3 * ui}
              paintOrder="stroke"
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
