import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import type {
  ArrowStyle,
  ConnectorStyle,
  LayoutDir,
  LinkStyle,
  Shape,
  Side,
  TextSize,
} from '../types'
import { keyBetween } from './order'
import { BRANCH_PALETTE } from '../theme'
import type { SpacingTokens } from '../layout/mindmapLayout'
import { DEFAULT_SPACING, SPACING_RANGES } from '../layout/mindmapLayout'
import { clamp } from '../types'

/**
 * Yjs document model (SPEC §5). ALL mutations go through functions in this
 * module, each wrapped in doc.transact with an origin:
 *  - localOrigin: user edits — tracked by the UndoManager
 *  - ephemeralOrigin: intermediate values during continuous gestures — NOT
 *    tracked, so one drag/text-edit = one undo step when the final value is
 *    committed with localOrigin
 *  - seedOrigin: programmatic content (demo board, imports) — not undoable
 */
export const localOrigin = { origin: 'local' } as const
export const ephemeralOrigin = { origin: 'ephemeral' } as const
export const seedOrigin = { origin: 'seed' } as const

export type Origin = typeof localOrigin | typeof ephemeralOrigin | typeof seedOrigin

export interface BoardDoc {
  doc: Y.Doc
  meta: Y.Map<unknown>
  nodes: Y.Map<Y.Map<unknown>>
  links: Y.Array<Y.Map<unknown>>
}

export const SCHEMA_VERSION = 1

export function openBoardDoc(doc: Y.Doc = new Y.Doc()): BoardDoc {
  return {
    doc,
    meta: doc.getMap('meta'),
    nodes: doc.getMap('nodes') as Y.Map<Y.Map<unknown>>,
    links: doc.getArray('links') as Y.Array<Y.Map<unknown>>,
  }
}

// ------------------------------------------------------------------ reading

export const nodeField = <T>(m: Y.Map<unknown>, key: string): T => m.get(key) as T

export function getNodeMap(bd: BoardDoc, id: string): Y.Map<unknown> | undefined {
  return bd.nodes.get(id)
}

export function childIdsOf(bd: BoardDoc, parentId: string | null): string[] {
  const out: { id: string; order: string }[] = []
  bd.nodes.forEach((m, id) => {
    if ((m.get('parentId') ?? null) === parentId) {
      out.push({ id, order: (m.get('order') as string) ?? '' })
    }
  })
  out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  return out.map((e) => e.id)
}

/** All descendant ids of `id` (not including `id`). */
export function descendantIds(bd: BoardDoc, id: string): string[] {
  const byParent = new Map<string, string[]>()
  bd.nodes.forEach((m, nid) => {
    const p = (m.get('parentId') as string | null) ?? null
    if (p !== null) {
      let arr = byParent.get(p)
      if (!arr) {
        arr = []
        byParent.set(p, arr)
      }
      arr.push(nid)
    }
  })
  const out: string[] = []
  const stack = [id]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const c of byParent.get(cur) ?? []) {
      out.push(c)
      stack.push(c)
    }
  }
  return out
}

export function depthOf(bd: BoardDoc, id: string): number {
  let depth = 0
  let cur = bd.nodes.get(id)
  while (cur) {
    const p = cur.get('parentId') as string | null
    if (p === null || p === undefined) break
    depth++
    cur = bd.nodes.get(p)
  }
  return depth
}

// ----------------------------------------------------------------- creating

export interface NewNodeFields {
  text?: string
  shape?: Shape
  color?: string | null
  textSize?: TextSize
  bold?: boolean
  collapsed?: boolean
  side?: Side | null
  dir?: LayoutDir | null
  connectorStyle?: ConnectorStyle | null
  mx?: number
  my?: number
  layout?: 'auto' | 'manual'
}

function buildNodeMap(
  id: string,
  parentId: string | null,
  order: string,
  f: NewNodeFields,
): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  m.set('id', id)
  m.set('parentId', parentId)
  m.set('order', order)
  m.set('text', f.text ?? '')
  m.set('shape', f.shape ?? (parentId === null ? 'rounded' : 'pill'))
  m.set('color', f.color ?? null)
  m.set('textSize', f.textSize ?? (parentId === null ? 'l' : 'm'))
  m.set('bold', f.bold ?? parentId === null)
  m.set('collapsed', f.collapsed ?? false)
  m.set('layout', f.layout ?? 'auto')
  m.set('mx', f.mx ?? 0)
  m.set('my', f.my ?? 0)
  m.set('side', f.side ?? null)
  m.set('dir', f.dir ?? (parentId === null ? 'both' : null))
  m.set('connectorStyle', f.connectorStyle ?? (parentId === null ? 'curved' : null))
  return m
}

export interface InsertPosition {
  /** order key of the sibling to insert after (null = at the start) */
  afterId?: string | null
  /** order key of the sibling to insert before (null = at the end) */
  beforeId?: string | null
}

