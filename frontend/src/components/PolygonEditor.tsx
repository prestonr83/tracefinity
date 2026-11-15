'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Point, Polygon } from '@/types'
import { Undo2, Redo2, Trash2, Plus, Minus, Move, Ruler, Grid2x2, Magnet, X } from 'lucide-react'
import { polygonPathData } from '@/lib/svg'
import { useHistory } from '@/hooks/useHistory'
import { SNAP_GRID, SNAP_GRID_MIN, SNAP_GRID_MAX, ZOOM_FACTOR } from '@/lib/constants'
import { clampZoom, zoomedViewBox, viewBoxPoint, zoomAtCursor, uiScaleFor } from '@/lib/viewbox'
import {
  gridLines, snapToStep, resolveDimensions, pruneDimensions, createDimension, hasDimension, sameVertex,
  type Dimension, type VertexRef,
} from '@/lib/editorGrid'
import { DimensionOverlay, DIMENSION_COLOUR } from '@/components/DimensionOverlay'
import { NumericInput } from '@/components/NumericInput'

interface Props {
  imageUrl: string
  polygons: Polygon[]
  onPolygonsChange: (polygons: Polygon[]) => void
  // millimetres per image pixel from the paper calibration; without it the
  // grid, snapping and measurements have no physical size and stay hidden
  mmPerPx?: number | null
  editable?: boolean
  included?: Set<string>
  onIncludedChange?: (ids: Set<string>) => void
  hovered?: string | null
  onHoveredChange?: (id: string | null) => void
}
// dark halo painted under outlines so they stay legible over photographs
const HALO_STROKE = 'rgba(2, 6, 23, 0.55)'

type EditMode = 'select' | 'vertex' | 'add-vertex' | 'delete-vertex' | 'measure'
type DragState =
  | { type: 'vertex'; polyId: string; pointIdx: number }
  | { type: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number; svgScale: number }
  | null

// drawn one screen pixel wide with crisp edges: a sub-pixel translucent
// line all but vanishes over a grey photograph
const GRID_STROKE = 'rgba(56, 160, 215, 0.8)'
const GRID_MAJOR_STROKE = 'rgb(56, 160, 215)'
const GRID_MAJOR_EVERY = 5
const toolbarToggle = (active: boolean) =>
  `p-2 rounded transition-colors cursor-pointer ${active ? 'bg-accent-muted text-accent' : 'hover:bg-border text-text-secondary'}`

