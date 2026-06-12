import * as Y from 'yjs'
import type { Animator } from '../engine/animator'
import type { BoardDoc } from './schema'
import { createNode, initMeta, openBoardDoc, seedOrigin } from './schema'
import { Mirror } from './mirror'
import type { UndoApi } from './undo'
import { createUndo } from './undo'
import type { DemoNode } from './demoTree'
import { demoCrossLinks, demoRoot } from './demoTree'
import { createLink } from './schema'

/** A live board: Yjs doc + mirror + undo, wired together. */
export interface Board {
  bd: BoardDoc
  mirror: Mirror
  undo: UndoApi
  destroy(): void
}

export function createBoard(
  animator: Animator,
  onUpdate: () => void,
  doc: Y.Doc = new Y.Doc(),
): Board {
  const bd = openBoardDoc(doc)
  const undo = createUndo(bd)
  const mirror = new Mirror(bd, animator, onUpdate)
  return {
    bd,
    mirror,
    undo,
    destroy() {
      mirror.destroy()
      undo.destroy()
    },
  }
}

/**
 * Perf-audit seed (SPEC §13): a balanced ~n-node tree with realistic text
 * variety. Deterministic (mulberry32) so runs are comparable. Not undoable.
 */
export function seedPerfBoard(bd: BoardDoc, n = 1000): void {
  let s = 0x9e3779b9
  const rand = (): number => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const words = [
    'launch', 'pricing', 'retention', 'pipeline', 'audit', 'onboarding', 'metrics',
    'rollout', 'design', 'backlog', 'review', 'capacity', 'experiment', 'funnel',
    'infra', 'roadmap', 'discovery', 'positioning', 'enablement', 'automation',
  ]
  const phrase = (): string => {
    const len = 1 + Math.floor(rand() * 4)
    const parts: string[] = []
    for (let i = 0; i < len; i++) parts.push(words[Math.floor(rand() * words.length)])
    const t = parts.join(' ')
    return t[0].toUpperCase() + t.slice(1)
  }
  bd.doc.transact(() => {
    initMeta(bd, `Perf ${n}`)
    const root = createNode(bd, null, { text: `Perf audit — ${n} nodes` }, undefined, seedOrigin)
    let made = 1
    const queue: string[] = []
    const branches = 8
    for (let i = 0; i < branches && made < n; i++) {
      const id = createNode(
        bd,
        root,
        { text: phrase(), side: i % 2 === 0 ? 'right' : 'left' },
        undefined,
        seedOrigin,
      )
      made++
      queue.push(id)
    }
    while (made < n && queue.length > 0) {
      const parent = queue.shift()!
      const kids = 2 + Math.floor(rand() * 4)
      for (let i = 0; i < kids && made < n; i++) {
        const id = createNode(bd, parent, { text: phrase() }, undefined, seedOrigin)
        made++
        queue.push(id)
      }
    }
  }, seedOrigin)
}

/** Seed the demo map (SPEC §3) into an empty board. Not undoable. */
export function createDemoBoard(bd: BoardDoc): void {
  if (bd.nodes.size > 0) return
  initMeta(bd, 'Product Launch')
  bd.doc.transact(() => {
    const addTree = (
      spec: DemoNode,
      parentId: string | null,
      keyed: Map<string, string>,
    ): string => {
      const id = createNode(
        bd,
        parentId,
        { text: spec.text, collapsed: spec.collapsed ?? false, side: spec.side ?? null },
        undefined,
        seedOrigin,
      )
      if (spec.key) keyed.set(spec.key, id)
      for (const child of spec.children ?? []) addTree(child, id, keyed)
      return id
    }
    const keyed = new Map<string, string>()
    addTree(demoRoot, null, keyed)
    for (const link of demoCrossLinks) {
      const from = keyed.get(link.fromKey)
      const to = keyed.get(link.toKey)
      if (from && to) {
        createLink(bd, from, to, { label: link.label, style: link.style }, seedOrigin)
      }
    }
  }, seedOrigin)
}
