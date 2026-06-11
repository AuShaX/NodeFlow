import { describe, expect, it } from 'vitest'
import {
  fitBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  panByScreen,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
} from './camera'

describe('camera transforms', () => {
  const cam = { x: 100, y: -50, zoom: 2 }

  it('worldToScreen and screenToWorld are inverses', () => {
    const w = { x: 123.4, y: -567.8 }
    const s = worldToScreen(cam, w.x, w.y)
    const back = screenToWorld(cam, s.x, s.y)
    expect(back.x).toBeCloseTo(w.x, 10)
    expect(back.y).toBeCloseTo(w.y, 10)
  })

  it('maps the camera origin to the screen origin', () => {
    expect(worldToScreen(cam, 100, -50)).toEqual({ x: 0, y: 0 })
  })
})

describe('zoomAtPoint', () => {
  it('keeps the world point under the cursor stationary', () => {
    const cam = { x: 10, y: 20, zoom: 1 }
    const cursor = { x: 400, y: 300 }
    const before = screenToWorld(cam, cursor.x, cursor.y)
    const zoomed = zoomAtPoint(cam, 2.5, cursor.x, cursor.y)
    const after = screenToWorld(zoomed, cursor.x, cursor.y)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
    expect(zoomed.zoom).toBe(2.5)
  })

  it('clamps zoom to [MIN_ZOOM, MAX_ZOOM]', () => {
    const cam = { x: 0, y: 0, zoom: 1 }
    expect(zoomAtPoint(cam, 1000, 0, 0).zoom).toBe(MAX_ZOOM)
    expect(zoomAtPoint(cam, 0.00001, 0, 0).zoom).toBe(MIN_ZOOM)
  })

  it('returns the same camera when zoom is unchanged after clamping', () => {
    const cam = { x: 0, y: 0, zoom: MAX_ZOOM }
    expect(zoomAtPoint(cam, 99, 10, 10)).toBe(cam)
  })
})

describe('panByScreen', () => {
  it('moves the camera by the screen delta scaled by zoom', () => {
    const cam = { x: 0, y: 0, zoom: 2 }
    const next = panByScreen(cam, 100, -50)
    expect(next.x).toBe(50)
    expect(next.y).toBe(-25)
    expect(next.zoom).toBe(2)
  })
})

describe('fitBounds', () => {
  it('centers the bounds in the viewport', () => {
    const bounds = { x: -100, y: -100, w: 200, h: 200 }
    const cam = fitBounds(bounds, 800, 600, 64)
    const centerWorld = screenToWorld(cam, 400, 300)
    expect(centerWorld.x).toBeCloseTo(0, 6)
    expect(centerWorld.y).toBeCloseTo(0, 6)
  })

  it('fits with padding on the constraining axis', () => {
    const bounds = { x: 0, y: 0, w: 2000, h: 100 }
    const vw = 1000
    const cam = fitBounds(bounds, vw, 600, 64)
    // width constrains: 2000 world units in (1000 - 128) css px
    expect(cam.zoom).toBeCloseTo((vw - 128) / 2000, 6)
  })

  it('never zooms past 100% for small maps', () => {
    const bounds = { x: 0, y: 0, w: 10, h: 10 }
    const cam = fitBounds(bounds, 1000, 800, 64)
    expect(cam.zoom).toBe(1)
  })
})
