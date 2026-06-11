// Shared core types. Keep this module dependency-free: engine, doc, layout and ui all import it.

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Shape = 'pill' | 'rounded' | 'rect'
export type TextSize = 's' | 'm' | 'l'
export type LayoutDir = 'right' | 'down' | 'both'
export type Side = 'left' | 'right'
export type ConnectorStyle = 'curved' | 'elbow'
export type LinkStyle = 'solid' | 'dashed'
export type ArrowStyle = 'none' | 'end' | 'both'

export interface TextStyle {
  size: TextSize
  bold: boolean
}

/**
 * Plain-JS view of one node, produced by the doc mirror (or, in M1, the demo
 * scene). Field order mirrors the Yjs schema in SPEC §5 followed by derived
 * data. `x/y` is the node CENTER in world units; `renderX/renderY` are the
 * animated positions the renderer actually paints at.
 */
export interface NodeView {
  id: string
  parentId: string | null
  order: string
  text: string
  shape: Shape
  color: string | null
  textStyle: TextStyle
  collapsed: boolean
  layout: 'auto' | 'manual'
  mx: number
  my: number
  side: Side | null
  dir: LayoutDir | null
  connectorStyle: ConnectorStyle | null
  // ---- derived ----
  childrenIds: string[]
  depth: number
  effectiveColor: string
  width: number
  height: number
  textLines: string[]
  /** layout slot (center, world units) */
  x: number
  y: number
  /** animated position (center, world units) */
  renderX: number
  renderY: number
  renderAlpha: number
  renderScale: number
  subtreeBounds: Rect
  /** number of descendants (not counting the node itself) */
  subtreeCount: number
  /** false when any ancestor is collapsed */
  visible: boolean
  /** still painted while animating out (collapse / delete) */
  vanishing: boolean
}

export interface LinkView {
  id: string
  fromId: string
  toId: string
  label: string
  style: LinkStyle
  arrow: ArrowStyle
}

/** Minimal spatial-query surface the renderer/hit-testing needs. */
export interface SpatialQuery {
  queryRect(rect: Rect): Set<string>
}

/**
 * What the renderer reads each frame. The doc mirror implements this; in M1 a
 * static demo scene does.
 */
export interface SceneSource {
  nodes: ReadonlyMap<string, NodeView>
  /** preorder traversal of every root: parents before children */
  paintList: readonly string[]
  rootIds: readonly string[]
  links: readonly LinkView[]
  spatial: SpatialQuery
  /** nodes mid-drag: the interaction layer paints them as a ghost instead */
  draggingIds: ReadonlySet<string>
  /** deleted nodes still fading out; painted after the main pass */
  exiting: readonly NodeView[]
  /** look up a live node, falling back to exiting ones (for edge painting) */
  getAnyNode(id: string): NodeView | undefined
  /** union of all subtree bounds, or null when the board is empty */
  contentBounds(): Rect | null
}

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export const pointInRect = (p: Point, r: Rect, slop = 0): boolean =>
  p.x >= r.x - slop && p.x <= r.x + r.w + slop && p.y >= r.y - slop && p.y <= r.y + r.h + slop

export const rectUnion = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

export const expandRect = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
})

/** Axis-aligned rect of a node at its current animated position. */
export const nodeRenderRect = (n: NodeView): Rect => ({
  x: n.renderX - n.width / 2,
  y: n.renderY - n.height / 2,
  w: n.width,
  h: n.height,
})

/** Axis-aligned rect of a node at its layout slot. */
export const nodeLayoutRect = (n: NodeView): Rect => ({
  x: n.x - n.width / 2,
  y: n.y - n.height / 2,
  w: n.width,
  h: n.height,
})

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