export function PolygonEditor({
  imageUrl,
  polygons,
  onPolygonsChange,
  mmPerPx = null,
  editable = true,
  included,
  onIncludedChange,
  hovered,
  onHoveredChange,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [fitted, setFitted] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const spaceHeld = useRef(false)
  const didPanRef = useRef(false)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])
  // fitted is the measured size of the box the viewBox paints into, so one
  // uiScale unit lands as one CSS pixel regardless of image aspect
  const uiScale = uiScaleFor(imageSize.width, fitted.width, zoom)

  // active polygon for vertex editing (internal)
  const [activeId, setActiveId] = useState<string | null>(null)
  // fallback single-select when no inclusion tracking
  const [internalSelected, setInternalSelected] = useState<string | null>(null)

  const hasInclusion = included !== undefined
  const isIncluded = useCallback((id: string) => {
    if (hasInclusion) return included!.has(id)
    return internalSelected === id
  }, [hasInclusion, included, internalSelected])

  const [editMode, setEditMode] = useState<EditMode>('select')
  const [dragging, setDragging] = useState<DragState>(null)

  // grid overlay and snapping share one spacing, set in mm and drawn in px
  const hasScale = typeof mmPerPx === 'number' && mmPerPx > 0
  const [showGrid, setShowGrid] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [gridStep, setGridStep] = useState(SNAP_GRID)
  const stepPx = hasScale ? gridStep / mmPerPx : 0
  // point-to-point measurements; view-only, so they stay out of undo history
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [pendingVertex, setPendingVertex] = useState<VertexRef | null>(null)
  const measuring = editable && editMode === 'measure'

  const { set: pushHistory, undo: handleUndo, redo: handleRedo, canUndo, canRedo } = useHistory<Polygon[]>(
    polygons,
    onPolygonsChange
  )

  // a reference only resolves against the outline it was made on, at the
  // vertex count it had then; add or delete renumbers the vertices
  const lookupVertex = useCallback((ref: VertexRef): Point | null => {
    const poly = polygons.find(p => p.id === ref.poly)
    if (!poly || poly.points.length !== ref.count) return null
    return poly.points[ref.index] ?? null
  }, [polygons])
  const resolvedDimensions = useMemo(
    () => hasScale ? resolveDimensions(dimensions, lookupVertex, mmPerPx) : [],
    [dimensions, lookupVertex, hasScale, mmPerPx])
  const pendingPoint = pendingVertex ? lookupVertex(pendingVertex) : null
  // adjust state during render so a renumbered outline never commits with
  // measurements that no longer name the vertices the user picked
  const prunedDimensions = pruneDimensions(dimensions, lookupVertex)
  if (prunedDimensions !== dimensions) setDimensions(prunedDimensions)
  if (pendingVertex && !pendingPoint) setPendingVertex(null)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingVertex(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const removeDimension = useCallback((id: string) => {
    setDimensions(current => current.filter(d => d.id !== id))
  }, [])
  const clearDimensions = () => {
    setDimensions([])
    setPendingVertex(null)
  }
  // first click marks a vertex, second click measures to it
  const measureVertex = (polyId: string, pointIdx: number) => {
    const poly = polygons.find(p => p.id === polyId)
    if (!poly) return
    const ref: VertexRef = { poly: polyId, index: pointIdx, count: poly.points.length }
    if (!pendingVertex) {
      setPendingVertex(ref)
      return
    }
    if (!sameVertex(pendingVertex, ref)) {
      const a = pendingVertex
      setDimensions(dims => hasDimension(dims, a, ref) ? dims : [...dims, createDimension(a, ref)])
    }
    setPendingVertex(null)
  }

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = imageUrl
    return () => { cancelled = true }
  }, [imageUrl])

  // fit image container to available space while preserving aspect ratio
  useEffect(() => {
    function updateSize() {
      if (!wrapperRef.current || !imageSize.width || !imageSize.height) return
      const availW = wrapperRef.current.clientWidth
      const availH = wrapperRef.current.clientHeight
      const imgAspect = imageSize.width / imageSize.height
      let w = availW
      let h = w / imgAspect
      if (h > availH) {
        h = availH
        w = h * imgAspect
      }
      setFitted({ width: Math.floor(w), height: Math.floor(h) })
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [imageSize])

  // refs for stale closure avoidance during drag
  const polygonsRef = useRef(polygons)
  const onPolygonsChangeRef = useRef(onPolygonsChange)
  useEffect(() => { polygonsRef.current = polygons }, [polygons])
  useEffect(() => { onPolygonsChangeRef.current = onPolygonsChange }, [onPolygonsChange])

  // container is aspect-fitted to the image, so client fractions map straight into the viewBox
  const vb = useMemo(
    () => zoomedViewBox(imageSize.width, imageSize.height, zoom, pan),
    [imageSize, zoom, pan]
  )

  const getScaledPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }

      const rect = containerRef.current.getBoundingClientRect()
      const point = viewBoxPoint(vb, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height)

      return {
        x: Math.max(0, Math.min(imageSize.width, point.x)),
        y: Math.max(0, Math.min(imageSize.height, point.y)),
      }
    },
    [imageSize, vb]
  )

  // nearest grid point, kept inside the image like an unsnapped point
  const snapPoint = useCallback((p: Point): Point => {
    if (!snapEnabled || !(stepPx > 0)) return p
    return {
      x: Math.max(0, Math.min(imageSize.width, snapToStep(p.x, stepPx))),
      y: Math.max(0, Math.min(imageSize.height, snapToStep(p.y, stepPx))),
    }
  }, [snapEnabled, stepPx, imageSize])

  // grid lines over the visible part of the image
  const grid = useMemo(() => {
    if (!showGrid || !(stepPx > 0)) return null
    const minX = Math.max(0, vb.x), maxX = Math.min(imageSize.width, vb.x + vb.w)
    const minY = Math.max(0, vb.y), maxY = Math.min(imageSize.height, vb.y + vb.h)
    const xs = gridLines(minX, maxX, stepPx)
    const ys = gridLines(minY, maxY, stepPx)
    // every fifth line of the spacing actually drawn is emphasised
    const major = (v: number, step: number) => Math.round(v / step) % GRID_MAJOR_EVERY === 0
    return {
      minX, maxX, minY, maxY,
      xs: xs.positions.map(x => ({ at: x, major: major(x, xs.step) })),
      ys: ys.positions.map(y => ({ at: y, major: major(y, ys.step) })),
    }
  }, [showGrid, stepPx, vb, imageSize])

  // scroll-to-zoom centred on the cursor (needs passive: false for preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el || !imageSize.width) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const oldZoom = zoomRef.current
      const newZoom = clampZoom(oldZoom * factor)
      if (newZoom === oldZoom) return
      const rect = el.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / rect.width
      const fy = (e.clientY - rect.top) / rect.height
      setPan(zoomAtCursor(imageSize.width, imageSize.height, oldZoom, newZoom, panRef.current, fx, fy))
      setZoom(newZoom)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [imageSize])

  // space key for pan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeld.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const updatePolygons = useCallback((updated: Polygon[]) => {
    pushHistory(updated)
    onPolygonsChange(updated)
  }, [pushHistory, onPolygonsChange])

  // swallow the click that follows a pan release
  const consumeDidPan = () => {
    if (didPanRef.current) {
      didPanRef.current = false
      return true
    }
    return false
  }

  const handlePolygonClick = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (consumeDidPan()) return
    if (!editable) return

    if (editMode !== 'select') {
      // in editing modes, set active for vertex editing
      setActiveId(activeId === id ? null : id)
    } else if (hasInclusion && onIncludedChange) {
      // toggle inclusion
      const next = new Set(included!)
      if (next.has(id)) {
        next.delete(id)
        if (activeId === id) setActiveId(null)
      } else {
        next.add(id)
        setActiveId(id)
      }
      onIncludedChange(next)
    } else {
      // fallback single-select
      const newSel = internalSelected === id ? null : id
      setInternalSelected(newSel)
      setActiveId(newSel)
    }
  }

  const handleEdgeClick = (polyId: string, edgeIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (consumeDidPan()) return
    if (!editable || editMode !== 'add-vertex') return

    const point = getScaledPoint(e.clientX, e.clientY)
    const updated = polygons.map((poly) => {
      if (poly.id !== polyId) return poly
      const points = [...poly.points]
      points.splice(edgeIdx + 1, 0, point)
      return { ...poly, points }
    })
    updatePolygons(updated)
  }

  const handleVertexClick = (polyId: string, pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (consumeDidPan()) return
    if (!editable) return

    if (editMode === 'measure') {
      measureVertex(polyId, pointIdx)
      return
    }

    if (editMode === 'delete-vertex') {
      const poly = polygons.find(p => p.id === polyId)
      if (!poly || poly.points.length <= 3) return // need at least 3 points

      const updated = polygons.map((p) => {
        if (p.id !== polyId) return p
        const points = [...p.points]
        points.splice(pointIdx, 1)
        return { ...p, points }
      })
      updatePolygons(updated)
    }
  }

  const handleVertexMouseDown = (polyId: string, pointIdx: number) => (e: React.MouseEvent) => {
    // let pan triggers bubble to the canvas handler
    if (spaceHeld.current || e.button !== 0) return
    e.stopPropagation()
    if (editable && (editMode === 'vertex' || editMode === 'select')) {
      setDragging({ type: 'vertex', polyId, pointIdx })
    }
  }

  const handleVertexTouchStart = (polyId: string, pointIdx: number) => (e: React.TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (editable && (editMode === 'vertex' || editMode === 'select')) {
      setDragging({ type: 'vertex', polyId, pointIdx })
    }
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return

      if (dragging.type === 'pan') {
        const dx = (e.clientX - dragging.startClientX) / dragging.svgScale
        const dy = (e.clientY - dragging.startClientY) / dragging.svgScale
        setPan({ x: dragging.origPanX - dx, y: dragging.origPanY - dy })
        didPanRef.current = true
        return
      }

      const point = snapPoint(getScaledPoint(e.clientX, e.clientY))

      if (dragging.type === 'vertex') {
        const updated = polygonsRef.current.map((poly) => {
          if (poly.id !== dragging.polyId) return poly
          const points = [...poly.points]
          points[dragging.pointIdx] = point
          return { ...poly, points }
        })
        onPolygonsChangeRef.current(updated) // don't push to history during drag
      }
    },
    [dragging, getScaledPoint, snapPoint]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!dragging) return
      e.preventDefault()
      const t = e.touches[0]
      const point = snapPoint(getScaledPoint(t.clientX, t.clientY))

      if (dragging.type === 'vertex') {
        const updated = polygonsRef.current.map((poly) => {
          if (poly.id !== dragging.polyId) return poly
          const points = [...poly.points]
          points[dragging.pointIdx] = point
          return { ...poly, points }
        })
        onPolygonsChangeRef.current(updated)
      }
    },
    [dragging, getScaledPoint, snapPoint]
  )

  const handleMouseUp = useCallback(() => {
    // pan never touches the polygons, so it never enters history
    if (dragging && dragging.type !== 'pan') {
      pushHistory(polygonsRef.current)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  const handleTouchEnd = useCallback(() => {
    if (dragging && dragging.type !== 'pan') {
      pushHistory(polygonsRef.current)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMove, { passive: false })
      window.addEventListener('touchend', handleTouchEnd)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd])

  const handleBackgroundClick = () => {
    if (consumeDidPan()) return
    setActiveId(null)
    setPendingVertex(null)
  }

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const isPanTrigger = e.button === 1 || (e.button === 0 && spaceHeld.current)
    if (!isPanTrigger) return
    // preventDefault suppresses middle-mouse autoscroll
    e.preventDefault()
    if (!containerRef.current || !imageSize.width) return
    const rect = containerRef.current.getBoundingClientRect()
    const svgScale = rect.width / (imageSize.width / zoom)
    setDragging({
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      svgScale,
    })
  }

  const handleResetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleDeletePolygon = (id: string) => {
    updatePolygons(polygons.filter((p) => p.id !== id))
    if (activeId === id) setActiveId(null)
    if (hasInclusion && onIncludedChange) {
      const next = new Set(included!)
      next.delete(id)
      onIncludedChange(next)
    }
  }

  // auto-activate first included polygon when switching to edit modes
  const handleModeChange = (mode: EditMode) => {
    setEditMode(mode)
    if (mode !== 'measure') setPendingVertex(null)
    if ((mode === 'vertex' || mode === 'add-vertex' || mode === 'delete-vertex' || mode === 'measure') && !activeId && polygons.length > 0) {
      const first = hasInclusion
        ? polygons.find(p => included!.has(p.id))
        : polygons[0]
      if (first) setActiveId(first.id)
    }
  }

  if (!imageSize.width) {
    return <div className="bg-inset rounded-lg aspect-[4/3]" />
  }

  const activePoly = polygons.find(p => p.id === activeId)

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* toolbar */}
      {editable && (
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex gap-1 bg-elevated rounded-[10px] p-1 border border-border">
            <button
              onClick={() => handleModeChange('vertex')}
              className={`p-2 rounded transition-colors cursor-pointer ${
                editMode === 'vertex' || editMode === 'select'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Move vertices"
            >
              <Move className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleModeChange('add-vertex')}
              className={`p-2 rounded transition-colors cursor-pointer ${
                editMode === 'add-vertex'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Add vertex"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleModeChange('delete-vertex')}
              className={`p-2 rounded transition-colors cursor-pointer ${
                editMode === 'delete-vertex'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Delete vertex"
              disabled={activePoly && activePoly.points.length <= 3}
            >
              <Minus className="w-5 h-5" />
            </button>
            {hasScale && (
              <button
                onClick={() => handleModeChange('measure')}
                className={toolbarToggle(editMode === 'measure')}
                aria-label="Measure"
                title="Measure between two outline points"
              >
                <Ruler className="w-5 h-5" />
              </button>
            )}
          </div>

          {hasScale && (
            <>
              <div className="h-6 w-px bg-border-subtle" />

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowGrid(!showGrid)}
                  aria-pressed={showGrid}
                  aria-label="Grid"
                  className={toolbarToggle(showGrid)}
                  title={showGrid ? `Hide the ${gridStep}mm grid` : `Show a ${gridStep}mm grid`}
                >
                  <Grid2x2 className="w-5 h-5" />
                </button>
                <NumericInput
                  value={gridStep}
                  onChange={setGridStep}
                  min={SNAP_GRID_MIN}
                  max={SNAP_GRID_MAX}
                  step={0.5}
                  title="Grid spacing (mm). The grid is drawn and snapped at this spacing."
                  className="w-14 h-8 px-1 bg-elevated border border-border rounded text-text-primary text-xs text-center outline-none focus:border-accent"
                />
                <span className="text-xs text-text-muted">mm</span>
                <button
                  onClick={() => setSnapEnabled(!snapEnabled)}
                  aria-pressed={snapEnabled}
                  aria-label="Snap"
                  className={toolbarToggle(snapEnabled)}
                  title={`Snap dragged vertices to the ${gridStep}mm grid${snapEnabled ? ' (on)' : ' (off)'}`}
                >
                  <Magnet className="w-5 h-5" />
                </button>
              </div>

              {resolvedDimensions.length > 0 && (
                <button
                  onClick={clearDimensions}
                  className="px-2 py-1.5 rounded text-sm text-text-secondary hover:bg-border flex items-center gap-1 transition-colors cursor-pointer"
                  title="Remove all measurements"
                >
                  <X className="w-4 h-4" />
                  Clear {resolvedDimensions.length}
                </button>
              )}
            </>
          )}

          <div className="h-6 w-px bg-border-subtle" />

          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="p-2 rounded hover:bg-border text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="p-2 rounded hover:bg-border text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-5 h-5" />
            </button>
          </div>

          <span className="text-sm text-text-muted" role="status">
            {(editMode === 'select' || editMode === 'vertex') && !activeId && 'Click outlines to select tools'}
            {(editMode === 'select' || editMode === 'vertex') && activeId && 'Drag vertices to adjust the outline'}
            {editMode === 'add-vertex' && 'Click on an edge to add a vertex'}
            {editMode === 'delete-vertex' && 'Click a vertex to remove it'}
            {editMode === 'measure' && (pendingVertex
              ? 'Click a second point to finish the measurement, or Escape to cancel'
              : 'Click two outline points to measure between them; click a measurement to remove it')}
          </span>

          {activeId && (
            <button
              onClick={() => handleDeletePolygon(activeId)}
              className="ml-auto px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 rounded border border-red-800 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      )}

      <div ref={wrapperRef} className="flex-1 min-h-0 flex items-center justify-center">
        <div
          ref={containerRef}
          className={`relative bg-inset rounded-lg overflow-hidden ${dragging?.type === 'pan' ? 'cursor-grabbing' : ''}`}
          style={fitted.width ? { width: fitted.width, height: fitted.height } : { width: '100%', aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
          onClick={handleBackgroundClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseDownCapture={() => { didPanRef.current = false }}
        >
        <svg
          className={`absolute inset-0 w-full h-full ${dragging?.type === 'pan' ? 'pointer-events-none' : ''}`}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        >
          {/* photo lives inside the svg so it zooms and pans with the polygons */}
          <image
            href={imageUrl}
            x={0}
            y={0}
            width={imageSize.width}
            height={imageSize.height}
            preserveAspectRatio="none"
            role="img"
            aria-label="Corrected"
            className="pointer-events-none select-none"
          />

          {/* grid in real millimetres, from the image origin */}
          {grid && (
            <g className="pointer-events-none" shapeRendering="crispEdges">
              {grid.xs.map(({ at, major }) => (
                <line key={`gx${at}`} data-grid-line="x" x1={at} y1={grid.minY} x2={at} y2={grid.maxY}
                  stroke={major ? GRID_MAJOR_STROKE : GRID_STROKE} strokeWidth={uiScale * (major ? 2 : 1)} />
              ))}
              {grid.ys.map(({ at, major }) => (
                <line key={`gy${at}`} data-grid-line="y" x1={grid.minX} y1={at} x2={grid.maxX} y2={at}
                  stroke={major ? GRID_MAJOR_STROKE : GRID_STROKE} strokeWidth={uiScale * (major ? 2 : 1)} />
              ))}
            </g>
          )}

          {polygons.map((poly) => {
            const isActive = activeId === poly.id
            const polyIncluded = isIncluded(poly.id)
            const isHovered = hovered === poly.id
            const pathData = polygonPathData(poly.points, poly.interior_rings)
            const showHandles = editable && (
              (isActive && (editMode === 'vertex' || editMode === 'select' || editMode === 'add-vertex' || editMode === 'delete-vertex'))
              // measuring works across every selected tool, not only the active one
              || (measuring && (isActive || polyIncluded)))

            let fill = 'rgba(90, 180, 222, 0.08)'
            let stroke = 'rgba(90, 180, 222, 0.85)'
            let strokeW = uiScale * 1
            if (isActive) {
              fill = 'rgba(90, 180, 222, 0.3)'
              stroke = 'rgb(72, 168, 214)'
              strokeW = uiScale * 2
            } else if (polyIncluded) {
              fill = 'rgba(90, 180, 222, 0.2)'
              stroke = 'rgb(72, 168, 214)'
              strokeW = uiScale * 1.5
            } else if (isHovered) {
              fill = 'rgba(90, 180, 222, 0.18)'
              stroke = 'rgb(90, 180, 222)'
              strokeW = uiScale * 1.5
            }

            return (
              <g key={poly.id}>
                <path
                  d={pathData}
                  fillRule="evenodd"
                  fill="none"
                  stroke={HALO_STROKE}
                  strokeWidth={strokeW + uiScale * 1.5}
                  className="pointer-events-none"
                />
                <path
                  d={pathData}
                  fillRule="evenodd"
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeW}
                  className="cursor-pointer transition-[fill,stroke,stroke-width] duration-150"
                  onClick={handlePolygonClick(poly.id)}
                  onMouseEnter={() => onHoveredChange?.(poly.id)}
                  onMouseLeave={() => onHoveredChange?.(null)}
                />

                {/* edge click targets for adding vertices */}
                {isActive && editable && editMode === 'add-vertex' &&
                  poly.points.map((point, idx) => {
                    const nextPoint = poly.points[(idx + 1) % poly.points.length]
                    const midX = (point.x + nextPoint.x) / 2
                    const midY = (point.y + nextPoint.y) / 2
                    return (
                      <g key={`edge-${idx}`}>
                        <line
                          x1={point.x}
                          y1={point.y}
                          x2={nextPoint.x}
                          y2={nextPoint.y}
                          stroke="transparent"
                          strokeWidth={uiScale * 20}
                          className="cursor-crosshair"
                          onClick={handleEdgeClick(poly.id, idx)}
                        />
                        <circle
                          cx={midX}
                          cy={midY}
                          r={uiScale * 5}
                          fill="rgb(34, 197, 94)"
                          stroke="#27272a"
                          strokeWidth={uiScale * 2}
                          className="cursor-crosshair pointer-events-none"
                        />
                      </g>
                    )
                  })}

                {/* vertex handles */}
                {showHandles &&
                  poly.points.map((point, idx) => {
                    const isPending = measuring && !!pendingVertex && pendingVertex.poly === poly.id && pendingVertex.index === idx
                    const draggable = editMode !== 'delete-vertex' && !measuring
                    return (
                      <g key={idx}>
                        {/* transparent hit target -- larger for touch */}
                        <circle
                          data-vertex={idx}
                          data-polygon={poly.id}
                          cx={point.x}
                          cy={point.y}
                          r={uiScale * 16}
                          fill="transparent"
                          className={measuring ? 'cursor-crosshair touch-none' : editMode === 'delete-vertex' ? 'cursor-pointer touch-none' : 'cursor-move touch-none'}
                          onMouseDown={draggable ? handleVertexMouseDown(poly.id, idx) : undefined}
                          onTouchStart={draggable ? handleVertexTouchStart(poly.id, idx) : undefined}
                          onClick={handleVertexClick(poly.id, idx)}
                        />
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={uiScale * 8}
                          fill={editMode === 'delete-vertex' ? 'rgb(239, 68, 68)' : isPending ? DIMENSION_COLOUR : '#27272a'}
                          stroke={editMode === 'delete-vertex' ? 'rgb(185, 28, 28)' : measuring ? DIMENSION_COLOUR : 'rgb(72, 168, 214)'}
                          strokeWidth={uiScale * 2}
                          className="pointer-events-none"
                        />
                      </g>
                    )
                  })}

              </g>
            )
          })}

          {/* point-to-point measurements in mm */}
          <DimensionOverlay
            dimensions={resolvedDimensions}
            ui={uiScale}
            pending={pendingPoint}
            onRemove={measuring ? removeDimension : undefined}
          />
        </svg>

        {/* zoom controls */}
        <div
          className="absolute bottom-3.5 right-3.5 z-20 glass-toolbar px-1 py-0.5 flex items-center gap-0.5 text-[11px]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setZoom(z => clampZoom(z / ZOOM_FACTOR))}
            className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
          >
            -
          </button>
          <span className="px-1.5 text-text-secondary min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => clampZoom(z * ZOOM_FACTOR))}
            className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
          >
            +
          </button>
          <div className="h-3.5 w-px bg-border-subtle mx-0.5" />
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
          >
            Fit
          </button>
        </div>
        </div>
      </div>

    </div>
  )
}
