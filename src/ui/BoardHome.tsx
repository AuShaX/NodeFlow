import { useEffect, useState } from 'react'
import { Copy, FileUp, Moon, Plus, Sun, Trash2 } from 'lucide-react'
import type { BoardMeta } from '../doc/boards'
import {
  createBoardEntry,
  deleteBoard,
  duplicateBoard,
  listBoards,
  markSeed,
  renameClosedBoard,
} from '../doc/boards'
import { setThemeMode, useUI } from '../state/store'
import { ImportDialog } from './ImportDialog'
import { IconButton } from './kit'

/**
 * Board home (SPEC §11): grid of boards with thumbnails, create / rename /
 * duplicate / delete, routed at #/. The very first visit seeds the demo board
 * and jumps straight into it so the product opens on content, not a blank grid.
 */
export function BoardHome() {
  const [boards, setBoards] = useState<BoardMeta[]>(listBoards)
  const [importing, setImporting] = useState(false)
  const themeMode = useUI((s) => s.themeMode)
  const refresh = (): void => setBoards(listBoards())

  useEffect(() => {
    if (listBoards().length === 0) {
      const meta = createBoardEntry('Product Launch')
      markSeed(meta.id, 'demo')
      location.hash = `#/board/${meta.id}`
    }
  }, [])

  const createBoard = (): void => {
    const meta = createBoardEntry('Untitled')
    markSeed(meta.id, 'starter')
    location.hash = `#/board/${meta.id}`
  }

  return (
    <div className="home" data-chrome>
      <header className="home-head">
        <span className="wordmark">
          <span className="wordmark-dot" />
          Nodeflow
        </span>
        <div className="home-head-actions">
          <IconButton
            label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
          >
            {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
          <button type="button" className="text-btn" onClick={() => setImporting(true)}>
            <FileUp size={14} /> Import
          </button>
          <button type="button" className="primary-btn" onClick={createBoard}>
            <Plus size={14} /> New board
          </button>
        </div>
      </header>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}

      <main className="home-grid" aria-label="Your boards">
        {boards.map((b) => (
          <BoardCard key={b.id} board={b} onChange={refresh} />
        ))}
        {boards.length === 0 && (
          <button type="button" className="board-card board-card-new" onClick={createBoard}>
            <Plus size={20} />
            <span>Create your first board</span>
          </button>
        )}
      </main>
    </div>
  )
}

function BoardCard({ board, onChange }: { board: BoardMeta; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(t)
  }, [confirming])

  const open = (): void => {
    location.hash = `#/board/${board.id}`
  }

  return (
    <div className={'board-card' + (busy ? ' is-busy' : '')}>
      <button type="button" className="board-thumb" onClick={open} aria-label={`Open ${board.name}`}>
        {board.thumbnail ? (
          <img src={board.thumbnail} alt="" draggable={false} />
        ) : (
          <span className="board-thumb-empty" aria-hidden>
            <span className="wordmark-dot" />
          </span>
        )}
      </button>
      <div className="board-card-foot">
        <div className="board-card-info">
          <input
            className="board-card-name"
            defaultValue={board.name}
            aria-label="Board name"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                ;(e.target as HTMLInputElement).value = board.name
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next === '') e.target.value = board.name
              else if (next !== board.name) {
                void renameClosedBoard(board.id, next).then(onChange)
                onChange()
              }
            }}
          />
          <span className="board-card-date">{relativeTime(board.updatedAt)}</span>
        </div>
        <div className="board-card-actions">
          <IconButton
            label="Duplicate board"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void duplicateBoard(board.id).then(() => {
                setBusy(false)
                onChange()
              })
            }}
          >
            <Copy size={14} />
          </IconButton>
          <IconButton
            label={confirming ? 'Click again to delete' : 'Delete board'}
            danger
            active={confirming}
            disabled={busy}
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              setBusy(true)
              void deleteBoard(board.id).then(onChange)
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

function relativeTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}
