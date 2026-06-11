import type { Point, Rect } from '../types'
import { clamp } from '../types'

/**
 * World <-> screen transform. Screen position of a world point:
 *   sx = (wx - camera.x) * zoom
 * i.e. (camera.x, camera.y) is the world point at the screen origin.
 * All camera functions are pure and return new cameras.
 */
export interface Camera {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 4.0

export const worldToScreen = (cam: Camera, wx: number, wy: number): Point => ({
  x: (wx - cam.x) * cam.zoom,
  y: (wy - cam.y) * cam.zoom,
})

export const screenToWorld = (cam: Camera, sx: number, sy: number): Point => ({
  x: cam.x + sx / cam.zoom,
  y: cam.y + sy / cam.zoom,
})

/** Set zoom, keeping the world point under screen point (sx, sy) stationary. */
export function zoomAtPoint(cam: Camera, targetZoom: number, sx: number, sy: number): Camera {
  const zoom = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM)
  if (zoom === cam.zoom) return cam
  return {
    x: cam.x + sx / cam.zoom - sx / zoom,
    y: cam.y + sy / cam.zoom - sy / zoom,
    zoom,
  }
}

/** Move the camera by a screen-space delta (positive dx pans the view right). */
export const panByScreen = (cam: Camera, dx: number, dy: number): Camera => ({
  x: cam.x + dx / cam.zoom,
  y: cam.y + dy / cam.zoom,
  zoom: cam.zoom,
})

/** World-space rect currently visible in a viewport of css size vw × vh. */
export const visibleWorldRect = (cam: Camera, vw: number, vh: number): Rect => ({
  x: cam.x,
  y: cam.y,
  w: vw / cam.zoom,
  h: vh / cam.zoom,
})

/**
 * Camera that fits `bounds` into a vw × vh viewport with `padding` css px on
 * every side, centered. Zoom is capped at 1 so small maps don't blow up.
 */
export function fitBounds(bounds: Rect, vw: number, vh: number, padding = 64): Camera {
  const availW = Math.max(1, vw - 2 * padding)
  const availH = Math.max(1, vh - 2 * padding)
  const zoom = clamp(
    Math.min(availW / Math.max(1, bounds.w), availH / Math.max(1, bounds.h), 1),
    MIN_ZOOM,
    MAX_ZOOM,
  )
  return {
    x: bounds.x + bounds.w / 2 - vw / (2 * zoom),
    y: bounds.y + bounds.h / 2 - vh / (2 * zoom),
    zoom,
  }
}

/** Camera centered on a world point at a given zoom. */
export function centerOn(wx: number, wy: number, zoom: number, vw: number, vh: number): Camera {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  return { x: wx - vw / (2 * z), y: wy - vh / (2 * z), zoom: z }
}
