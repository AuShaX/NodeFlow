import * as Y from 'yjs'
import type { BoardDoc } from './schema'
import { localOrigin } from './schema'

export interface UndoApi {
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  manager: Y.UndoManager
  destroy(): void
}

/**
 * UndoManager over nodes + links + meta, tracking only localOrigin (SPEC §5):
 * ephemeral mid-gesture writes and programmatic seeds are invisible to undo.
 * captureTimeout 0 → every transact is its own undo step; gesture coalescing
 * comes from writing intermediates with the ephemeral origin instead.
 */
export function createUndo(bd: BoardDoc): UndoApi {
  const manager = new Y.UndoManager([bd.nodes, bd.links, bd.meta], {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout: 0,
  })
  return {
    undo: () => {
      manager.undo()
    },
    redo: () => {
      manager.redo()
    },
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    manager,
    destroy: () => manager.destroy(),
  }
}
