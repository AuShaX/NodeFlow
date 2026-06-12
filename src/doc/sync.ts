import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Point } from '../types'
import type { AwarenessShape } from '../state/presence'
import { localUser, presence, syncUrl } from '../state/presence'
import { uiStore } from '../state/store'

/**
 * Board ↔ sync-relay wiring (Stage 2). One WebsocketProvider per open board,
 * room = board id. Local-first: callers must check syncUrl() first — without
 * a configured server this module is never invoked. Remote doc updates carry
 * the provider as transaction origin, so the local UndoManager (trackedOrigins
 * = localOrigin) never undoes another user's work.
 */

export interface BoardSync {
  provider: WebsocketProvider
  /** push the local pointer (world coords); throttled internally */
  sendCursor(cursor: Point | null): void
  destroy(): void
}

const CURSOR_THROTTLE_MS = 40

export function connectBoardSync(doc: Y.Doc, boardId: string): BoardSync | null {
  const url = syncUrl()
  if (!url) return null

  uiStore.setState({ syncStatus: 'connecting' })
  const provider = new WebsocketProvider(url, `nodeflow-${boardId}`, doc, {
    // y-indexeddb already loaded local state; the provider merges server state
    resyncInterval: 15000,
  })
  const awareness = provider.awareness

  awareness.setLocalState({
    user: localUser(doc.clientID),
    cursor: null,
    selection: [],
    editing: null,
  } satisfies AwarenessShape)

  const onAwareness = (): void => {
    presence.apply(awareness.getStates() as Map<number, AwarenessShape | null>, doc.clientID)
  }
  awareness.on('change', onAwareness)
  onAwareness()

  const onStatus = ({ status }: { status: string }): void => {
    uiStore.setState({ syncStatus: status === 'connected' ? 'online' : 'connecting' })
  }
  provider.on('status', onStatus)

  // reflect local selection + editing into awareness (low-frequency)
  const unsubUi = uiStore.subscribe((s, prev) => {
    if (s.selection !== prev.selection || s.editing !== prev.editing) {
      awareness.setLocalStateField('selection', [...s.selection])
      awareness.setLocalStateField('editing', s.editing?.id ?? null)
    }
  })

  let lastCursorAt = 0
  let cursorTrailing: number | undefined

  const sendCursor = (cursor: Point | null): void => {
    const now = performance.now()
    const push = (): void => {
      lastCursorAt = performance.now()
      awareness.setLocalStateField('cursor', cursor)
    }
    clearTimeout(cursorTrailing)
    if (cursor === null || now - lastCursorAt >= CURSOR_THROTTLE_MS) push()
    else cursorTrailing = window.setTimeout(push, CURSOR_THROTTLE_MS - (now - lastCursorAt))
  }

  return {
    provider,
    sendCursor,
    destroy() {
      clearTimeout(cursorTrailing)
      unsubUi()
      awareness.off('change', onAwareness)
      provider.off('status', onStatus)
      awareness.setLocalState(null) // broadcast leave
      provider.destroy()
      presence.clear()
      uiStore.setState({ syncStatus: 'local' })
    },
  }
}