function orderForInsert(bd: BoardDoc, parentId: string | null, pos?: InsertPosition): string {
  const siblings = childIdsOf(bd, parentId)
  const orderOf = (id: string) => bd.nodes.get(id)?.get('order') as string
  if (pos?.afterId) {
    const i = siblings.indexOf(pos.afterId)
    const after = orderOf(pos.afterId)
    const before = i >= 0 && i + 1 < siblings.length ? orderOf(siblings[i + 1]) : null
    return keyBetween(after ?? null, before)
  }
  if (pos?.beforeId) {
    const i = siblings.indexOf(pos.beforeId)
    const before = orderOf(pos.beforeId)
    const after = i > 0 ? orderOf(siblings[i - 1]) : null
    return keyBetween(after, before ?? null)
  }
  // append at the end
  const last = siblings.length > 0 ? orderOf(siblings[siblings.length - 1]) : null
  return keyBetween(last, null)
}

/** Round-robin palette color for a new depth-1 branch. */
export function nextBranchColor(bd: BoardDoc, rootId: string): string {
  const count = childIdsOf(bd, rootId).length
  return BRANCH_PALETTE[count % BRANCH_PALETTE.length]
}

export function createNode(
  bd: BoardDoc,
  parentId: string | null,
  fields: NewNodeFields = {},
  pos?: InsertPosition,
  origin: Origin = localOrigin,
): string {
  const id = nanoid(12)
  bd.doc.transact(() => {
    const order = orderForInsert(bd, parentId, pos)
    const f = { ...fields }
    if (parentId !== null && f.color === undefined) {
      const parent = bd.nodes.get(parentId)
      const parentIsRoot = parent ? (parent.get('parentId') ?? null) === null : false
      if (parentIsRoot) f.color = nextBranchColor(bd, parentId)
    }
    bd.nodes.set(id, buildNodeMap(id, parentId, order, f))
  }, origin)
  return id
}

export function createRoot(
  bd: BoardDoc,
  at: { x: number; y: number },
  fields: NewNodeFields = {},
  origin: Origin = localOrigin,
): string {
  return createNode(bd, null, { ...fields, mx: at.x, my: at.y }, undefined, origin)
}

// ----------------------------------------------------------------- updating

type Scalar = string | number | boolean | null

function setFields(bd: BoardDoc, id: string, fields: Record<string, Scalar>, origin: Origin): void {
  const m = bd.nodes.get(id)
  if (!m) return
  bd.doc.transact(() => {
    for (const [k, v] of Object.entries(fields)) {
      if (m.get(k) !== v) m.set(k, v)
    }
  }, origin)
}

export const setNodeText = (
  bd: BoardDoc,
  id: string,
  text: string,
  origin: Origin = localOrigin,
): void => setFields(bd, id, { text }, origin)

export const setCollapsed = (bd: BoardDoc, id: string, collapsed: boolean): void =>
  setFields(bd, id, { collapsed }, localOrigin)

export const setShape = (bd: BoardDoc, id: string, shape: Shape): void =>
  setFields(bd, id, { shape }, localOrigin)

export const setColor = (bd: BoardDoc, id: string, color: string | null): void =>
  setFields(bd, id, { color }, localOrigin)

export const setTextStyle = (bd: BoardDoc, id: string, size: TextSize, bold: boolean): void =>
  setFields(bd, id, { textSize: size, bold }, localOrigin)

export const setDir = (bd: BoardDoc, id: string, dir: LayoutDir): void =>
  setFields(bd, id, { dir }, localOrigin)

export const setConnectorStyle = (bd: BoardDoc, id: string, style: ConnectorStyle): void =>
  setFields(bd, id, { connectorStyle: style }, localOrigin)

export const setSide = (bd: BoardDoc, id: string, side: Side): void =>
  setFields(bd, id, { side }, localOrigin)

/** Set a manual offset (free-move). Pass origin=ephemeralOrigin mid-drag. */
export const setManualOffset = (
  bd: BoardDoc,
  id: string,
  mx: number,
  my: number,
  origin: Origin = localOrigin,
): void => setFields(bd, id, { layout: 'manual', mx, my }, origin)

/** Move a root (mx/my are absolute for roots; roots keep layout:'auto'). */
export const setRootPosition = (
  bd: BoardDoc,
  id: string,
  x: number,
  y: number,
  origin: Origin = localOrigin,
): void => setFields(bd, id, { mx: x, my: y }, origin)

/** Re-enable auto layout for a node (clears its manual offset). */
export const clearManualOffset = (bd: BoardDoc, id: string): void =>
  setFields(bd, id, { layout: 'auto', mx: 0, my: 0 }, localOrigin)

