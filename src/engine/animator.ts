import type { NodeView } from '../types'
import { layoutEase, lerp } from './easing'

export const LAYOUT_TWEEN_MS = 180
export const ENTER_TWEEN_MS = 120
export const EXIT_TWEEN_MS = 120

interface Tween {
  node: NodeView
  t0: number
  dur: number
  fx: number
  fy: number
  fa: number
  fs: number
  tx: number
  ty: number
  ta: number
  ts: number
  onDone?: () => void
}

export interface TweenTarget {
  x?: number
  y?: number
  alpha?: number
  scale?: number
}

/**
 * Tweens NodeView render fields (renderX/renderY/renderAlpha/renderScale)
 * toward targets. Interrupted tweens retarget from the current animated value
 * — never restart from origin. Honors prefers-reduced-motion by snapping.
 */
export class Animator {
  private tweens = new Map<string, Tween>()
  private reduceMotion = false

  constructor() {
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)')
      this.reduceMotion = mq.matches
      mq.addEventListener?.('change', (e) => {
        this.reduceMotion = e.matches
      })
    }
  }

  get active(): boolean {
    return this.tweens.size > 0
  }

  /** Animate a node's render fields to the given targets. */
  tweenTo(node: NodeView, target: TweenTarget, dur = LAYOUT_TWEEN_MS, onDone?: () => void): void {
    const tx = target.x ?? node.renderX
    const ty = target.y ?? node.renderY
    const ta = target.alpha ?? node.renderAlpha
    const ts = target.scale ?? node.renderScale
    if (this.reduceMotion || dur <= 0) {
      this.tweens.delete(node.id)
      node.renderX = tx
      node.renderY = ty
      node.renderAlpha = ta
      node.renderScale = ts
      onDone?.()
      return
    }
    // No-op tween? Snap and skip.
    if (
      Math.abs(tx - node.renderX) < 0.01 &&
      Math.abs(ty - node.renderY) < 0.01 &&
      Math.abs(ta - node.renderAlpha) < 0.001 &&
      Math.abs(ts - node.renderScale) < 0.001
    ) {
      this.tweens.delete(node.id)
      node.renderX = tx
      node.renderY = ty
      node.renderAlpha = ta
      node.renderScale = ts
      onDone?.()
      return
    }
    this.tweens.set(node.id, {
      node,
      t0: performance.now(),
      dur,
      fx: node.renderX,
      fy: node.renderY,
      fa: node.renderAlpha,
      fs: node.renderScale,
      tx,
      ty,
      ta,
      ts,
      onDone,
    })
  }

  /** Stop animating a node, leaving its render fields where they are. */
  cancel(nodeId: string): void {
    this.tweens.delete(nodeId)
  }

  /** Stop animating a node and snap it to its tween target. */
  finish(nodeId: string): void {
    const t = this.tweens.get(nodeId)
    if (!t) return
    this.tweens.delete(nodeId)
    t.node.renderX = t.tx
    t.node.renderY = t.ty
    t.node.renderAlpha = t.ta
    t.node.renderScale = t.ts
    t.onDone?.()
  }

  clear(): void {
    this.tweens.clear()
  }

  /**
   * Advance all tweens; mutates render fields in place.
   * Returns true while any tween is still running.
   */
  tick(now: number): boolean {
    if (this.tweens.size === 0) return false
    const done: Tween[] = []
    for (const t of this.tweens.values()) {
      const k = Math.min(1, (now - t.t0) / t.dur)
      const e = layoutEase(k)
      t.node.renderX = lerp(t.fx, t.tx, e)
      t.node.renderY = lerp(t.fy, t.ty, e)
      t.node.renderAlpha = lerp(t.fa, t.ta, e)
      t.node.renderScale = lerp(t.fs, t.ts, e)
      if (k >= 1) done.push(t)
    }
    for (const t of done) {
      this.tweens.delete(t.node.id)
      t.onDone?.()
    }
    return this.tweens.size > 0
  }
}
