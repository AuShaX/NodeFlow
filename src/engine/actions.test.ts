import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Animator } from './animator'
import { BoardActions } from './actions'
import { setMeasureFunction } from './textMeasure'
import type { Board } from '../doc/board'
import { createBoard } from '../doc/board'
import { createNode } from '../doc/schema'
import { setSelection, uiStore } from '../state/store'

let board: Board
let actions: BoardActions
let rootId: string

beforeEach(() => {
  setMeasureFunction((text) => text.length * 8)
  board = createBoard(new Animator(), () => {}, new Y.Doc())
  actions = new BoardActions(board)
  rootId = createNode(board.bd, null, { text: 'Root' })
  setSelection([rootId])
})

afterEach(() => {
  board.destroy()
  setMeasureFunction(null)
  setSelection([])
  uiStore.setState({ editing: null })
})

describe('keyboard node creation', () => {
  it('Tab-created node + typed text is ONE undo step', () => {
    const id = actions.addChild(rootId)!
    actions.commitEdit(id, 'Hello')
    expect(board.mirror.nodes.get(id)!.text).toBe('Hello')
    actions.undo()
    expect(board.mirror.nodes.has(id)).toBe(false)
    actions.redo()
    expect(board.mirror.nodes.get(id)?.text).toBe('Hello')
  })

  it('committing a new node with empty text cancels the creation', () => {
    const before = board.mirror.nodes.size
    const id = actions.addChild(rootId)!
    expect(board.mirror.nodes.size).toBe(before + 1)
    const removed = actions.commitEdit(id, '')
    expect(removed).toBe(true)
    expect(board.mirror.nodes.size).toBe(before)
    // history is clean: undo should NOT resurrect the cancelled node
    actions.undo()
    expect(board.mirror.nodes.has(id)).toBe(false)
  })

  it('Enter chain ends on an empty node without creating a sibling', () => {
    const a = actions.addChild(rootId)!
    actions.commitAndAddSibling(a, 'First')
    const b = uiStore.getState().editing!.id
    expect(b).not.toBe(a)
    const before = board.mirror.nodes.size
    actions.commitAndAddSibling(b, '') // empty → chain ends
    expect(board.mirror.nodes.size).toBe(before - 1)
    expect(uiStore.getState().editing).toBeNull()
  })

  it('depth-1 children auto-balance across sides', () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = actions.addChild(rootId, false)!
      actions.commitEdit(id, 'n' + i)
      ids.push(id)
    }
    const sides = ids.map((id) => board.mirror.nodes.get(id)!.side)
    expect(sides.filter((s) => s === 'right').length).toBe(2)
    expect(sides.filter((s) => s === 'left').length).toBe(2)
  })

  it('selection moves to the parent after deleting a subtree', () => {
    const a = actions.addChild(rootId, false)!
    setSelection([a])
    actions.deleteSelection()
    expect([...uiStore.getState().selection]).toEqual([rootId])
    expect(board.mirror.nodes.has(a)).toBe(false)
  })
})
