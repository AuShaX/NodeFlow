import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Animator } from './animator'
import { BoardActions } from './actions'
import { setMeasureFunction } from './textMeasure'
import type { Board } from '../doc/board'
import { createBoard } from '../doc/board'
import { createNode } from '../doc/schema'
import { clipboardWrite, serializeSubtree } from '../doc/clipboard'
import { setSelection, uiStore } from '../state/store'

let board: Board
let actions: BoardActions

interface Ids {
  root: string
  a: string
  b: string
  c: string
  a1: string
  a2: string
}

let ids: Ids

beforeEach(() => {
  setMeasureFunction((text) => text.length * 8)
  board = createBoard(new Animator(), () => {}, new Y.Doc())
  actions = new BoardActions(board)
  const root = createNode(board.bd, null, { text: 'Root' })
  const a = createNode(board.bd, root, { text: 'A', side: 'right' })
  const b = createNode(board.bd, root, { text: 'B', side: 'right' })
  const c = createNode(board.bd, root, { text: 'C', side: 'left' })
  const a1 = createNode(board.bd, a, { text: 'A1' })
  const a2 = createNode(board.bd, a, { text: 'A2' })
  ids = { root, a, b, c, a1, a2 }
})

afterEach(() => {
  board.destroy()
  setMeasureFunction(null)
  setSelection([])
  uiStore.setState({ editing: null })
})

describe('drag preview (mirror)', () => {
  it('beginDrag removes the subtree from layout and the gap closes', () => {
    const m = board.mirror
    const bYBefore = m.nodes.get(ids.b)!.y
    m.beginDrag([ids.a])
    expect(m.draggingIds.has(ids.a)).toBe(true)
    expect(m.draggingIds.has(ids.a1)).toBe(true)
    // with A's tall subtree gone, B's slot moves toward the root's center line
    const bYAfter = m.nodes.get(ids.b)!.y
    expect(Math.abs(bYAfter)).toBeLessThanOrEqual(Math.abs(bYBefore))
    m.endDrag()
  })

  it('setDragPreview opens a phantom gap that shifts siblings', () => {
    const m = board.mirror
    m.beginDrag([ids.c]) // drag the left-side node
    const a1Before = m.nodes.get(ids.a1)!.y
    // preview: drop C between A1 and A2 (children of A)
    m.setDragPreview({ parentId: ids.a, index: 1, side: null })
    expect(m.phantomSlot).not.toBeNull()
    const a2After = m.nodes.get(ids.a2)!.y
    // A2 must have been pushed below the phantom slot
    expect(a2After).toBeGreaterThan(m.phantomSlot!.y)
    expect(m.phantomSlot!.y).toBeGreaterThan(a1Before - 1)
    m.endDrag()
  })

  it('insertionUniverse filters by side for both-side roots', () => {
    const m = board.mirror
    expect(m.insertionUniverse(ids.root, 'right')).toEqual([ids.a, ids.b])
    expect(m.insertionUniverse(ids.root, 'left')).toEqual([ids.c])
    expect(m.insertionUniverse(ids.a, null)).toEqual([ids.a1, ids.a2])
  })
})

describe('drop commits', () => {
  it('reparents into another branch at the given index', () => {
    actions.dropSubtrees([ids.b], ids.a, 1, null)
    const m = board.mirror
    expect(m.nodes.get(ids.b)!.parentId).toBe(ids.a)
    expect(m.nodes.get(ids.a)!.childrenIds).toEqual([ids.a1, ids.b, ids.a2])
    // single undo step restores
    actions.undo()
    expect(m.nodes.get(ids.b)!.parentId).toBe(ids.root)
  })

  it('reorders within the same parent', () => {
    actions.dropSubtrees([ids.a2], ids.a, 0, null)
    expect(board.mirror.nodes.get(ids.a)!.childrenIds).toEqual([ids.a2, ids.a1])
  })

  it('side flip when dropping across the root', () => {
    actions.dropSubtrees([ids.a], ids.root, 1, 'left')
    const m = board.mirror
    expect(m.nodes.get(ids.a)!.side).toBe('left')
    expect(m.nodes.get(ids.a)!.x).toBeLessThan(0)
    // children follow to the left flank
    expect(m.nodes.get(ids.a1)!.x).toBeLessThan(m.nodes.get(ids.a)!.x)
  })

  it('multi-top drop keeps the dragged order', () => {
    actions.dropSubtrees([ids.a1, ids.a2], ids.c, 0, null)
    expect(board.mirror.nodes.get(ids.c)!.childrenIds).toEqual([ids.a1, ids.a2])
  })
})

describe('free move', () => {
  it('live + commit = one undo step back to auto layout', () => {
    const m = board.mirror
    const start = { mx: 0, my: 0, layout: 'auto' as const }
    actions.freeMoveLive(ids.b, 100, 50, false)
    actions.freeMoveLive(ids.b, 180, 90, false)
    actions.freeMoveCommit(ids.b, start, { mx: 180, my: 90 }, false)
    expect(m.nodes.get(ids.b)!.layout).toBe('manual')
    const parent = m.nodes.get(ids.root)!
    expect(m.nodes.get(ids.b)!.x).toBeCloseTo(parent.x + 180, 4)
    actions.undo()
    expect(m.nodes.get(ids.b)!.layout).toBe('auto')
    expect(m.nodes.get(ids.b)!.mx).toBe(0)
  })
})

