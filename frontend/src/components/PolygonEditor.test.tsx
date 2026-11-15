// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PolygonEditor } from './PolygonEditor'
import type { Point, Polygon } from '@/types'

// the corrected photo is 1000 x 800 px at 0.5 mm per px
const IMAGE = { width: 1000, height: 800 }
const MM_PER_PX = 0.5

const polygon = (id: string, points: Point[]): Polygon =>
  ({ id, points, label: id, finger_holes: [], interior_rings: [] })
// 200 px (100 mm) square
const square = polygon('tool', [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }])

// jsdom never loads images; report the photo's size as soon as a source is set
class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  set src(_value: string) {
    this.naturalWidth = IMAGE.width
    this.naturalHeight = IMAGE.height
    queueMicrotask(() => this.onload?.())
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  // the canvas is laid out at the image's pixel size, so client and image coordinates coincide
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: IMAGE.width, bottom: IMAGE.height,
    width: IMAGE.width, height: IMAGE.height, toJSON: () => ({}),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function setup(initial: Polygon[] = [square], mmPerPx: number | null = MM_PER_PX) {
  let current = initial
  function Editor() {
    const [polygons, setPolygons] = useState(initial)
    return (
      <PolygonEditor
        imageUrl="/corrected.jpg"
        polygons={polygons}
        mmPerPx={mmPerPx}
        onPolygonsChange={next => { current = next; setPolygons(next) }}
      />
    )
  }
  const result = render(<Editor />)
  await screen.findByRole('img', { name: 'Corrected' })
  const button = (name: string | RegExp) => screen.getByRole('button', { name })
  const vertex = (idx: number) => result.container.querySelector(`circle[data-vertex="${idx}"]`)!
  return {
    ...result,
    button,
    vertex,
    polygons: () => current,
    gridLines: () => result.container.querySelectorAll('line[data-grid-line]'),
    selectTool() {
      fireEvent.click(result.container.querySelector('path.cursor-pointer')!)
    },
    drag(idx: number, x: number, y: number) {
      fireEvent.mouseDown(vertex(idx), { button: 0 })
      fireEvent.mouseMove(window, { clientX: x, clientY: y })
      fireEvent.mouseUp(window)
    },
    setGridStep(value: string) {
      const input = screen.getByTitle(/^Grid spacing/)
      input.focus()
      fireEvent.change(input, { target: { value } })
      fireEvent.keyDown(input, { key: 'Enter' })
    },
  }
}

describe('PolygonEditor grid overlay', () => {
  it('draws a millimetre grid over the image at the chosen spacing', async () => {
    const editor = await setup()
    expect(editor.gridLines()).toHaveLength(0)
    fireEvent.click(editor.button('Grid'))
    // 5 mm is 10 px: 101 lines across 1000 px and 81 down 800 px
    expect(editor.gridLines()).toHaveLength(182)
    const first = editor.container.querySelectorAll('line[data-grid-line="x"]')
    expect(first[1].getAttribute('x1')).toBe('10')
    // 25 mm is 50 px: 21 lines across and 17 down
    editor.setGridStep('25')
    expect(editor.gridLines()).toHaveLength(38)
    fireEvent.click(editor.button('Grid'))
    expect(editor.gridLines()).toHaveLength(0)
  })

  it('offers no grid, snapping or measuring without a paper scale', async () => {
    const editor = await setup([square], null)
    expect(screen.queryByRole('button', { name: 'Grid' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Snap' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Measure' })).toBeNull()
    expect(editor.gridLines()).toHaveLength(0)
  })
})

describe('PolygonEditor snapping', () => {
  it('moves a dragged vertex freely while Snap is off', async () => {
    const editor = await setup()
    editor.selectTool()
    editor.drag(2, 123, 77)
    expect(editor.polygons()[0].points[2]).toEqual({ x: 123, y: 77 })
  })

  it('snaps a dragged vertex to the grid while Snap is on', async () => {
    const editor = await setup()
    editor.selectTool()
    fireEvent.click(editor.button('Snap'))
    editor.drag(2, 123, 77)
    expect(editor.polygons()[0].points[2]).toEqual({ x: 120, y: 80 })
    editor.setGridStep('25')
    editor.drag(2, 123, 77)
    expect(editor.polygons()[0].points[2]).toEqual({ x: 100, y: 100 })
  })
})

describe('PolygonEditor measurements', () => {
  it('measures between two clicked points in millimetres and follows a moved vertex', async () => {
    const editor = await setup()
    fireEvent.click(editor.button('Measure'))
    expect(screen.getByRole('status').textContent).toMatch(/two outline points/)
    fireEvent.click(editor.vertex(0))
    expect(screen.getByRole('status').textContent).toMatch(/second point/)
    fireEvent.click(editor.vertex(1))
    expect(screen.getByLabelText('Dimension 100.0 mm')).toBeTruthy()
    // measurements are annotations, not edits
    expect((editor.button('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(editor.button('Move vertices'))
    editor.drag(1, 400, 100)
    expect(screen.getByLabelText('Dimension 150.0 mm')).toBeTruthy()
  })

  it('drops a measurement when a vertex is added to its outline', async () => {
    const editor = await setup()
    fireEvent.click(editor.button('Measure'))
    fireEvent.click(editor.vertex(0))
    fireEvent.click(editor.vertex(2))
    expect(screen.getByLabelText('Dimension 141.4 mm')).toBeTruthy()
    expect(editor.button(/^Clear 1/)).toBeTruthy()

    fireEvent.click(editor.button('Add vertex'))
    fireEvent.click(editor.container.querySelector('line.cursor-crosshair')!, { clientX: 200, clientY: 100 })
    expect(editor.polygons()[0].points).toHaveLength(5)
    expect(screen.queryByLabelText(/^Dimension /)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull()
  })

  it('offers the points of every outline, selected or not, as a reopened session starts with none selected', async () => {
    const other = polygon('other', [{ x: 600, y: 100 }, { x: 800, y: 100 }, { x: 800, y: 300 }, { x: 600, y: 300 }])
    let current = [square, other]
    function Editor() {
      const [polygons, setPolygons] = useState(current)
      return (
        <PolygonEditor
          imageUrl="/corrected.jpg"
          polygons={polygons}
          mmPerPx={MM_PER_PX}
          included={new Set<string>()}
          onIncludedChange={() => {}}
          onPolygonsChange={next => { current = next; setPolygons(next) }}
        />
      )
    }
    const { container } = render(<Editor />)
    await screen.findByRole('img', { name: 'Corrected' })
    expect(container.querySelectorAll('circle[data-vertex]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    expect(container.querySelectorAll('circle[data-vertex]')).toHaveLength(8)
    // across two tools: 300 px between the squares is 150 mm
    fireEvent.click(container.querySelector('circle[data-polygon="tool"][data-vertex="1"]')!)
    fireEvent.click(container.querySelector('circle[data-polygon="other"][data-vertex="0"]')!)
    expect(screen.getByLabelText('Dimension 150.0 mm')).toBeTruthy()
  })

  it('removes a measurement when it is clicked in Measure mode or cleared', async () => {
    const editor = await setup()
    fireEvent.click(editor.button('Measure'))
    fireEvent.click(editor.vertex(0))
    fireEvent.click(editor.vertex(1))
    fireEvent.click(editor.vertex(1))
    fireEvent.click(editor.vertex(2))
    expect(screen.getAllByLabelText(/^Dimension /)).toHaveLength(2)

    fireEvent.click(screen.getAllByLabelText(/^Dimension /)[0])
    expect(screen.getAllByLabelText(/^Dimension /)).toHaveLength(1)
    fireEvent.click(editor.button(/^Clear 1/))
    expect(screen.queryByLabelText(/^Dimension /)).toBeNull()
  })
})
