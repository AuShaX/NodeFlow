import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Engine } from '../engine'
import { renderSceneToCanvas } from '../engine/exportImage'
import { exportSVG } from '../engine/exportSvg'
import { exportPDF } from '../engine/exportPdf'
import { exportCSV, exportJSON, exportMarkdown, exportOPML } from '../doc/io'
import {
  downloadBlob,
  downloadCanvasJpg,
  downloadCanvasPng,
  downloadText,
  fileSlug,
} from './files'
import { IconButton, Popover } from './kit'

/**
 * Export popover (SPEC §11 + Miro format parity): raster (PNG 2×, transparent
 * PNG, JPG), vector (SVG, PDF) and text (Markdown, OPML, CSV, JSON).
 * Everything renders from the live mirror — what you see is what exports.
 */
export function ExportMenu({ engine }: { engine: Engine }) {
  const [open, setOpen] = useState(false)

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  const mirror = engine.board.mirror
  const slug = (): string => fileSlug(mirror.boardName || 'board')
  const empty = mirror.rootIds.length === 0

  const png = (transparent: boolean): void => {
    const r = renderSceneToCanvas(mirror, transparent ? { background: null } : {})
    if (r) downloadCanvasPng(`${slug()}.png`, r.canvas)
  }
  const jpg = (): void => {
    const r = renderSceneToCanvas(mirror)
    if (r) downloadCanvasJpg(`${slug()}.jpg`, r.canvas)
  }
  const svg = (): void => {
    const s = exportSVG(mirror)
    if (s) downloadText(`${slug()}.svg`, 'image/svg+xml', s)
  }
  const pdf = (): void => {
    const blob = exportPDF(mirror)
    if (blob) downloadBlob(`${slug()}.pdf`, blob)
  }

  return (
    <span className="popover-host">
      <IconButton label="Export" active={open} onClick={() => setOpen(!open)}>
        <Download size={15} />
      </IconButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        className="popover-down export-menu"
        label="Export"
      >
        <MenuRow label="PNG (2×)" hint=".png" disabled={empty} onClick={run(() => png(false))} />
        <MenuRow
          label="PNG, transparent"
          hint=".png"
          disabled={empty}
          onClick={run(() => png(true))}
        />
        <MenuRow label="JPG" hint=".jpg" disabled={empty} onClick={run(jpg)} />
        <MenuRow label="SVG (vector)" hint=".svg" disabled={empty} onClick={run(svg)} />
        <MenuRow label="PDF" hint=".pdf" disabled={empty} onClick={run(pdf)} />
        <div className="menu-sep" role="separator" />
        <MenuRow
          label="Markdown outline"
          hint=".md"
          disabled={empty}
          onClick={run(() => downloadText(`${slug()}.md`, 'text/markdown', exportMarkdown(mirror)))}
        />
        <MenuRow
          label="OPML outline"
          hint=".opml"
          disabled={empty}
          onClick={run(() =>
            downloadText(`${slug()}.opml`, 'text/x-opml', exportOPML(mirror, mirror.boardName)),
          )}
        />
        <MenuRow
          label="CSV"
          hint=".csv"
          disabled={empty}
          onClick={run(() => downloadText(`${slug()}.csv`, 'text/csv', exportCSV(mirror)))}
        />
        <MenuRow
          label="Nodeflow JSON"
          hint=".json"
          onClick={run(() =>
            downloadText(
              `${slug()}.json`,
              'application/json',
              exportJSON(engine.board.bd, mirror),
            ),
          )}
        />
      </Popover>
    </span>
  )
}

function MenuRow(props: {
  label: string
  hint: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="menu-item"
      disabled={props.disabled}
      onPointerDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      <span className="menu-label">{props.label}</span>
      <span className="menu-kbd">{props.hint}</span>
    </button>
  )
}
