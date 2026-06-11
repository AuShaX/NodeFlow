import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LINE_HEIGHTS,
  MAX_LINES,
  MAX_TEXT_WIDTH,
  measureNode,
  measureText,
  MIN_NODE_WIDTH,
  NODE_PAD_X,
  NODE_PAD_Y,
  setMeasureFunction,
} from './textMeasure'

// Deterministic measurer: every character is 10px wide → 32 chars fit a line.
const CHAR_W = 10
const style = { size: 'm', bold: false } as const

beforeEach(() => setMeasureFunction((text) => text.length * CHAR_W))
afterEach(() => setMeasureFunction(null))

describe('measureText', () => {
  it('keeps short text on one line', () => {
    const m = measureText('hello world', style)
    expect(m.lines).toEqual(['hello world'])
    expect(m.width).toBe(11 * CHAR_W)
    expect(m.height).toBe(LINE_HEIGHTS.m)
  })

  it('wraps at MAX_TEXT_WIDTH on word boundaries', () => {
    // each word is 10 chars = 100px; 3 words + 2 spaces = 320px fits exactly
    const m = measureText('aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd', style)
    expect(m.lines.length).toBe(2)
    expect(m.lines[0]).toBe('aaaaaaaaaa bbbbbbbbbb cccccccccc')
    expect(m.lines[1]).toBe('dddddddddd')
    expect(m.width).toBeLessThanOrEqual(MAX_TEXT_WIDTH)
  })

  it('preserves explicit newlines', () => {
    const m = measureText('one\ntwo\n\nfour', style)
    expect(m.lines).toEqual(['one', 'two', '', 'four'])
    expect(m.height).toBe(4 * LINE_HEIGHTS.m)
  })

  it('breaks unbreakable words by character', () => {
    const long = 'x'.repeat(100) // 1000px wide
    const m = measureText(long, style)
    expect(m.lines.length).toBe(Math.ceil(100 / 32))
    for (const line of m.lines) expect(line.length * CHAR_W).toBeLessThanOrEqual(MAX_TEXT_WIDTH)
    expect(m.lines.join('')).toBe(long)
  })

  it('ellipsizes beyond MAX_LINES', () => {
    const m = measureText(Array(10).fill('line').join('\n'), style)
    expect(m.lines.length).toBe(MAX_LINES)
    expect(m.truncated).toBe(true)
    expect(m.lines[MAX_LINES - 1].endsWith('…')).toBe(true)
  })

  it('returns a single empty line for empty text', () => {
    const m = measureText('', style)
    expect(m.lines).toEqual([''])
    expect(m.height).toBe(LINE_HEIGHTS.m)
  })
})

describe('measureNode', () => {
  it('adds padding around the text block', () => {
    const n = measureNode('hello', style)
    expect(n.width).toBe(5 * CHAR_W + 2 * NODE_PAD_X)
    expect(n.height).toBe(LINE_HEIGHTS.m + 2 * NODE_PAD_Y)
  })

  it('enforces a minimum width for empty nodes', () => {
    const n = measureNode('', style)
    expect(n.width).toBe(MIN_NODE_WIDTH)
  })
})
