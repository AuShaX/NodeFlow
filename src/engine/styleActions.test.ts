import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Animator } from './animator'
import { BoardActions } from './actions'
import { setMeasureFunction } from './textMeasure'
import type { Board } from '../doc/board'
import { createBoard } from '../doc/board'
import { createNode, getSpacing, setManualOffset, setSpacing } from '../doc/schema'
import { DEFAULT_SPACING } from '../layout/mindmapLayout'
import { setSelection, uiStore } from '../state/store'

let board: Board
let actions: BoardActions

beforeEach(() => {
  setMeasureFunction((text) => text.length * 8)
  board = createBoard(new Animator(), () => {}, new Y.Doc())
  actions = new BoardActions(board)
})

afterEach(() => {
  board.destroy()
  setMeasureFunction(null)
  setSelection([])
  uiStore.setState({ editing: null, contextMenu: null })
})

const seed = () => {
  const root = createNode(board.bd, null, { text: 'Root' })
  const a = createNode(board.bd, root, { text: 'Alpha', side: 'right' })
  const b = createNode(board.bd, root, { text: 'Beta', side: 'right' })
  const a1 = createNode(board.bd, a, { text: 'A-one' })
  const a2 = createNode(board.bd, a, { text: 'A-two' })
  return { root, a, b, a1, a2 }
}

describe('multi-select styling', () => {
  it('applies color to every node in ONE undo step', () => {
    const { a, b, a1 } = seed()
    actions.setNodesColor([a, b, a1], '#123456')
    for (const id of [a, b, a1]) {
      expect(board.mirror.nodes.get(id)!.color).toBe('#123456')
    }
    actions.undo()
    expect(board.mirror.nodes.get(a)!.color).not.toBe('#123456')
    expect(board.mirror.nodes.get(b)!.color).not.toBe('#123456')
    expect(board.mirror.nodes.get(a1)!.color).toBe(null)
  })

  it('color=null clears to inherit; effectiveColor flows from the branch', () => {
    const { a, a1 } = seed()
    actions.setNodesColor([a1], '#ABCDEF')
    expect(board.mirror.nodes.get(a1)!.effectiveColor).toBe('#ABCDEF')
    actions.setNodesColor([a1], null)
    expect(board.mirror.nodes.get(a1)!.effectiveColor).toBe(
      board.mirror.nodes.get(a)!.effectiveColor,
    )
  })

  it('bold toggle preserves per-node sizes in a mixed selection', () => {
    const { a, b } = seed()
    actions.setNodesTextSize([a], 'l')
    actions.setNodesBold([a, b], true)
    expect(board.mirror.nodes.get(a)!.textStyle).toEqual({ size: 'l', bold: true })
    expect(board.mirror.nodes.get(b)!.textStyle).toEqual({ size: 'm', bold: true })
  })

  it('shape applies to all selected and is one undo step', () => {
    const { a, b } = seed()
    actions.setNodesShape([a, b], 'rect')
    expect(board.mirror.nodes.get(a)!.shape).toBe('rect')
    expect(board.mirror.nodes.get(b)!.shape).toBe('rect')
    actions.undo()
    expect(board.mirror.nodes.get(a)!.shape).toBe('pill')
    expect(board.mirror.nodes.get(b)!.shape).toBe('pill')
  })
})

describe('root layout controls', () => {
  it('switching dir to both rebalances stale sides by subtree height', () => {
    const root = createNode(board.bd, null, { text: 'R', dir: 'right' })
    const kids = ['a', 'b', 'c', 'd'].map((t) => createNode(board.bd, root, { text: t }))
    actions.setRootsDir([root], 'both')
    expect(board.mirror.nodes.get(root)!.dir).toBe('both')
    const sides = kids.map((id) => board.mirror.nodes.get(id)!.side)
    expect(sides).toContain('left')
    expect(sides).toContain('right')
    // greedy balance with equal heights alternates: first child goes right
    expect(sides[0]).toBe('right')
  })

  it('keeps user-mixed sides when dir stays both', () => {
    const { root, a, b } = seed()
    actions.setRootsDir([root], 'both') // both → both: no rebalance
    expect(board.mirror.nodes.get(a)!.side).toBe('right')
    expect(board.mirror.nodes.get(b)!.side).toBe('right')
  })

  it('connector style writes to roots only', () => {
    const { root, a } = seed()
    actions.setRootsConnector([root, a], 'elbow')
    expect(board.mirror.nodes.get(root)!.connectorStyle).toBe('elbow')
    expect(board.mirror.nodes.get(a)!.connectorStyle).toBe(null)
  })
})

