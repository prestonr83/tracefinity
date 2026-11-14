import type { Point } from '@/types'

// Grid overlay and point-to-point dimensions shared by the trace page's
// PolygonEditor (image pixels) and the tool editor (millimetres). Both pass
// their own coordinate unit; only the formatting assumes millimetres.

export const GRID_MAX_LINES = 200

export interface GridLines {
  // coordinates of the lines, aligned to multiples of `step` from the origin
  positions: number[]
  // the spacing actually drawn: doubled from the requested step until the
  // visible span fits in GRID_MAX_LINES lines
  step: number
}

export function gridLines(min: number, max: number, step: number, maxLines = GRID_MAX_LINES): GridLines {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return { positions: [], step }
  }
  let drawn = step
  while ((max - min) / drawn > maxLines) drawn *= 2
  const positions: number[] = []
  const first = Math.ceil(min / drawn - 1e-9)
  // `+ 0` turns the -0 that Math.ceil gives at the origin into 0
  for (let i = first; i * drawn <= max + 1e-9; i++) positions.push(i * drawn + 0)
  return { positions, step: drawn }
}

// nearest grid point to `value`; `origin` lets the grid start somewhere other than 0
export function snapToStep(value: number, step: number, origin = 0): number {
  if (!(step > 0)) return value
  return origin + Math.round((value - origin) / step) * step
}

// A dimension references outline vertices, not positions, so it follows a
// dragged vertex. `count` is the outline's vertex count when the reference
// was made: an insert or delete renumbers vertices, so a reference into an
// outline of another length no longer names the vertex the user picked and
// is dropped rather than shown against the wrong one.
export interface VertexRef {
  poly: string | null
  index: number
  count: number
}

export interface Dimension {
  id: string
  a: VertexRef
  b: VertexRef
}

export interface ResolvedDimension {
  id: string
  a: Point
  b: Point
  // millimetres
  length: number
  dx: number
  dy: number
}

export type VertexLookup = (ref: VertexRef) => Point | null

export function sameVertex(a: VertexRef, b: VertexRef): boolean {
  return a.poly === b.poly && a.index === b.index
}

export function hasDimension(dimensions: Dimension[], a: VertexRef, b: VertexRef): boolean {
  return dimensions.some(d =>
    (sameVertex(d.a, a) && sameVertex(d.b, b)) || (sameVertex(d.a, b) && sameVertex(d.b, a)))
}

let dimensionCounter = 0
export function createDimension(a: VertexRef, b: VertexRef): Dimension {
  return { id: `dim-${++dimensionCounter}`, a, b }
}

// lookup for one outline; `poly` is null in the single-outline tool editor
export function vertexLookup(points: Point[], poly: string | null = null): VertexLookup {
  return ref => {
    if (ref.poly !== poly || ref.count !== points.length) return null
    return points[ref.index] ?? null
  }
}

export function measureBetween(a: Point, b: Point, unitsToMm = 1): Pick<ResolvedDimension, 'length' | 'dx' | 'dy'> {
  const dx = (b.x - a.x) * unitsToMm
  const dy = (b.y - a.y) * unitsToMm
  return { length: Math.hypot(dx, dy), dx, dy }
}

// drops dimensions whose vertices can no longer be found
export function resolveDimensions(dimensions: Dimension[], lookup: VertexLookup, unitsToMm = 1): ResolvedDimension[] {
  const resolved: ResolvedDimension[] = []
  for (const d of dimensions) {
    const a = lookup(d.a)
    const b = lookup(d.b)
    if (!a || !b) continue
    resolved.push({ id: d.id, a, b, ...measureBetween(a, b, unitsToMm) })
  }
  return resolved
}

export function pruneDimensions(dimensions: Dimension[], lookup: VertexLookup): Dimension[] {
  const kept = dimensions.filter(d => lookup(d.a) && lookup(d.b))
  return kept.length === dimensions.length ? dimensions : kept
}

// a flip reverses vertex order to keep the winding; follow the renumbering
export function reverseVertexRefs(dimensions: Dimension[], poly: string | null = null): Dimension[] {
  const reverse = (ref: VertexRef): VertexRef =>
    ref.poly === poly ? { ...ref, index: ref.count - 1 - ref.index } : ref
  return dimensions.map(d => ({ ...d, a: reverse(d.a), b: reverse(d.b) }))
}

export function formatMm(mm: number): string {
  return `${mm.toFixed(1)} mm`
}
