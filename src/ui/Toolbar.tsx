import { useRef, useState } from 'react'
import {
  CirclePlus,
  Maximize2,
  MousePointer2,
  SlidersHorizontal,
  Spline,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { engineRef } from '../engine'
import { setStylePanelOpen, setTool, useUI } from '../state/store'
import { useForwardWheel, useMirrorVersion } from './hooks'
import { Divider, IconButton, Popover } from './kit'
import { SpacingQuick } from './SpacingQuick'

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

/**
 * Floating bottom-center pill (SPEC §12): tools, quick spacing, zoom with a
 * % readout. Tools are one-shot: they apply on the next canvas press and
 * revert to select (Esc cancels).
 */
export function Toolbar() {
  const tool = useUI((s) => s.tool)
  const zoomPct = useUI((s) => Math.round(s.camera.zoom * 100))
  const [spacingOpen, setSpacingOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useForwardWheel(ref)
  useMirrorVersion() // spacing slider lives here too

  const engine = engineRef.current
  if (!engine) return null
  const machine = engine.machine

  return (
    <div ref={ref} className="toolbar" data-chrome role="toolbar" aria-label="Tools">
      <IconButton label="Select" active={tool === 'select'} onClick={() => setTool('select')}>
        <MousePointer2 size={16} />
      </IconButton>
      <IconButton
        label="Add topic (double-click canvas)"
        active={tool === 'addRoot'}
        onClick={() => setTool(tool === 'addRoot' ? 'select' : 'addRoot')}
      >
        <CirclePlus size={16} />
      </IconButton>
      <IconButton
        label="Link nodes (drag between nodes)"
        active={tool === 'link'}
        onClick={() => setTool(tool === 'link' ? 'select' : 'link')}
      >
        <Spline size={16} />
      </IconButton>

      <Divider />

      <span className="popover-host">
        <IconButton
          label="Spacing"
          active={spacingOpen}
          onClick={() => setSpacingOpen(!spacingOpen)}
        >
          <SlidersHorizontal size={15} />
        </IconButton>
        <Popover
          open={spacingOpen}
          onClose={() => setSpacingOpen(false)}
          className="popover-up"
          label="Spacing"
        >
          <SpacingQuick
            engine={engine}
            onMore={() => {
              setSpacingOpen(false)
              setStylePanelOpen(true)
            }}
          />
        </Popover>
      </span>

      <Divider />

      <IconButton label="Zoom out" onClick={() => machine.zoomBy(1 / 1.25)}>
        <ZoomOut size={15} />
      </IconButton>
      <button
        type="button"
        className="zoom-readout"
        title={`Zoom to 100% (${mod}1)`}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => machine.zoomTo100()}
      >
        {zoomPct}%
      </button>
      <IconButton label="Zoom in" onClick={() => machine.zoomBy(1.25)}>
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label={`Fit map (${mod}0)`} onClick={() => machine.fitToContent()}>
        <Maximize2 size={15} />
      </IconButton>
    </div>
  )
}
