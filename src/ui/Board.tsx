import { useEffect, useRef } from 'react'
import type { Engine } from '../engine'
import { createEngine } from '../engine'
import { createDemoBoard } from '../doc/board'
import { createRoot, initMeta, openBoardDoc, seedOrigin } from '../doc/schema'
import {
  getBoardMeta,
  loadViewport,
  openPersistentBoard,
  saveViewport,
  takeSeed,
  upsertBoardMeta,
} from '../doc/boards'
import { renderThumbnail } from '../engine/exportImage'
import { resetBoardUI, setSelection, uiStore } from '../state/store'
import { TextEditorOverlay } from './TextEditorOverlay'
import { LinkLabelEditor } from './LinkLabelEditor'

/**
 * Hosts the board canvas and owns the engine + persistence lifecycle for one
 * board id: open the y-indexeddb doc, seed first-run content, restore the
 * viewport, keep the registry (name/updatedAt/thumbnail) and the autosave
 * indicator in sync. React renders only chrome — the engine paints the board.
 */
export function Board({ boardId, onReady }: { boardId: string; onReady: (r: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    let engine: Engine | null = null
    let cleanupFns: (() => void)[] = []

    void (async () => {
      const { doc, provider } = await openPersistentBoard(boardId)
      if (disposed) {
        provider.destroy()
        doc.destroy()
        return
      }
      const bd = openBoardDoc(doc)

      // First open of a fresh board: seed demo content or the onboarding root.
      const seed = takeSeed(boardId)
      let starterRootId: string | null = null
      if (bd.nodes.size === 0) {
        const meta = getBoardMeta(boardId)
        if (seed === 'demo') {
          createDemoBoard(bd)
        } else {
          initMeta(bd, meta?.name ?? 'Untitled')
          starterRootId = createRoot(
            bd,
            { x: 0, y: 0 },
            { text: 'Press Tab to add an idea' },
            seedOrigin,
          )
        }
      }

      resetBoardUI()
      engine = createEngine(canvas, doc, { initialCamera: loadViewport(boardId) })
      if (starterRootId) setSelection([starterRootId])

      // Autosave indicator: any doc update → "Saving…", quiet for 700ms → "Saved".
      let saveTimer: number | undefined
      const onDocUpdate = (): void => {
        if (uiStore.getState().saveState !== 'saving') uiStore.setState({ saveState: 'saving' })
        clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => uiStore.setState({ saveState: 'saved' }), 700)
      }
      doc.on('update', onDocUpdate)
      cleanupFns.push(() => {
        clearTimeout(saveTimer)
        doc.off('update', onDocUpdate)
      })

      // Registry: keep name + updatedAt fresh (debounced) for the home grid.
      let metaTimer: number | undefined
      const unsubMirror = engine.board.mirror.subscribe(() => {
        clearTimeout(metaTimer)
        metaTimer = window.setTimeout(() => {
          upsertBoardMeta(boardId, {
            name: engine!.board.mirror.boardName || 'Untitled',
            updatedAt: Date.now(),
          })
        }, 1000)
      })
      cleanupFns.push(() => {
        clearTimeout(metaTimer)
        unsubMirror()
      })

      // Viewport: persist the camera per board (debounced).
      let camTimer: number | undefined
      const unsubCam = uiStore.subscribe((s, prev) => {
        if (s.camera === prev.camera) return
        clearTimeout(camTimer)
        camTimer = window.setTimeout(() => saveViewport(boardId, uiStore.getState().camera), 400)
      })
      cleanupFns.push(() => {
        clearTimeout(camTimer)
        unsubCam()
      })

      // Thumbnail for the home grid: on leave and on tab close.
      const snapshot = (): void => {
        const thumb = renderThumbnail(engine!.board.mirror)
        upsertBoardMeta(boardId, {
          name: engine!.board.mirror.boardName || 'Untitled',
          updatedAt: Date.now(),
          ...(thumb ? { thumbnail: thumb } : {}),
        })
        saveViewport(boardId, uiStore.getState().camera)
      }
      window.addEventListener('pagehide', snapshot)
      cleanupFns.push(() => window.removeEventListener('pagehide', snapshot))

      cleanupFns.push(() => {
        snapshot()
        engine!.destroy()
        provider.destroy()
        doc.destroy()
      })
      onReady(true)
    })()

    return () => {
      disposed = true
      onReady(false)
      // push order: detach listeners first, snapshot + engine/doc teardown last
      for (const fn of cleanupFns) fn()
      cleanupFns = []
    }
    // onReady is stable (useState setter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  return (
    <>
      <canvas ref={canvasRef} className="board-canvas" data-testid="board-canvas" />
      <TextEditorOverlay />
      <LinkLabelEditor />
    </>
  )
}
