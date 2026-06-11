import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useDismiss } from './hooks'
import { BRANCH_PALETTE } from '../theme'

/**
 * Small chrome primitives shared by the toolbars, panel and menus. Buttons
 * preventDefault on pointerdown so clicking chrome never steals keyboard
 * focus from the canvas (Tab keeps creating nodes after you pick a color).
 * Keyboard users can still Tab into chrome — focus styling stays intact.
 */

export function IconButton({
  label,
  onClick,
  active,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={'icon-btn' + (active ? ' is-active' : '') + (danger ? ' is-danger' : '')}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export const Divider = () => <span className="tb-divider" role="separator" />

/**
 * Anchored popover; the parent wraps the trigger + this in `.popover-host`
 * (position: relative). Direction comes from the host's CSS.
 */
export function Popover({
  open,
  onClose,
  className,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  className?: string
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, open)
  if (!open) return null
  return (
    <div ref={ref} className={'popover' + (className ? ' ' + className : '')} aria-label={label}>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode; title: string }[]
  /** null = mixed selection, nothing highlighted */
  value: T | null
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={'seg-item' + (value === o.value ? ' is-active' : '')}
          title={o.title}
          aria-label={o.title}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The 10-color default palette + inherit ("Auto") + a custom color well
 * (SPEC §11). `current` highlights the matching swatch; null highlights Auto.
 */
export function ColorPalette({
  current,
  showAuto,
  onPick,
}: {
  current: string | null
  /** offer the inherit option (node styling; not meaningful elsewhere) */
  showAuto: boolean
  onPick: (color: string | null) => void
}) {
  const norm = current?.toUpperCase() ?? null
  return (
    <div className="palette">
      {BRANCH_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={'swatch' + (norm === c.toUpperCase() ? ' is-active' : '')}
          style={{ background: c }}
          title={c}
          aria-label={`Color ${c}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        >
          {norm === c.toUpperCase() && <Check size={12} strokeWidth={3} />}
        </button>
      ))}
      {showAuto && (
        <button
          type="button"
          className={'swatch swatch-auto' + (current === null ? ' is-active' : '')}
          title="Auto (inherit branch color)"
          aria-label="Auto color"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(null)}
        />
      )}
      <label className="swatch swatch-custom" title="Custom color…">
        <input
          type="color"
          value={norm && /^#[0-9A-F]{6}$/.test(norm) ? norm : '#0D9488'}
          onChange={(e) => onPick(e.target.value.toUpperCase())}
          aria-label="Custom color"
        />
      </label>
    </div>
  )
}
