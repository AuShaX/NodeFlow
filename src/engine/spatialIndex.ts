import type { Rect } from '../types'

const CELL = 256 // world units per grid cell

interface Entry {
  minCx: number
  minCy: number
  maxCx: number
  maxCy: number
}

/**
 * Uniform-grid spatial index used for viewport culling and hit-test
 * candidate queries. Cheap to update; rebuilding an entry is O(cells covered).
 */
export class SpatialIndex {
  private cells = new Map<string, Set<string>>()
  private entries = new Map<string, Entry>()

  insert(id: string, rect: Rect): void {
    const e: Entry = {
      minCx: Math.floor(rect.x / CELL),
      minCy: Math.floor(rect.y / CELL),
      maxCx: Math.floor((rect.x + rect.w) / CELL),
      maxCy: Math.floor((rect.y + rect.h) / CELL),
    }
    const prev = this.entries.get(id)
    if (
      prev &&
      prev.minCx === e.minCx &&
      prev.minCy === e.minCy &&
      prev.maxCx === e.maxCx &&
      prev.maxCy === e.maxCy
    ) {
      return // same cells, nothing to do
    }
    if (prev) this.removeFromCells(id, prev)
    this.entries.set(id, e)
    for (let cx = e.minCx; cx <= e.maxCx; cx++) {
      for (let cy = e.minCy; cy <= e.maxCy; cy++) {
        const key = cx + ',' + cy
        let set = this.cells.get(key)
        if (!set) {
          set = new Set()
          this.cells.set(key, set)
        }
        set.add(id)
      }
    }
  }

  update(id: string, rect: Rect): void {
    this.insert(id, rect)
  }

  remove(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.removeFromCells(id, e)
    this.entries.delete(id)
  }

  clear(): void {
    this.cells.clear()
    this.entries.clear()
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  /** Ids of all entries whose rect MAY intersect `rect` (cell-level test). */
  queryRect(rect: Rect): Set<string> {
    const out = new Set<string>()
    const minCx = Math.floor(rect.x / CELL)
    const minCy = Math.floor(rect.y / CELL)
    const maxCx = Math.floor((rect.x + rect.w) / CELL)
    const maxCy = Math.floor((rect.y + rect.h) / CELL)
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const set = this.cells.get(cx + ',' + cy)
        if (set) for (const id of set) out.add(id)
      }
    }
    return out
  }

  private removeFromCells(id: string, e: Entry): void {
    for (let cx = e.minCx; cx <= e.maxCx; cx++) {
      for (let cy = e.minCy; cy <= e.maxCy; cy++) {
        const key = cx + ',' + cy
        const set = this.cells.get(key)
        if (set) {
          set.delete(id)
          if (set.size === 0) this.cells.delete(key)
        }
      }
    }
  }
}
