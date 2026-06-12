import { useEffect, useRef, useState } from 'react'
import { FileUp, X } from 'lucide-react'
import { importBoardFromText } from '../doc/io'
import { pickFile } from './files'
import { IconButton } from './kit'

/**
 * Import a board from Markdown / OPML / Nodeflow JSON (SPEC §11): pick a file
 * or paste an outline, format is auto-detected, a new board is created and
 * opened. Failures clean up after themselves and report inline.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chooseFile = async (): Promise<void> => {
    const file = await pickFile('.md,.markdown,.txt,.opml,.xml,.json')
    if (!file) return
    setFilename(file.name)
    setText(file.text)
    setError(null)
  }

  const runImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await importBoardFromText(text, filename)
    setBusy(false)
    if (!result.ok || !result.meta) {
      setError(result.error ?? 'Import failed.')
      return
    }
    onClose()
    location.hash = `#/board/${result.meta.id}`
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Import a board">
        <header className="dialog-head">
          <h2>Import a board</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <p className="dialog-hint">
          Markdown outline, OPML, or a Nodeflow JSON export — pick a file or paste below.
        </p>
        <button type="button" className="text-btn dialog-file-btn" onClick={() => void chooseFile()}>
          <FileUp size={14} />
          {filename ?? 'Choose a file…'}
        </button>
        <textarea
          ref={textareaRef}
          className="dialog-textarea"
          placeholder={'- Topic\n  - Subtopic\n  - Another idea'}
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setFilename(null)
            setError(null)
          }}
        />
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-foot">
          <button type="button" className="text-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy || text.trim() === ''}
            onClick={() => void runImport()}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  )
}
