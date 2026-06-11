import { useRef } from 'react'
import type { Engine } from '../engine'
import type { SpacingTokens } from '../layout/mindmapLayout'
import { SPACING_RANGES } from '../layout/mindmapLayout'

/**
 * One spacing-token slider. Live writes are ephemeral; release restores the
 * start value then commits the end with the tracked origin — a whole drag is
 * one undo step (same recipe as free-move commits). Shared by the style
 * panel and the bottom-toolbar quick popover.
 */
export function SpacingSlider({
  engine,
  token,
  label,
  format,
  step,
}: {
  engine: Engine
  token: keyof SpacingTokens
  label: string
  format: (v: number) => string
  step: number
}) {
  const value = engine.board.mirror.spacing[token]
  const start = useRef<number | null>(null)
  const [min, max] = SPACING_RANGES[token]

  const live = (v: number): void => {
    if (start.current === null) start.current = engine.board.mirror.spacing[token]
    engine.actions.setSpacingLive({ [token]: v })
  }
  const commit = (): void => {
    const s = start.current
    start.current = null
    if (s === null) return
    const end = engine.board.mirror.spacing[token]
    if (end !== s) engine.actions.commitSpacing({ [token]: s }, { [token]: end })
  }

  return (
    <label className="slider-row">
      <span className="panel-row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => live(Number(e.target.value))}
        onPointerUp={commit}
        onBlur={commit}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') commit()
        }}
      />
      <span className="slider-value">{format(value)}</span>
    </label>
  )
}

/** Quick compactness control for the bottom toolbar (SPEC §12). */
export function SpacingQuick({ engine, onMore }: { engine: Engine; onMore: () => void }) {
  return (
    <div className="spacing-quick">
      <SpacingSlider
        engine={engine}
        token="compactness"
        label="Compactness"
        format={(v) => `${v.toFixed(2)}×`}
        step={0.05}
      />
      <button
        type="button"
        className="text-btn"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onMore}
      >
        All spacing options…
      </button>
    </div>
  )
}
