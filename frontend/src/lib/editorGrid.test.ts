import { describe, expect, it } from 'vitest'
import {
  gridLines, snapToStep, vertexLookup, resolveDimensions, pruneDimensions, reverseVertexRefs,
  createDimension, hasDimension, formatMm,
} from './editorGrid'

describe('gridLines', () => {
  it('aligns lines to multiples of the step from the origin', () => {
    expect(gridLines(-12, 23, 5).positions).toEqual([-10, -5, 0, 5, 10, 15, 20])
  })

  it('includes lines that fall exactly on the bounds', () => {
    expect(gridLines(0, 20, 10).positions).toEqual([0, 10, 20])
  })

  it('doubles the step until the span fits the line budget', () => {
    const grid = gridLines(0, 1000, 1, 200)
    expect(grid.step).toBe(8)
    expect(grid.positions).toHaveLength(126)
    expect(grid.positions[0]).toBe(0)
    expect(grid.positions[125]).toBe(1000)
  })

  it('keeps the requested step when it fits', () => {
    expect(gridLines(0, 100, 5).step).toBe(5)
  })

  it('places fractional steps without drift', () => {
    expect(gridLines(0, 1.5, 0.5).positions).toEqual([0, 0.5, 1, 1.5])
  })

  it('draws nothing for a non-positive step or an empty span', () => {
    expect(gridLines(0, 10, 0).positions).toEqual([])
    expect(gridLines(10, 0, 5).positions).toEqual([])
  })
})

describe('snapToStep', () => {
  it('rounds to the nearest grid point', () => {
    expect(snapToStep(23.2, 5)).toBe(25)
    expect(snapToStep(22.4, 5)).toBe(20)
  })

  it('measures the grid from the given origin', () => {
    expect(snapToStep(23.2, 5, 1)).toBe(21)
  })

  it('leaves the value alone without a usable step', () => {
    expect(snapToStep(23.2, 0)).toBe(23.2)
  })
})

describe('dimensions', () => {
  const points = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 40 }]
  const ref = (index: number, count = 4) => ({ poly: null, index, count })

  it('measures between the referenced vertices', () => {
    const [resolved] = resolveDimensions([createDimension(ref(0), ref(2))], vertexLookup(points))
    expect(resolved.length).toBe(50)
    expect(resolved.dx).toBe(30)
    expect(resolved.dy).toBe(40)
    expect(resolved.a).toEqual(points[0])
    expect(resolved.b).toEqual(points[2])
  })

  it('converts pixel coordinates with the given scale', () => {
    const [resolved] = resolveDimensions([createDimension(ref(0), ref(1))], vertexLookup(points), 0.5)
    expect(resolved.length).toBe(15)
    expect(resolved.dx).toBe(15)
  })

  it('drops a dimension once the outline has a different vertex count', () => {
    const dims = [createDimension(ref(0), ref(1))]
    const grown = [...points, { x: 15, y: 50 }]
    expect(resolveDimensions(dims, vertexLookup(grown))).toEqual([])
    expect(pruneDimensions(dims, vertexLookup(grown))).toEqual([])
    // unchanged input keeps its identity so state updates can be skipped
    expect(pruneDimensions(dims, vertexLookup(points))).toBe(dims)
  })

  it('only resolves against the outline it was measured on', () => {
    const dims = [createDimension({ poly: 'a', index: 0, count: 4 }, { poly: 'a', index: 1, count: 4 })]
    expect(resolveDimensions(dims, vertexLookup(points, 'b'))).toEqual([])
    expect(resolveDimensions(dims, vertexLookup(points, 'a'))).toHaveLength(1)
  })

  it('follows a flip that reverses the vertex order', () => {
    const dims = [createDimension(ref(0), ref(1))]
    const flipped = points.map(p => ({ x: 30 - p.x, y: p.y })).reverse()
    const [resolved] = resolveDimensions(reverseVertexRefs(dims), vertexLookup(flipped))
    expect(resolved.a).toEqual({ x: 30, y: 0 })
    expect(resolved.b).toEqual({ x: 0, y: 0 })
  })

  it('leaves references to other outlines alone when one is flipped', () => {
    const other = { poly: 'b', index: 0, count: 4 }
    const [dim] = reverseVertexRefs([createDimension({ poly: 'a', index: 0, count: 4 }, other)], 'a')
    expect(dim.a.index).toBe(3)
    expect(dim.b).toEqual(other)
  })

  it('treats a pair as the same dimension in either order', () => {
    const dims = [createDimension(ref(0), ref(1))]
    expect(hasDimension(dims, ref(1), ref(0))).toBe(true)
    expect(hasDimension(dims, ref(1), ref(2))).toBe(false)
  })

  it('formats lengths to one decimal', () => {
    expect(formatMm(12.345)).toBe('12.3 mm')
    expect(formatMm(20)).toBe('20.0 mm')
  })
})
