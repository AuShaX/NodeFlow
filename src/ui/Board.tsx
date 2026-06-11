import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { createEngine } from '../engine'
import { createDemoBoard } from '../doc/board'
import { openBoardDoc } from '../doc/schema'
import { TextEditorOverlay } from './TextEditorOverlay'

/**
 * Hosts the board canvas and owns the engine lifecycle. React renders only
 * chrome — the engine paints everything on the canvas.
 */
export function Board() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const doc = new Y.Doc()
    createDemoBoard(openBoardDoc(doc)) // M6 replaces this with per-board persistence
    const engine = createEngine(canvas, doc)
    return () => {
      engine.destroy()
      doc.destroy()
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="board-canvas" data-testid="board-canvas" />
      <TextEditorOverlay />
    </>
  )
}
