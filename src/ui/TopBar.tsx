import { useRef, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Moon, Redo2, Search, Share2, Sun, Undo2 } from 'lucide-react'
import { engineRef } from '../engine'
import { localUser, presence, syncEnabled } from '../state/presence'
import { setSearchOpen, setThemeMode, useUI } from '../state/store'
import { ExportMenu } from './ExportMenu'
import { useForwardWheel, useMirrorVersion } from './hooks'
import { Divider, IconButton, Popover } from './kit'
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
        <PresenceStack />
        <ShareButton />
      </div>
    </header>
  )
}

/** Connected collaborators as colored initials (low-frequency re-render). */
function PresenceStack() {
  useSyncExternalStore(
    (fn) => presence.subscribe(fn),
    () => presence.version,
  )
  const syncStatus = useUI((s) => s.syncStatus)
  if (syncStatus === 'local') return null
  const peers = [...presence.peers.values()]
  return (
    <span className="presence-stack" aria-label={`${peers.length + 1} people on this board`}>
      <span
        className={'sync-dot' + (syncStatus === 'online' ? ' is-online' : '')}
        title={syncStatus === 'online' ? 'Connected' : 'Connecting…'}
      />
      {peers.slice(0, 5).map((p) => (
        <span
          key={p.clientId}
          className="presence-avatar"
          style={{ background: p.user.color }}
          title={p.user.name}
        >
          {initials(p.user.name)}
        </span>
      ))}
      {peers.length > 5 && <span className="presence-more">+{peers.length - 5}</span>}
    </span>
  )
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()

function ShareButton() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const syncStatus = useUI((s) => s.syncStatus)
  const engine = engineRef.current
  const enabled = syncEnabled()

  const copyLink = (): void => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <span className="popover-host">
      <button
        type="button"
        className="share-btn"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        <Share2 size={13} /> Share
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="popover-down share-pop" label="Share">
        {enabled ? (
          <>
            <p className="share-pop-status">
              {syncStatus === 'online'
                ? 'Live collaboration is on — anyone with the link joins this board.'
                : 'Connecting to the sync server…'}
            </p>
            <button type="button" className="text-btn" onClick={copyLink}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy board link'}
            </button>
            {engine && (
              <p className="share-pop-hint">
                You appear as “{localUser(engine.board.bd.doc.clientID).name}”.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="share-pop-status">Live collaboration is off.</p>
            <p className="share-pop-hint">
              Start the relay with <code>npm run sync-server</code>, then set
              <code> VITE_SYNC_URL=ws://localhost:1234</code> (or the
              <code> nodeflow-sync-url</code> localStorage key) and reload.
            </p>
            <button type="button" className="text-btn" onClick={copyLink}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy board link anyway'}
            </button>
          </>
        )}
      </Popover>
    </span>
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
