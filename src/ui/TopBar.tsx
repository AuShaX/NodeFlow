import { useRef, useState } from 'react'
import { Moon, Redo2, Search, Share2, Sun, Undo2 } from 'lucide-react'
import { engineRef } from '../engine'
import { setSearchOpen, setThemeMode, useUI } from '../state/store'
import { ExportMenu } from './ExportMenu'
import { useForwardWheel, useMirrorVersion } from './hooks'
import { Divider, IconButton } from './kit'
import { clamp } from '../types'

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

/**
 * Slim top bar (SPEC §12): board name + autosave state, undo/redo, theme
 * toggle, search, export menu. Share stays a disabled placeholder until
 * Stage-2 collaboration.
 */
export function TopBar() {
  useMirrorVersion()
  const themeMode = useUI((s) => s.themeMode)
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
        <button
          type="button"
          className="wordmark wordmark-link"
          aria-label="All boards"
          title="All boards"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => (location.hash = '#/')}
        >
          <span className="wordmark-dot" />
          Nodeflow
        </button>
        <Divider />
        <BoardNameInput key={name} name={name} onRename={(n) => engine.actions.renameBoard(n)} />
        <SaveIndicator />
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
        <IconButton
          label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
        >
          {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <Divider />
        <IconButton label={`Search (${mod}F)`} onClick={() => setSearchOpen(true)}>
          <Search size={15} />
        </IconButton>
        <ExportMenu engine={engine} />
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

/** "Saved / Saving…" autosave status (local IndexedDB persistence). */
function SaveIndicator() {
  const saveState = useUI((s) => s.saveState)
  return (
    <span className={'save-indicator' + (saveState === 'saving' ? ' is-saving' : '')} aria-live="polite">
      {saveState === 'saving' ? 'Saving…' : 'Saved'}
    </span>
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
