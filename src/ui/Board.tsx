import { useEffect, useRef } from 'react'
import { createEngine } from '../engine'
import { buildDemoScene } from '../doc/demoScene'

/**
 * Hosts the board canvas and owns the engine lifecycle. React renders only
 * chrome — the engine paints everything on the canvas.
 */
export function Board() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = createEngine(canvas, buildDemoScene())
    return () => engine.destroy()
  }, [])

  return <canvas ref={canvasRef} className="board-canvas" data-testid="board-canvas" />
}
