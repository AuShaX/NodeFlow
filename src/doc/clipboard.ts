import type { Side } from '../types'
import type { Mirror } from './mirror'
import type { BoardDoc, InsertPosition, Origin } from './schema'
import { createNode, localOrigin } from './schema'

/**
 * Subtree copy/paste serialization (SPEC §4 doc/clipboard.ts). v1 keeps an
 * app-internal clipboard (no system-clipboard round-trip — see DECISIONS.md).
 */
export interface SubtreeSpec {
  text: string
  shape: 'pill' | 'rounded' | 'rect'
  color: string | null
  textSize: 's' | 'm' | 'l'
  bold: boolean
  collapsed: boolean
  side: Side | null
  dir: 'right' | 'down' | 'both' | null
  connectorStyle: 'curved' | 'elbow' | null
  children: SubtreeSpec[]
}

export function serializeSubtree(mirror: Mirror, id: string): SubtreeSpec | null {
  const n = mirror.nodes.get(id)
  if (!n) return null
  return {
    text: n.text,
    shape: n.shape,
    color: n.color,
    textSize: n.textStyle.size,
    bold: n.textStyle.bold,
    collapsed: n.collapsed,
    side: n.side,
    dir: n.dir,
    connectorStyle: n.connectorStyle,
    children: n.childrenIds
      .map((cid) => serializeSubtree(mirror, cid))
      .filter((c): c is SubtreeSpec => c !== null),
  }
}

/** Instantiate a subtree spec under `parentId` (null = floating root). One transaction. */
export function materializeSubtree(
  bd: BoardDoc,
  parentId: string | null,
  spec: SubtreeSpec,
  pos?: InsertPosition,
  at?: { x: number; y: number },
  origin: Origin = localOrigin,
): string {
  let topId = ''
  bd.doc.transact(() => {
    const build = (s: SubtreeSpec, pid: string | null, p?: InsertPosition): string => {
      const id = createNode(
        bd,
        pid,
        {
          text: s.text,
          shape: s.shape,
          color: s.color,
          textSize: s.textSize,
          bold: s.bold,
          collapsed: s.collapsed,
          side: pid === null ? null : s.side,
          dir: pid === null ? (s.dir ?? 'both') : s.dir,
          connectorStyle: s.connectorStyle,
          mx: pid === null ? (at?.x ?? 0) : 0,
          my: pid === null ? (at?.y ?? 0) : 0,
        },
        p,
        origin,
      )
      for (const child of s.children) build(child, id)
      return id
    }
    topId = build(spec, parentId, pos)
  }, origin)
  return topId
}

/** Duplicate a subtree as the next sibling of the original (roots: offset copy). */
export function duplicateSubtree(bd: BoardDoc, mirror: Mirror, id: string): string | null {
  const n = mirror.nodes.get(id)
  const spec = serializeSubtree(mirror, id)
  if (!n || !spec) return null
  if (n.parentId === null) {
    const off = 40
    return materializeSubtree(bd, null, spec, undefined, { x: n.mx + off, y: n.my + off })
  }
  return materializeSubtree(bd, n.parentId, spec, { afterId: id })
}

// ---------------------------------------------------------------- clipboard

let internalClipboard: SubtreeSpec[] = []

export function clipboardWrite(specs: SubtreeSpec[]): void {
  internalClipboard = specs
}

export function clipboardRead(): SubtreeSpec[] {
  return internalClipboard
}

export function clipboardHasContent(): boolean {
  return internalClipboard.length > 0
}
