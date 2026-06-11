import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Animator } from './animator'
import { BoardActions } from './actions'
import { setMeasureFunction } from './textMeasure'
import { anchorOnBox, crossLinkGeom } from './drawConnector'
import type { Board } from '../doc/board'
import { createBoard } from '../doc/board'
import { createNode } from '../doc/schema'
import { setSelection, uiStore } from '../state/store'
import type { NodeView } from '../types'

let board: Board
let actions: BoardActions
let root: string
let a: string
let b: string

beforeEach(() => {
  setMeasureFunction((text) => text.length * 8)
  board = createBoard(new Animator(), () => {}, new Y.Doc())
  actions = new BoardActions(board)
  root = createNode(board.bd, null, { text: 'Root' })
  a = createNode(board.bd, root, { text: 'Alpha', side: 'right' })
  b = createNode(board.bd, root, { text: 'Beta', side: 'right' })
})

afterEach(() => {
  board.destroy()
  setMeasureFunction(null)
  setSelection([])
  uiStore.setState({ editing: null, linkSelection: null, editingLinkId: null })
})

describe('cross-links', () => {
  it('createCrossLink adds a selectable link; self-links are rejected', () => {
    expect(actions.createCrossLink(a, a)).toBeNull()
    const id = actions.createCrossLink(a, b)!
    expect(id).toBeTruthy()
    expect(board.mirror.links.length).toBe(1)
    expect(uiStore.getState().linkSelection).toBe(id)
  })

  it('label/style/arrow updates flow through the mirror', () => {
    const id = actions.createCrossLink(a, b)!
    actions.setLinkLabel(id, 'depends on')
    actions.setLinkStyle(id, 'dashed')
    actions.setLinkArrow(id, 'both')
    const link = board.mirror.links[0]
    expect(link.label).toBe('depends on')
    expect(link.style).toBe('dashed')
    expect(link.arrow).toBe('both')
  })

  it('deleteLinkById removes the link and clears its selection', () => {
    const id = actions.createCrossLink(a, b)!
    actions.deleteLinkById(id)
    expect(board.mirror.links.length).toBe(0)
    expect(uiStore.getState().linkSelection).toBeNull()
  })

  it('deleting a node removes links touching it (undo restores both)', () => {
    actions.createCrossLink(a, b)
    setSelection([b])
    actions.deleteSelection()
    expect(board.mirror.links.length).toBe(0)
    actions.undo()
    expect(board.mirror.links.length).toBe(1)
    expect(board.mirror.nodes.has(b)).toBe(true)
  })
})

describe('insertNodeBefore', () => {
  it('splices a new node between child and parent in one undo step', () => {
    const newId = actions.insertNodeBefore(a, false)!
    const m = board.mirror
    expect(m.nodes.get(newId)!.parentId).toBe(root)
    expect(m.nodes.get(a)!.parentId).toBe(newId)
    expect(m.nodes.get(newId)!.side).toBe('right')
    expect(m.nodes.get(newId)!.depth).toBe(1)
    expect(m.nodes.get(a)!.depth).toBe(2)
    actions.undo()
    expect(m.nodes.has(newId)).toBe(false)
    expect(m.nodes.get(a)!.parentId).toBe(root)
  })

  it('keeps the child slot position among siblings', () => {
    const newId = actions.insertNodeBefore(a, false)!
    const kids = board.mirror.nodes.get(root)!.childrenIds
    expect(kids).toEqual([newId, b])
  })
})

describe('cross-link geometry', () => {
  const fakeNode = (x: number, y: number, w = 100, h = 40): NodeView =>
    ({
      renderX: x,
      renderY: y,
      width: w,
      height: h,
      renderAlpha: 1,
    }) as NodeView

  it('anchors on the facing edges', () => {
    const left = fakeNode(0, 0)
    const right = fakeNode(400, 0)
    const g = crossLinkGeom(left, right)
    expect(g.p.x).toBeCloseTo(50, 6) // left node's right edge
    expect(g.c.x).toBeCloseTo(350, 6) // right node's left edge
    expect(g.p.y).toBeCloseTo(0, 6)
  })

  it('anchors on top/bottom edges for vertical arrangements', () => {
    const top = fakeNode(0, 0)
    const bottom = fakeNode(0, 300)
    const g = crossLinkGeom(top, bottom)
    expect(g.p.y).toBeCloseTo(20, 6) // top node's bottom edge
    expect(g.c.y).toBeCloseTo(280, 6)
  })

  it('anchor normals point outward', () => {
    const n = fakeNode(0, 0)
    expect(anchorOnBox(n, { x: 500, y: 0 }).normal).toEqual({ x: 1, y: 0 })
    expect(anchorOnBox(n, { x: -500, y: 0 }).normal).toEqual({ x: -1, y: 0 })
    expect(anchorOnBox(n, { x: 0, y: 500 }).normal).toEqual({ x: 0, y: 1 })
  })
})
