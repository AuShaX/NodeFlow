import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Animator } from '../engine/animator'
import { setMeasureFunction } from '../engine/textMeasure'
import { createBoard } from './board'
import type { Board } from './board'
import {
  createLink,
  createNode,
  deleteSubtree,
  ephemeralOrigin,
  moveNode,
  setCollapsed,
  setNodeText,
} from './schema'

let board: Board

beforeEach(() => {
  setMeasureFunction((text) => text.length * 8)
  board = createBoard(new Animator(), () => {}, new Y.Doc())
})

afterEach(() => {
  board.destroy()
  setMeasureFunction(null)
})

const seed = () => {
  const root = createNode(board.bd, null, { text: 'Root' })
  const a = createNode(board.bd, root, { text: 'Alpha', side: 'right' })
  const b = createNode(board.bd, root, { text: 'Beta', side: 'left' })
  const a1 = createNode(board.bd, a, { text: 'A-one' })
  const a2 = createNode(board.bd, a, { text: 'A-two' })
  return { root, a, b, a1, a2 }
}

describe('mirror derived state', () => {
  it('maintains children, depth, colors and a preorder paint list', () => {
    const { root, a, b, a1 } = seed()
    const m = board.mirror
    expect(m.rootIds).toEqual([root])
    expect(m.nodes.get(root)!.childrenIds).toEqual([a, b])
    expect(m.nodes.get(a)!.depth).toBe(1)
    expect(m.nodes.get(a1)!.depth).toBe(2)
    // depth-1 children get palette colors; grandchildren inherit
    const aColor = m.nodes.get(a)!.effectiveColor
    expect(m.nodes.get(a)!.color).toBe(aColor)
    expect(m.nodes.get(a1)!.effectiveColor).toBe(aColor)
    // preorder: parent before children
    const list = m.paintList
    expect(list.indexOf(root)).toBeLessThan(list.indexOf(a))
    expect(list.indexOf(a)).toBeLessThan(list.indexOf(a1))
  })

  it('lays out right and left sides on opposite flanks of the root', () => {
    const { root, a, b } = seed()
    const m = board.mirror
    const rootView = m.nodes.get(root)!
    expect(rootView.x).toBe(0)
    expect(m.nodes.get(a)!.x).toBeGreaterThan(0)
    expect(m.nodes.get(b)!.x).toBeLessThan(0)
  })

  it('collapse hides descendants and updates subtree counts', () => {
    const { a, a1, a2 } = seed()
    const m = board.mirror
    expect(m.nodes.get(a)!.subtreeCount).toBe(2)
    setCollapsed(board.bd, a, true)
    expect(m.nodes.get(a1)!.visible).toBe(false)
    expect(m.nodes.get(a2)!.visible).toBe(false)
    setCollapsed(board.bd, a, false)
    expect(m.nodes.get(a1)!.visible).toBe(true)
  })

  it('reparent updates depth, children and effective color', () => {
    const { b, a1 } = seed()
    const m = board.mirror
    moveNode(board.bd, a1, b)
    expect(m.nodes.get(a1)!.parentId).toBe(b)
    expect(m.nodes.get(b)!.childrenIds).toContain(a1)
    expect(m.nodes.get(a1)!.effectiveColor).toBe(m.nodes.get(b)!.effectiveColor)
  })

  it('deleteSubtree removes the subtree and links touching it', () => {
    const { root, a, b, a1, a2 } = seed()
    createLink(board.bd, a1, b)
    expect(board.mirror.links.length).toBe(1)
    deleteSubtree(board.bd, a)
    const m = board.mirror
    expect(m.nodes.has(a)).toBe(false)
    expect(m.nodes.has(a1)).toBe(false)
    expect(m.nodes.has(a2)).toBe(false)
    expect(m.nodes.has(root)).toBe(true)
    expect(m.links.length).toBe(0)
  })

  it('text changes re-measure the node', () => {
    const { a } = seed()
    const before = board.mirror.nodes.get(a)!.width
    setNodeText(board.bd, a, 'A much, much longer label')
    expect(board.mirror.nodes.get(a)!.width).toBeGreaterThan(before)
  })
})

describe('undo integration', () => {
  it('undoes a create in one step', () => {
    const { root } = seed()
    const extra = createNode(board.bd, root, { text: 'Extra' })
    expect(board.mirror.nodes.has(extra)).toBe(true)
    board.undo.undo()
    expect(board.mirror.nodes.has(extra)).toBe(false)
    board.undo.redo()
    expect(board.mirror.nodes.has(extra)).toBe(true)
  })

  it('coalesces ephemeral text writes into one tracked step', () => {
    const { a } = seed()
    // simulate typing: live writes are ephemeral, then commit original→final
    setNodeText(board.bd, a, 'Alp', ephemeralOrigin)
    setNodeText(board.bd, a, 'Alpine', ephemeralOrigin)
    setNodeText(board.bd, a, 'Alpha', ephemeralOrigin) // restore original
    setNodeText(board.bd, a, 'Alpine peak') // tracked commit
    expect(board.mirror.nodes.get(a)!.text).toBe('Alpine peak')
    board.undo.undo()
    expect(board.mirror.nodes.get(a)!.text).toBe('Alpha')
  })

  it('delete + undo restores the subtree in one step', () => {
    const { a, a1, a2 } = seed()
    deleteSubtree(board.bd, a)
    expect(board.mirror.nodes.has(a1)).toBe(false)
    board.undo.undo()
    expect(board.mirror.nodes.has(a)).toBe(true)
    expect(board.mirror.nodes.has(a1)).toBe(true)
    expect(board.mirror.nodes.has(a2)).toBe(true)
    // structure intact after the round-trip
    expect(board.mirror.nodes.get(a)!.childrenIds).toEqual([a1, a2])
  })
})
