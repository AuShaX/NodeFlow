import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { engineRef } from '../engine'
import { setSearchOpen, useUI } from '../state/store'
import { fuzzyMatch } from './fuzzy'
import { useMirrorVersion } from './hooks'

/**
 * Cmd/Ctrl+F search palette (SPEC §11): fuzzy match over node text — including
 * inside collapsed subtrees — ↑/↓ to move, Enter to jump (and cycle on
 * repeat), Esc to close. Jumps center the camera and pulse the node.
 */
export function SearchPalette() {
  const open = useUI((s) => s.searchOpen)

  // Global shortcut: capture-phase so the canvas/browser find never sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        e.stopPropagation()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!open) return null
  return <SearchPanel />
}

interface Result {
  id: string
  text: string
  crumb: string
  matched: ReadonlySet<number>
}

function SearchPanel() {
  useMirrorVersion()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const engine = engineRef.current

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo<Result[]>(() => {
    if (!engine || query.trim() === '') return []
    const mirror = engine.board.mirror
    const q = query.trim().toLowerCase()
    const scored: { score: number; r: Result }[] = []
    for (const n of mirror.nodes.values()) {
      const hit = fuzzyMatch(n.text, q)
      if (!hit) continue
      scored.push({
        score: hit.score,
        r: { id: n.id, text: n.text, crumb: crumbFor(mirror, n.id), matched: hit.indices },
      })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 12).map((s) => s.r)
  }, [engine, query])

  // Clamp the cursor when the result set shrinks.
  const cursor = Math.min(active, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results])

  if (!engine) return null

  const jump = (index: number): void => {
    const r = results[index]
    if (r) engine.machine.focusNode(r.id)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(results.length === 0 ? 0 : (cursor + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(results.length === 0 ? 0 : (cursor - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length === 0) return
      jump(cursor)
      // repeat-Enter cycles through matches
      setActive((cursor + 1) % results.length)
    }
  }

  return (
    <div className="search-palette" data-chrome role="dialog" aria-label="Search the board">
      <div className="search-box">
        <Search size={15} className="search-icon" aria-hidden />
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search this board…"
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            // closing on true outside-clicks; row clicks preventDefault to keep focus
            if (!e.relatedTarget) setSearchOpen(false)
          }}
        />
        {results.length > 0 && (
          <span className="search-count">
            {cursor + 1}/{results.length}
          </span>
        )}
      </div>
      {query.trim() !== '' && (
        <div className="search-results" ref={listRef} role="listbox" aria-label="Matches">
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === cursor}
              data-active={i === cursor || undefined}
              className="search-row"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                setActive(i)
                jump(i)
              }}
              onPointerEnter={() => setActive(i)}
            >
              <span className="search-row-text">{highlight(r.text, r.matched)}</span>
              {r.crumb && <span className="search-row-crumb">{r.crumb}</span>}
            </button>
          ))}
          {results.length === 0 && <div className="search-empty">No matches</div>}
        </div>
      )}
      <div className="search-hints" aria-hidden>
        <span>↑↓ navigate</span>
        <span>↵ jump</span>
        <span>esc close</span>
      </div>
    </div>
  )
}

function crumbFor(
  mirror: { nodes: ReadonlyMap<string, { parentId: string | null; text: string }> },
  id: string,
): string {
  const parts: string[] = []
  let cur = mirror.nodes.get(id)
  let guard = 0
  while (cur && cur.parentId !== null && guard++ < 32) {
    const parent = mirror.nodes.get(cur.parentId)
    if (!parent) break
    parts.unshift(truncate(parent.text || 'Untitled', 18))
    cur = parent
  }
  return parts.join(' › ')
}

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function highlight(text: string, matched: ReadonlySet<number>): React.ReactNode {
  const shown = truncate(text.replace(/\s+/g, ' '), 60)
  if (matched.size === 0) return shown
  const out: React.ReactNode[] = []
  let run = ''
  let inMatch = false
  const flush = (): void => {
    if (run === '') return
    out.push(inMatch ? <mark key={out.length}>{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < shown.length; i++) {
    const m = matched.has(i)
    if (m !== inMatch) {
      flush()
      inMatch = m
    }
    run += shown[i]
  }
  flush()
  return out
}