describe('auto-layout toggle (SPEC §6 freeze)', () => {
  it('freezes direct children at their current offsets, then releases them', () => {
    const { root, a, b } = seed()
    const m = board.mirror
    const ax = m.nodes.get(a)!.x
    const ay = m.nodes.get(a)!.y
    expect(actions.rootAutoLayoutOn(root)).toBe(true)

    actions.toggleRootAutoLayout(root) // off
    expect(actions.rootAutoLayoutOn(root)).toBe(false)
    const av = m.nodes.get(a)!
    const bv = m.nodes.get(b)!
    expect(av.layout).toBe('manual')
    expect(bv.layout).toBe('manual')
    // frozen in place: same world position as the auto slot
    expect(av.x).toBeCloseTo(ax, 5)
    expect(av.y).toBeCloseTo(ay, 5)

    actions.toggleRootAutoLayout(root) // on again
    expect(actions.rootAutoLayoutOn(root)).toBe(true)
    expect(m.nodes.get(a)!.layout).toBe('auto')
    expect(m.nodes.get(a)!.x).toBeCloseTo(ax, 5)
  })

  it('freeze is one undo step', () => {
    const { root, a } = seed()
    actions.toggleRootAutoLayout(root)
    expect(board.mirror.nodes.get(a)!.layout).toBe('manual')
    actions.undo()
    expect(board.mirror.nodes.get(a)!.layout).toBe('auto')
    expect(actions.rootAutoLayoutOn(root)).toBe(true)
  })

  it('one free-moved child does not flip the toggle off', () => {
    const { root, a } = seed()
    setManualOffset(board.bd, a, 40, 40)
    expect(actions.rootAutoLayoutOn(root)).toBe(true)
  })
})

describe('layout nodes (clear manual offsets)', () => {
  it('clears manual flags through the subtree but never touches root position', () => {
    const { root, a, a1 } = seed()
    const rootView = () => board.mirror.nodes.get(root)!
    board.bd.doc.transact(() => {
      board.bd.nodes.get(root)!.set('mx', 500)
      board.bd.nodes.get(root)!.set('my', 300)
    })
    setManualOffset(board.bd, a, 99, 99)
    setManualOffset(board.bd, a1, -50, 10)
    expect(actions.hasManualInSubtrees([root])).toBe(true)

    actions.layoutNodes([root])
    expect(board.mirror.nodes.get(a)!.layout).toBe('auto')
    expect(board.mirror.nodes.get(a1)!.layout).toBe('auto')
    expect(rootView().mx).toBe(500) // root stays put
    expect(rootView().my).toBe(300)
    expect(actions.hasManualInSubtrees([root])).toBe(false)
  })

  it('is one undo step for the whole subtree', () => {
    const { root, a, a1 } = seed()
    setManualOffset(board.bd, a, 99, 99)
    setManualOffset(board.bd, a1, -50, 10)
    actions.layoutNodes([root])
    actions.undo()
    expect(board.mirror.nodes.get(a)!.layout).toBe('manual')
    expect(board.mirror.nodes.get(a1)!.layout).toBe('manual')
  })
})

describe('per-board spacing (SPEC §6)', () => {
  it('defaults, persists and clamps through the meta map', () => {
    expect(getSpacing(board.bd)).toEqual(DEFAULT_SPACING)
    setSpacing(board.bd, { levelGap: 80, compactness: 1.4 })
    expect(getSpacing(board.bd)).toEqual({ ...DEFAULT_SPACING, levelGap: 80, compactness: 1.4 })
    setSpacing(board.bd, { levelGap: 9999, compactness: 0 })
    const s = getSpacing(board.bd)
    expect(s.levelGap).toBe(120) // clamped to range
    expect(s.compactness).toBe(0.6)
  })

  it('mirror reflows every tree when spacing changes', () => {
    const { root, a } = seed()
    const m = board.mirror
    const before = m.nodes.get(a)!.x - m.nodes.get(root)!.x
    setSpacing(board.bd, { levelGap: 110 })
    expect(m.spacing.levelGap).toBe(110)
    const after = m.nodes.get(a)!.x - m.nodes.get(root)!.x
    expect(after).toBeGreaterThan(before)
  })

  it('slider commit (restore-then-write) is one undo step and undoable', () => {
    seed()
    // live drag: ephemeral writes
    actions.setSpacingLive({ compactness: 1.1 })
    actions.setSpacingLive({ compactness: 1.3 })
    // release: one tracked step start→end
    actions.commitSpacing({ compactness: 1 }, { compactness: 1.3 })
    expect(board.mirror.spacing.compactness).toBe(1.3)
    actions.undo()
    expect(board.mirror.spacing.compactness).toBe(1)
    actions.redo()
    expect(board.mirror.spacing.compactness).toBe(1.3)
  })

  it('notifies chrome subscribers and mirrors the board name', () => {
    let fired = 0
    const unsub = board.mirror.subscribe(() => fired++)
    setSpacing(board.bd, { branchGap: 40 })
    expect(fired).toBeGreaterThan(0)
    actions.renameBoard('  Launch Plan  ')
    expect(board.mirror.boardName).toBe('Launch Plan')
    unsub()
  })
})