describe('reorder shortcut', () => {
  it('Cmd+Up swaps with the previous sibling', () => {
    setSelection([ids.a2])
    actions.reorderSelected(-1)
    expect(board.mirror.nodes.get(ids.a)!.childrenIds).toEqual([ids.a2, ids.a1])
    actions.reorderSelected(-1) // already first: no-op
    expect(board.mirror.nodes.get(ids.a)!.childrenIds).toEqual([ids.a2, ids.a1])
  })
})

describe('clipboard', () => {
  it('copy/paste materializes the subtree under the target', () => {
    setSelection([ids.a])
    actions.copySelection()
    setSelection([ids.c])
    actions.paste()
    const m = board.mirror
    const cKids = m.nodes.get(ids.c)!.childrenIds
    expect(cKids.length).toBe(1)
    const copy = m.nodes.get(cKids[0])!
    expect(copy.text).toBe('A')
    expect(copy.childrenIds.length).toBe(2)
    expect(copy.childrenIds.map((id) => m.nodes.get(id)!.text)).toEqual(['A1', 'A2'])
    // paste is one undo step
    actions.undo()
    expect(board.mirror.nodes.get(ids.c)!.childrenIds.length).toBe(0)
  })

  it('cut removes the original and paste restores it elsewhere', () => {
    setSelection([ids.a2])
    actions.cutSelection()
    expect(board.mirror.nodes.has(ids.a2)).toBe(false)
    setSelection([ids.b])
    actions.paste()
    const bKids = board.mirror.nodes.get(ids.b)!.childrenIds
    expect(bKids.length).toBe(1)
    expect(board.mirror.nodes.get(bKids[0])!.text).toBe('A2')
  })

  it('paste without selection creates floating roots', () => {
    clipboardWrite([serializeSubtree(board.mirror, ids.a)!])
    setSelection([])
    actions.paste({ x: 500, y: 300 })
    expect(board.mirror.rootIds.length).toBe(2)
    const newRoot = board.mirror.rootIds.find((id) => id !== ids.root)!
    expect(board.mirror.nodes.get(newRoot)!.mx).toBe(500)
  })

  it('duplicateSelection inserts a copy as the next sibling', () => {
    setSelection([ids.a1])
    actions.duplicateSelection()
    const kids = board.mirror.nodes.get(ids.a)!.childrenIds
    expect(kids.length).toBe(3)
    expect(board.mirror.nodes.get(kids[1])!.text).toBe('A1')
    expect(kids[0]).toBe(ids.a1)
  })
})

describe('free placement (drop in open space)', () => {
  it('pins the top at a manual offset from its parent, one undo step', () => {
    const m = board.mirror
    actions.freeMoveDrop([{ id: ids.a, mx: 300, my: -120 }])
    const a = m.nodes.get(ids.a)!
    expect(a.layout).toBe('manual')
    const root = m.nodes.get(ids.root)!
    expect(a.x).toBeCloseTo(root.x + 300)
    expect(a.y).toBeCloseTo(root.y - 120)
    // children follow the pinned parent
    const a1 = m.nodes.get(ids.a1)!
    expect(a1.x).toBeGreaterThan(a.x)
    actions.undo()
    expect(m.nodes.get(ids.a)!.layout).toBe('auto')
  })

  it('crossing a both-root centerline flips side and fans children outward', () => {
    const m = board.mirror
    actions.freeMoveDrop([{ id: ids.a, mx: -400, my: 60 }])
    const a = m.nodes.get(ids.a)!
    expect(a.side).toBe('left')
    const root = m.nodes.get(ids.root)!
    expect(a.x).toBeCloseTo(root.x - 400)
    // subtree orientation follows the actual position: children fan left
    const a1 = m.nodes.get(ids.a1)!
    const a2 = m.nodes.get(ids.a2)!
    expect(a1.x).toBeLessThan(a.x)
    expect(a2.x).toBeLessThan(a.x)
  })

  it('manual offsets survive moving the parent root', () => {
    const m = board.mirror
    actions.freeMoveDrop([{ id: ids.a, mx: 250, my: 90 }])
    const before = m.nodes.get(ids.a)!
    const rootBefore = m.nodes.get(ids.root)!
    const relX = before.x - rootBefore.x
    const relY = before.y - rootBefore.y
    // move the root far away (free-move commit path)
    actions.freeMoveCommit(
      ids.root,
      { mx: rootBefore.x, my: rootBefore.y, layout: 'auto' },
      { mx: rootBefore.x + 1000, my: rootBefore.y + 500 },
      true,
    )
    const after = m.nodes.get(ids.a)!
    const rootAfter = m.nodes.get(ids.root)!
    expect(after.layout).toBe('manual')
    expect(after.x - rootAfter.x).toBeCloseTo(relX)
    expect(after.y - rootAfter.y).toBeCloseTo(relY)
  })

  it('parked ghost renders re-tween home when slots did not change', () => {
    const m = board.mirror
    const a = m.nodes.get(ids.a)!
    // simulate a reverted drag: render parked away from an unchanged slot
    m.beginDrag([ids.a])
    a.renderX = a.x + 500
    a.renderY = a.y + 200
    m.endDrag()
    // relayout must notice render≠slot and target the slot again
    const anim = board.mirror['animator'] as Animator
    const moving = anim.tick(performance.now() + 16)
    expect(moving).toBe(true)
  })
})
