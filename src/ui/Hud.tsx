import { useEffect, useState } from 'react'
import { engineRef } from '../engine'
import { uiStore, useUI } from '../state/store'

interface HudSample {
  fps: number
  paintedNodes: number
  lastPaintMs: number
  lastLayoutMs: number
  totalPaints: number
  zoom: number
}

/** Debug HUD (Cmd/Ctrl+Shift+D): paints/sec, painted node count, timings. */
export function Hud() {
  const visible = useUI((s) => s.hudVisible)
  const [sample, setSample] = useState<HudSample | null>(null)

  useEffect(() => {
    if (!visible) return
    const tick = () => {
      const engine = engineRef.current
      if (!engine) return
      const s = engine.renderer.stats
      setSample({
        fps: s.fps,
        paintedNodes: s.paintedNodes,
        lastPaintMs: s.lastPaintMs,
        lastLayoutMs: s.lastLayoutMs,
        totalPaints: s.totalPaints,
        zoom: uiStore.getState().camera.zoom,
      })
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [visible])

  if (!visible || !sample) return null
  return (
    <div className="hud">
      <div>paints/s {sample.fps}</div>
      <div>painted {sample.paintedNodes}</div>
      <div>paint {sample.lastPaintMs.toFixed(2)} ms</div>
      <div>layout {sample.lastLayoutMs.toFixed(2)} ms</div>
      <div>total {sample.totalPaints}</div>
      <div>zoom {(sample.zoom * 100).toFixed(0)}%</div>
    </div>
  )
}