/** Reparent and/or reorder. side applies when the new parent is a root with dir 'both'. */
export function moveNode(
  bd: BoardDoc,
  id: string,
  newParentId: string | null,
  pos?: InsertPosition,
  side?: Side | null,
  origin: Origin = localOrigin,
): void {
  const m = bd.nodes.get(id)
  if (!m) return
  bd.doc.transact(() => {
    const order = orderForInsert(bd, newParentId, pos)
    m.set('parentId', newParentId)
    m.set('order', order)
    if (side !== undefined) m.set('side', side)
    // leaving manual mode on reparent keeps drops predictable
    if (m.get('layout') === 'manual' && newParentId !== null) {
      m.set('layout', 'auto')
      m.set('mx', 0)
      m.set('my', 0)
    }
  }, origin)
}

// ----------------------------------------------------------------- deleting

/** Delete a node and its entire subtree plus links touching any deleted node. */
export function deleteSubtree(bd: BoardDoc, id: string, origin: Origin = localOrigin): void {
  if (!bd.nodes.has(id)) return
  bd.doc.transact(() => {
    const doomed = new Set([id, ...descendantIds(bd, id)])
    // links first (indexes shift as we delete)
    for (let i = bd.links.length - 1; i >= 0; i--) {
      const link = bd.links.get(i)
      if (doomed.has(link.get('fromId') as string) || doomed.has(link.get('toId') as string)) {
        bd.links.delete(i, 1)
      }
    }
    for (const nid of doomed) bd.nodes.delete(nid)
  }, origin)
}

// -------------------------------------------------------------------- links

export function createLink(
  bd: BoardDoc,
  fromId: string,
  toId: string,
  opts: { label?: string; style?: LinkStyle; arrow?: ArrowStyle } = {},
  origin: Origin = localOrigin,
): string {
  const id = nanoid(12)
  bd.doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('id', id)
    m.set('fromId', fromId)
    m.set('toId', toId)
    m.set('label', opts.label ?? '')
    m.set('style', opts.style ?? 'solid')
    m.set('arrow', opts.arrow ?? 'end')
    bd.links.push([m])
  }, origin)
  return id
}

export function updateLink(
  bd: BoardDoc,
  linkId: string,
  fields: { label?: string; style?: LinkStyle; arrow?: ArrowStyle },
): void {
  bd.doc.transact(() => {
    for (let i = 0; i < bd.links.length; i++) {
      const m = bd.links.get(i)
      if (m.get('id') === linkId) {
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined && m.get(k) !== v) m.set(k, v)
        }
        return
      }
    }
  }, localOrigin)
}

export function deleteLink(bd: BoardDoc, linkId: string): void {
  bd.doc.transact(() => {
    for (let i = 0; i < bd.links.length; i++) {
      if (bd.links.get(i).get('id') === linkId) {
        bd.links.delete(i, 1)
        return
      }
    }
  }, localOrigin)
}

// --------------------------------------------------------------------- meta

/**
 * Per-board layout spacing (SPEC §6), stored as flat meta fields so each
 * token merges independently. Absent fields read as the defaults.
 */
const SPACING_KEYS = {
  levelGap: 'spacingLevelGap',
  siblingGap: 'spacingSiblingGap',
  branchGap: 'spacingBranchGap',
  compactness: 'spacingCompactness',
} as const

export function getSpacing(bd: BoardDoc): SpacingTokens {
  const out = { ...DEFAULT_SPACING }
  for (const token of Object.keys(SPACING_KEYS) as (keyof SpacingTokens)[]) {
    const v = bd.meta.get(SPACING_KEYS[token])
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = SPACING_RANGES[token]
      out[token] = clamp(v, lo, hi)
    }
  }
  return out
}

/** Pass origin=ephemeralOrigin for live slider writes; commit with localOrigin. */
export function setSpacing(
  bd: BoardDoc,
  tokens: Partial<SpacingTokens>,
  origin: Origin = localOrigin,
): void {
  bd.doc.transact(() => {
    for (const token of Object.keys(SPACING_KEYS) as (keyof SpacingTokens)[]) {
      const v = tokens[token]
      if (v === undefined) continue
      const [lo, hi] = SPACING_RANGES[token]
      const next = clamp(v, lo, hi)
      if (bd.meta.get(SPACING_KEYS[token]) !== next) bd.meta.set(SPACING_KEYS[token], next)
    }
  }, origin)
}

export function setBoardName(bd: BoardDoc, name: string): void {
  bd.doc.transact(() => {
    bd.meta.set('name', name)
  }, localOrigin)
}

export function initMeta(bd: BoardDoc, name: string): void {
  bd.doc.transact(() => {
    if (!bd.meta.has('schemaVersion')) {
      bd.meta.set('schemaVersion', SCHEMA_VERSION)
      bd.meta.set('name', name)
      bd.meta.set('createdAt', Date.now())
    }
  }, seedOrigin)
}
