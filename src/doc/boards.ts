import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { nanoid } from 'nanoid'
import type { Camera } from '../engine/camera'

/**
 * Multi-board persistence (SPEC §11 board home + M6). Each board is one Y.Doc
 * persisted in its own IndexedDB database via y-indexeddb; a small registry
 * (id, name, updatedAt, thumbnail) lives in localStorage so the home screen
 * renders without opening any docs. Cameras are per-board in localStorage too.
 */

export interface BoardMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** tiny JPEG data-URL for the home grid (regenerated on board close) */
  thumbnail?: string
}

const REGISTRY_KEY = 'nodeflow-boards'
const VIEWPORT_PREFIX = 'nodeflow-viewport-'
const dbName = (id: string): string => `nodeflow-board-${id}`

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota/private mode: persistence is best-effort
  }
}

// ----------------------------------------------------------------- registry

export function listBoards(): BoardMeta[] {
  const all = read<BoardMeta[]>(REGISTRY_KEY) ?? []
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getBoardMeta(id: string): BoardMeta | null {
  return listBoards().find((b) => b.id === id) ?? null
}

export function upsertBoardMeta(id: string, patch: Partial<Omit<BoardMeta, 'id'>>): void {
  const all = read<BoardMeta[]>(REGISTRY_KEY) ?? []
  const i = all.findIndex((b) => b.id === id)
  if (i >= 0) all[i] = { ...all[i], ...patch }
  else {
    all.push({
      id,
      name: patch.name ?? 'Untitled',
      createdAt: patch.createdAt ?? Date.now(),
      updatedAt: patch.updatedAt ?? Date.now(),
      thumbnail: patch.thumbnail,
    })
  }
  write(REGISTRY_KEY, all)
}

export function createBoardEntry(name = 'Untitled'): BoardMeta {
  const meta: BoardMeta = { id: nanoid(10), name, createdAt: Date.now(), updatedAt: Date.now() }
  upsertBoardMeta(meta.id, meta)
  return meta
}

/** Remove the registry entry, the IndexedDB database and the saved viewport. */
export async function deleteBoard(id: string): Promise<void> {
  const all = (read<BoardMeta[]>(REGISTRY_KEY) ?? []).filter((b) => b.id !== id)
  write(REGISTRY_KEY, all)
  try {
    localStorage.removeItem(VIEWPORT_PREFIX + id)
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(id))
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

// ------------------------------------------------------------------ seeding

export type SeedKind = 'demo' | 'starter'
const pendingSeeds = new Map<string, SeedKind>()

/** Mark a just-created board for seeding when it is first opened. */
export function markSeed(id: string, kind: SeedKind): void {
  pendingSeeds.set(id, kind)
}

export function takeSeed(id: string): SeedKind | null {
  const kind = pendingSeeds.get(id) ?? null
  pendingSeeds.delete(id)
  return kind
}

// -------------------------------------------------------------- open / copy

export interface OpenBoard {
  doc: Y.Doc
  provider: IndexeddbPersistence
}

/** Open a board's doc and wait until IndexedDB state has been loaded into it. */
export async function openPersistentBoard(id: string): Promise<OpenBoard> {
  const doc = new Y.Doc()
  const provider = new IndexeddbPersistence(dbName(id), doc)
  await provider.whenSynced
  return { doc, provider }
}

/** Rename in the registry AND inside the (closed) doc so the two never fight. */
export async function renameClosedBoard(id: string, name: string): Promise<void> {
  upsertBoardMeta(id, { name, updatedAt: Date.now() })
  const { doc, provider } = await openPersistentBoard(id)
  doc.getMap('meta').set('name', name)
  await new Promise((r) => setTimeout(r, 80))
  provider.destroy()
  doc.destroy()
}

/** Duplicate a board's full document into a new registry entry. */
export async function duplicateBoard(srcId: string): Promise<BoardMeta | null> {
  const src = getBoardMeta(srcId)
  if (!src) return null
  const copyMeta = createBoardEntry(`${src.name} copy`)
  const a = await openPersistentBoard(srcId)
  const b = await openPersistentBoard(copyMeta.id)
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
  b.doc.getMap('meta').set('name', copyMeta.name)
  // y-indexeddb stores update events asynchronously; give the transaction a beat
  await new Promise((r) => setTimeout(r, 80))
  a.provider.destroy()
  b.provider.destroy()
  a.doc.destroy()
  b.doc.destroy()
  upsertBoardMeta(copyMeta.id, { thumbnail: src.thumbnail, updatedAt: Date.now() })
  return copyMeta
}

// ---------------------------------------------------------------- viewport

export function saveViewport(id: string, camera: Camera): void {
  write(VIEWPORT_PREFIX + id, camera)
}

export function loadViewport(id: string): Camera | null {
  const v = read<Camera>(VIEWPORT_PREFIX + id)
  if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.zoom !== 'number') {
    return null
  }
  return v
}
