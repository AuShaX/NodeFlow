import { useRef, useState } from 'react'
import { Download, Redo2, Search, Share2, Undo2 } from 'lucide-react'
import { engineRef } from '../engine'
import { useForwardWheel, useMirrorVersion } from './hooks'
import { Divider, IconButton } from './kit'
import { clamp } from '../types'

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

/**
 * Slim top bar (SPEC §12): inline-editable board name, undo/redo, and the
 * search / export / share slots (search + export ship with M6 persistence,
 * share with Stage-2 collaboration — visible but disabled until then).
 */
export function TopBar() {
  useMirrorVersion()
  const ref = useRef<HTMLElement>(null)
  useForwardWheel(ref)
  const engine = engineRef.current
  if (!engine) return null

  const name = engine.board.mirror.boardName
  const canUndo = engine.board.undo.canUndo()
  const canRedo = engine.board.undo.canRedo()

  return (
    <header ref={ref} className="topbar" data-chrome>
      <div className="topbar-side">
        <span className="wordmark" aria-label="Nodeflow">
          <span className="wordmark-dot" />
          Nodeflow
        </span>
        <Divider />
        <BoardNameInput key={name} name={name} onRename={(n) => engine.actions.renameBoard(n)} />
      </div>
      <div className="topbar-side">
        <IconButton
          label={`Undo (${mod}Z)`}
          disabled={!canUndo}
          onClick={() => engine.actions.undo()}
        >
          <Undo2 size={15} />
        </IconButton>
        <IconButton
          label={`Redo (⇧${mod}Z)`}
          disabled={!canRedo}
          onClick={() => engine.actions.redo()}
        >
          <Redo2 size={15} />
        </IconButton>
        <Divider />
        <IconButton label="Search — coming with M6" disabled>
          <Search size={15} />
        </IconButton>
        <IconButton label="Export — coming with M6" disabled>
          <Download size={15} />
        </IconButton>
        <button
          type="button"
          className="share-btn"
          disabled
          title="Sharing arrives with collaboration"
        >
          <Share2 size={13} /> Share
        </button>
      </div>
    </header>
  )
}

/** Commit on blur/Enter; Esc reverts. Remounts (via key) when the doc name changes. */
function BoardNameInput({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [value, setValue] = useState(name)
  return (
    <input
      className="board-name"
      value={value}
      size={clamp(value.length + 2, 8, 40)}
      aria-label="Board name"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          setValue(name)
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
      onBlur={() => {
        const next = value.trim()
        if (next === '') setValue(name)
        else if (next !== name) onRename(next)
      }}
    />
  )
}
