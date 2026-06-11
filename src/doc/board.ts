import * as Y from 'yjs'
import type { Animator } from '../engine/animator'
import type { BoardDoc } from './schema'
import { createNode, initMeta, openBoardDoc, seedOrigin } from './schema'
import { Mirror } from './mirror'
import type { UndoApi } from './undo'
import { createUndo } from './undo'
import type { DemoNode } from './demoTree'
import { demoCrossLinks, demoRoot } from './demoTree'
import { createLink } from './schema'

/** A live board: Yjs doc + mirror + undo, wired together. */
export interface Board {
  bd: BoardDoc
  mirror: Mirror
  undo: UndoApi
  destroy(): void
}

export function createBoard(
  animator: Animator,
  onUpdate: () => void,
  doc: Y.Doc = new Y.Doc(),
): Board {
  const bd = openBoardDoc(doc)
  const undo = createUndo(bd)
  const mirror = new Mirror(bd, animator, onUpdate)
  return {
    bd,
    mirror,
    undo,
    destroy() {
      mirror.destroy()
      undo.destroy()
    },
  }
}

/** Seed the demo map (SPEC §3) into an empty board. Not undoable. */
export function createDemoBoard(bd: BoardDoc): void {
  if (bd.nodes.size > 0) return
  initMeta(bd, 'Product Launch')
  bd.doc.transact(() => {
    const addTree = (
      spec: DemoNode,
      parentId: string | null,
      keyed: Map<string, string>,
    ): string => {
      const id = createNode(
        bd,
        parentId,
        { text: spec.text, collapsed: spec.collapsed ?? false, side: spec.side ?? null },
        undefined,
        seedOrigin,
      )
      if (spec.key) keyed.set(spec.key, id)
      for (const child of spec.children ?? []) addTree(child, id, keyed)
      return id
    }
    const keyed = new Map<string, string>()
    addTree(demoRoot, null, keyed)
    for (const link of demoCrossLinks) {
      const from = keyed.get(link.fromKey)
      const to = keyed.get(link.toKey)
      if (from && to) {
        createLink(bd, from, to, { label: link.label, style: link.style }, seedOrigin)
      }
    }
  }, seedOrigin)
}
