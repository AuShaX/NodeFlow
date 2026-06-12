import type { Point } from '../types'

/**
 * Collaboration presence (Stage 2). Awareness states mirror into a plain
 * mutable store the renderer reads every frame (cursors move at pointer
 * rate — React must not re-render for them). React chrome subscribes to a
 * version that bumps only on membership/identity changes.
 */

export interface PresenceUser {
  name: string
  color: string
}

export interface PeerState {
  clientId: number
  user: PresenceUser
  /** world-space cursor, null when the pointer left the canvas */
  cursor: Point | null
  selection: string[]
  /** node currently being text-edited by this peer */
  editing: string | null
}

/** Raw shape written into awareness.setLocalState by each client. */
export interface AwarenessShape {
  user?: PresenceUser
  cursor?: Point | null
  selection?: string[]
  editing?: string | null
}

const PRESENCE_PALETTE = [
  '#0D9488',
  '#E07A3F',
  '#5B7FD4',
  '#C2528B',
  '#6BA34F',
  '#8A63C9',
  '#D4A013',
  '#C75450',
] as const

const ADJECTIVES = ['Brisk', 'Calm', 'Clever', 'Daring', 'Gentle', 'Keen', 'Lively', 'Quiet', 'Swift', 'Witty']
const ANIMALS = ['Fox', 'Heron', 'Lynx', 'Marten', 'Otter', 'Owl', 'Swift', 'Tern', 'Vole', 'Wren']

const NAME_KEY = 'nodeflow-presence-name'

/** Stable anonymous identity: persisted name, color derived from clientId. */
export function localUser(clientId: number): PresenceUser {
  let name: string | null = null
  try {
    name = localStorage.getItem(NAME_KEY)
  } catch {
    // storage unavailable
  }
  if (!name) {
    name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`
    try {
      localStorage.setItem(NAME_KEY, name)
    } catch {
      // fine, session-only name
    }
  }
  return { name, color: colorForClient(clientId) }
}

export const colorForClient = (clientId: number): string =>
  PRESENCE_PALETTE[Math.abs(clientId) % PRESENCE_PALETTE.length]

export class PresenceStore {
  /** remote peers only (never the local client) */
  peers = new Map<number, PeerState>()
  /** nodeId → peer color, for remote selection outlines (last writer wins) */
  selectedBy = new Map<string, string>()
  /** nodeId → peer, for remote editing indicators */
  editingBy = new Map<string, PeerState>()
  /** bumped on join/leave/identity change — chrome (avatar stack) re-renders */
  version = 0

  /** canvas repaint hook (set by the board wiring) */
  onRepaint: (() => void) | null = null

  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Rebuild from the full awareness state map. */
  apply(states: Map<number, AwarenessShape | null>, selfId: number): void {
    const prevIds = [...this.peers.keys()].sort().join(',')
    const prevNames = [...this.peers.values()].map((p) => p.user.name + p.user.color).join('|')
    this.peers.clear()
    this.selectedBy.clear()
    this.editingBy.clear()
    for (const [clientId, raw] of states) {
      if (clientId === selfId || !raw || !raw.user) continue
      const peer: PeerState = {
        clientId,
        user: raw.user,
        cursor: raw.cursor ?? null,
        selection: Array.isArray(raw.selection) ? raw.selection : [],
        editing: raw.editing ?? null,
      }
      this.peers.set(clientId, peer)
      for (const id of peer.selection) this.selectedBy.set(id, peer.user.color)
      if (peer.editing) this.editingBy.set(peer.editing, peer)
    }
    const nextIds = [...this.peers.keys()].sort().join(',')
    const nextNames = [...this.peers.values()].map((p) => p.user.name + p.user.color).join('|')
    if (prevIds !== nextIds || prevNames !== nextNames) {
      this.version++
      for (const fn of this.listeners) fn()
    }
    this.onRepaint?.()
  }

  clear(): void {
    if (this.peers.size === 0 && this.selectedBy.size === 0) return
    this.peers.clear()
    this.selectedBy.clear()
    this.editingBy.clear()
    this.version++
    for (const fn of this.listeners) fn()
    this.onRepaint?.()
  }
}

/** Singleton — one board open at a time; cleared on board switch. */
export const presence = new PresenceStore()

// ------------------------------------------------------------ sync config

const SYNC_URL_KEY = 'nodeflow-sync-url'

/**
 * Sync server URL: localStorage override, then build-time env. Local-first —
 * with neither set the app never opens a socket.
 */
export function syncUrl(): string | null {
  try {
    const stored = localStorage.getItem(SYNC_URL_KEY)
    if (stored) return stored
  } catch {
    // storage unavailable
  }
  const env = (import.meta.env.VITE_SYNC_URL as string | undefined) ?? null
  return env || null
}

export const syncEnabled = (): boolean => syncUrl() !== null
