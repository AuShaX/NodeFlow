// Visual constants from SPEC §12 plus the M6 dark theme. The same values are
// exposed to chrome CSS as custom properties in index.css — keep them in sync.

export type ThemeMode = 'light' | 'dark'

export interface ThemeColors {
  bg: string
  dot: string
  surface: string
  border: string
  ink: string
  muted: string
  accent: string
  /** fill for root nodes that have no explicit color */
  rootFill: string
}

export const LIGHT_THEME: ThemeColors = {
  bg: '#FAFAF8',
  dot: '#E4E4DE',
  surface: '#FFFFFF',
  border: '#E8E8E3',
  ink: '#1A1A18',
  muted: '#8A8A82',
  accent: '#0D9488',
  rootFill: '#1A1A18',
}

/** Paper-after-dark: same quiet identity, inverted values, brighter teal. */
export const DARK_THEME: ThemeColors = {
  bg: '#161614',
  dot: '#2C2C28',
  surface: '#201F1D',
  border: '#34332F',
  ink: '#E8E8E3',
  muted: '#8F8F87',
  accent: '#14B8A6',
  rootFill: '#E8E8E3',
}

/**
 * The live palette every paint site reads. Mutated in place by applyTheme so
 * the engine (which reads COLORS.* each frame) follows theme switches without
 * any call-site changes.
 */
export const COLORS: ThemeColors = { ...LIGHT_THEME }

/**
 * Sentinel stored in `effectiveColor` for uncolored roots (and their
 * pre-palette descendants). Kept symbolic — not a hex — because the actual
 * fill depends on the active theme; resolve at paint time via resolveNodeColor.
 */
export const ROOT_DEFAULT_COLOR = 'auto-root'

export const resolveNodeColor = (c: string): string =>
  c === ROOT_DEFAULT_COLOR ? COLORS.rootFill : c

/**
 * Readable text color for a colored fill (white on vivid/dark fills, near-black
 * on light ones — e.g. the dark theme's light root chip). Cached per fill.
 */
const textOnCache = new Map<string, string>()
export function textOnFill(fill: string): string {
  let v = textOnCache.get(fill)
  if (v === undefined) {
    v = relativeLuminance(fill) > 0.55 ? '#1A1A18' : '#FFFFFF'
    textOnCache.set(fill, v)
  }
  return v
}

function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const chan = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return (
    0.2126 * chan((n >> 16) & 0xff) + 0.7152 * chan((n >> 8) & 0xff) + 0.0722 * chan(n & 0xff)
  )
}

const THEME_STORAGE_KEY = 'nodeflow-theme'

export function initialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // storage unavailable (private mode): fall through to the media query
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** Swap the live palette + CSS scope; callers repaint via the UI store. */
export function applyTheme(mode: ThemeMode): void {
  Object.assign(COLORS, mode === 'dark' ? DARK_THEME : LIGHT_THEME)
  document.documentElement.dataset.theme = mode
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // non-persistent is fine
  }
}

/** Assigned round-robin to new depth-1 branches (works on both themes). */
export const BRANCH_PALETTE = [
  '#0D9488',
  '#E07A3F',
  '#5B7FD4',
  '#C2528B',
  '#6BA34F',
  '#8A63C9',
  '#D4A013',
  '#4FA3A5',
  '#C75450',
  '#7A7A72',
] as const

export const FONT_STACK = "'Inter Variable', Inter, system-ui, sans-serif"
