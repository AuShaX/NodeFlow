// Visual constants from SPEC §12. The same values are exposed to chrome CSS
// as custom properties in index.css — keep the two in sync.

export const COLORS = {
  bg: '#FAFAF8',
  dot: '#E4E4DE',
  surface: '#FFFFFF',
  border: '#E8E8E3',
  ink: '#1A1A18',
  muted: '#8A8A82',
  accent: '#0D9488',
} as const

/** Assigned round-robin to new depth-1 branches. */
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

/** Fill for root nodes that have no explicit color (quiet dark ink, Miro-like). */
export const ROOT_DEFAULT_COLOR = COLORS.ink

export const FONT_STACK = "'Inter Variable', Inter, system-ui, sans-serif"
