import type { SVGProps } from 'react'

/**
 * Domain icons lucide doesn't have: node shapes, connector styles, layout
 * directions, arrowheads. Drawn on lucide's 24px grid / 2px round stroke so
 * they sit seamlessly next to lucide glyphs.
 */

type P = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: P) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconShapePill = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="8" width="18" height="8" rx="4" />
  </Svg>
)

export const IconShapeRounded = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="17" height="10" rx="3" />
  </Svg>
)

export const IconShapeRect = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="17" height="10" rx="0.75" />
  </Svg>
)

export const IconConnCurved = (p: P) => (
  <Svg {...p}>
    <path d="M4 18c8 0 8-12 16-12" />
  </Svg>
)

export const IconConnElbow = (p: P) => (
  <Svg {...p}>
    <path d="M4 18h7.25A.75.75 0 0 0 12 17.25V6.75A.75.75 0 0 1 12.75 6H20" />
  </Svg>
)

export const IconDirRight = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="2.4" />
    <path d="M10 12h9" />
    <path d="m15.5 8.5 3.5 3.5-3.5 3.5" />
  </Svg>
)

export const IconDirDown = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="2.4" />
    <path d="M12 10v9" />
    <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
  </Svg>
)

export const IconDirBoth = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.4" />
    <path d="M8.6 12H2.5m12.9 0h6.1" />
    <path d="m6 8.5-3.5 3.5L6 15.5" />
    <path d="m18 8.5 3.5 3.5-3.5 3.5" />
  </Svg>
)

export const IconArrowNone = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h16" />
  </Svg>
)

export const IconArrowEnd = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h15" />
    <path d="m14.5 7.5 4.5 4.5-4.5 4.5" />
  </Svg>
)

export const IconArrowBoth = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m9.5 7.5-4.5 4.5 4.5 4.5" />
    <path d="m14.5 7.5 4.5 4.5-4.5 4.5" />
  </Svg>
)

export const IconLineSolid = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h16" />
  </Svg>
)

export const IconLineDashed = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h2.5m4.25 0h2.5m4.25 0H20" />
  </Svg>
)
