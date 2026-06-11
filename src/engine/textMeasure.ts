import type { TextStyle } from '../types'
import { FONT_STACK } from '../theme'

/** Font sizes per SPEC §8: 14px Inter at 'm', 12/17 for 's'/'l'. */
export const FONT_SIZES = { s: 12, m: 14, l: 17 } as const
export const LINE_HEIGHTS = { s: 17, m: 20, l: 24 } as const

/** Nodes grow with text up to this width (world units), then wrap. */
export const MAX_TEXT_WIDTH = 320
export const MAX_LINES = 6

export const NODE_PAD_X = 14
export const NODE_PAD_Y = 8
export const MIN_NODE_WIDTH = 44

export interface MeasuredText {
  lines: string[]
  /** widest line, px */
  width: number
  /** lines * lineHeight, px */
  height: number
  truncated: boolean
}

export interface NodeSize {
  width: number
  height: number
  lines: string[]
}

export const fontFor = (style: TextStyle): string =>
  `${style.bold ? 600 : 500} ${FONT_SIZES[style.size]}px ${FONT_STACK}`

export type MeasureFn = (text: string, font: string) => number

let canvasCtx: CanvasRenderingContext2D | null = null

const canvasMeasure: MeasureFn = (text, font) => {
  if (!canvasCtx) {
    const canvas = document.createElement('canvas')
    canvasCtx = canvas.getContext('2d')!
  }
  if (canvasCtx.font !== font) canvasCtx.font = font
  return canvasCtx.measureText(text).width
}

let measureFn: MeasureFn = canvasMeasure
const cache = new Map<string, MeasuredText>()
const CACHE_CAP = 8000

/** Tests (and the layout worker, if we ever add one) inject a deterministic measurer. */
export function setMeasureFunction(fn: MeasureFn | null): void {
  measureFn = fn ?? canvasMeasure
  cache.clear()
}

/** Drop cached measurements (call when the webfont finishes loading). */
export function clearMeasureCache(): void {
  cache.clear()
}

function breakLongWord(word: string, font: string, maxWidth: number, out: string[]): void {
  let rest = word
  while (measureFn(rest, font) > maxWidth && rest.length > 1) {
    // binary search the longest prefix that fits
    let lo = 1
    let hi = rest.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (measureFn(rest.slice(0, mid), font) <= maxWidth) lo = mid
      else hi = mid - 1
    }
    out.push(rest.slice(0, lo))
    rest = rest.slice(lo)
  }
  out.push(rest)
}

function wrapParagraph(para: string, font: string, maxWidth: number, out: string[]): void {
  if (para === '') {
    out.push('')
    return
  }
  const words = para.split(/ +/)
  let line = ''
  for (const word of words) {
    if (word === '') continue
    const candidate = line === '' ? word : line + ' ' + word
    if (measureFn(candidate, font) <= maxWidth) {
      line = candidate
    } else {
      if (line !== '') out.push(line)
      if (measureFn(word, font) > maxWidth) {
        const pieces: string[] = []
        breakLongWord(word, font, maxWidth, pieces)
        for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i])
        line = pieces[pieces.length - 1]
      } else {
        line = word
      }
    }
  }
  out.push(line)
}

/**
 * Wrap `text` at MAX_TEXT_WIDTH for the given style. Preserves explicit \n.
 * Results are cached by (size, bold, text).
 */
export function measureText(text: string, style: TextStyle): MeasuredText {
  const key = style.size + (style.bold ? 'b|' : 'n|') + text
  const hit = cache.get(key)
  if (hit) return hit

  const font = fontFor(style)
  const lines: string[] = []
  for (const para of text.split('\n')) wrapParagraph(para, font, MAX_TEXT_WIDTH, lines)

  let truncated = false
  let finalLines = lines
  if (lines.length > MAX_LINES) {
    truncated = true
    finalLines = lines.slice(0, MAX_LINES)
    const last = finalLines[MAX_LINES - 1]
    finalLines[MAX_LINES - 1] = last.length > 0 ? last.replace(/.$/, '…') : '…'
  }

  let width = 0
  for (const line of finalLines) width = Math.max(width, measureFn(line, font))

  const result: MeasuredText = {
    lines: finalLines,
    width: Math.min(width, MAX_TEXT_WIDTH),
    height: finalLines.length * LINE_HEIGHTS[style.size],
    truncated,
  }
  if (cache.size >= CACHE_CAP) cache.clear()
  cache.set(key, result)
  return result
}

/** Full node box size for a text + style (text block + padding, with minimums). */
export function measureNode(text: string, style: TextStyle): NodeSize {
  const m = measureText(text, style)
  return {
    width: Math.max(MIN_NODE_WIDTH, Math.ceil(m.width) + 2 * NODE_PAD_X),
    height: Math.ceil(m.height) + 2 * NODE_PAD_Y,
    lines: m.lines,
  }
}

/**
 * Resolve the Inter webfont before first measurement so node sizes are
 * computed against the real font. Falls through after a timeout so the app
 * still boots if the font stalls.
 */
export async function fontsReady(timeoutMs = 600): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const loads = [
    document.fonts.load(`500 14px 'Inter Variable'`),
    document.fonts.load(`600 14px 'Inter Variable'`),
  ]
  await Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
  clearMeasureCache()
}
