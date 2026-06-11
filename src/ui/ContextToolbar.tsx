import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  Bold,
  ChevronsDownUp,
  ChevronsUpDown,
  Magnet,
  PenLine,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react'
import type { Engine } from '../engine'
import { engineRef } from '../engine'
import { setStylePanelOpen, uiStore, useUI } from '../state/store'
import type { NodeView, Rect, Shape, TextSize } from '../types'
import { nodeRenderRect, rectUnion, clamp } from '../types'
import { crossLinkMidpoint } from '../engine/drawConnector'
import { useForwardWheel, useMirrorVersion } from './hooks'
import { ColorPalette, Divider, IconButton, Popover, Segmented } from './kit'
import {
  IconArrowBoth,
  IconArrowEnd,
  IconArrowNone,
  IconConnCurved,
  IconConnElbow,
  IconDirBoth,
  IconDirDown,
  IconDirRight,
  IconLineDashed,
  IconLineSolid,
  IconShapePill,
  IconShapeRect,
  IconShapeRounded,
} from './icons'

const TOPBAR_H = 48
const GAP = 14
const MARGIN = 8

/**
 * Floating toolbar above the selection (SPEC §11): color, shape, text style,
 * root layout controls, structure actions. Tracks the selection through
 * pan/zoom/reflow every frame, like the text editor overlay does.
 */
export function ContextToolbar() {
  const selection = useUI((s) => s.selection)
  const linkSelection = useUI((s) => s.linkSelection)
  const editing = useUI((s) => s.editing)
  const editingLinkId = useUI((s) => s.editingLinkId)
  const gesture = useUI((s) => s.gesture)
  useMirrorVersion()

  const engine = engineRef.current
  if (!engine) return null
  const midGesture =
    gesture === 'marquee' ||
    gesture === 'draggingNodes' ||
    gesture === 'draggingFreeMove' ||
    gesture === 'draggingLink'
  if (editing || editingLinkId || midGesture) return null

  if (linkSelection) {
    const link = engine.board.mirror.links.find((l) => l.id === linkSelection)
    if (!link) return null
    return <LinkToolbar key={linkSelection} engine={engine} linkId={linkSelection} />
  }

  const ids = [...selection].filter((id) => engine.board.mirror.nodes.get(id)?.visible)
  if (ids.length === 0) return null
  return <NodeToolbar key={ids.join(',')} engine={engine} ids={ids} />
}

// ------------------------------------------------------------------ node bar

type NodePopover = 'color' | 'shape' | 'text' | 'dir' | 'conn' | null

function NodeToolbar({ engine, ids }: { engine: Engine; ids: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pop, setPop] = useState<NodePopover>(null)
  useForwardWheel(ref)
  useTrackedPosition(ref, engine, () => {
    let b: Rect | null = null
    for (const id of ids) {
      const n = engine.board.mirror.nodes.get(id)
      if (!n || !n.visible) continue
      b = b ? rectUnion(b, nodeRenderRect(n)) : nodeRenderRect(n)
    }
    return b
  })

  const m = engine.board.mirror
  const nodes = ids
    .map((id) => m.nodes.get(id))
    .filter((n): n is NodeView => n !== undefined && n.visible)
  if (nodes.length === 0) return null
  const actions = engine.actions

  const shape = same(nodes.map((n) => n.shape))
  const size = same(nodes.map((n) => n.textStyle.size))
  const allBold = nodes.every((n) => n.textStyle.bold)
  const swatchColor = same(nodes.map((n) => n.effectiveColor))
  const ownColor = same(nodes.map((n) => n.color ?? null))

  const roots = nodes.filter((n) => n.parentId === null)
  const dir = roots.length > 0 ? same(roots.map((r) => r.dir ?? 'both')) : null
  const conn = roots.length > 0 ? same(roots.map((r) => r.connectorStyle ?? 'curved')) : null
  const autoLayoutOn = roots.length > 0 && roots.every((r) => actions.rootAutoLayoutOn(r.id))

  const withKids = nodes.filter((n) => n.childrenIds.length > 0)
  const allCollapsed = withKids.length > 0 && withKids.every((n) => n.collapsed)
  const canLayout = actions.hasManualInSubtrees(ids)

  const toggle = (p: NodePopover) => setPop((cur) => (cur === p ? null : p))
  const shapeIcon =
    shape === 'rounded' ? (
      <IconShapeRounded />
    ) : shape === 'rect' ? (
      <IconShapeRect />
    ) : (
      <IconShapePill />
    )

  return (
    <div ref={ref} className="ctx-toolbar" data-chrome role="toolbar" aria-label="Node style">
      <span className="popover-host">
        <IconButton label="Color" active={pop === 'color'} onClick={() => toggle('color')}>
          <span
            className={'swatch-preview' + (swatchColor === null ? ' is-mixed' : '')}
            style={swatchColor ? { background: swatchColor } : undefined}
          />
        </IconButton>
        <Popover open={pop === 'color'} onClose={() => setPop(null)} label="Node color">
          <ColorPalette
            current={swatchColor === null && ownColor === null ? null : (ownColor ?? swatchColor)}
            showAuto={nodes.some((n) => n.parentId !== null)}
            onPick={(c) => actions.setNodesColor(ids, c)}
          />
        </Popover>
      </span>

      <span className="popover-host">
        <IconButton label="Shape" active={pop === 'shape'} onClick={() => toggle('shape')}>
          {shapeIcon}
        </IconButton>
        <Popover open={pop === 'shape'} onClose={() => setPop(null)} label="Node shape">
          <Segmented<Shape>
            value={shape}
            onChange={(v) => actions.setNodesShape(ids, v)}
            options={[
              { value: 'pill', label: <IconShapePill />, title: 'Pill' },
              { value: 'rounded', label: <IconShapeRounded />, title: 'Rounded' },
              { value: 'rect', label: <IconShapeRect />, title: 'Rectangle' },
            ]}
          />
        </Popover>
      </span>

      <span className="popover-host">
        <IconButton label="Text size" active={pop === 'text'} onClick={() => toggle('text')}>
          <span className="text-size-glyph">
            Aa<small>{size === null ? '·' : size.toUpperCase()}</small>
          </span>
        </IconButton>
        <Popover open={pop === 'text'} onClose={() => setPop(null)} label="Text size">
          <Segmented<TextSize>
            value={size}
            onChange={(v) => actions.setNodesTextSize(ids, v)}
            options={[
              { value: 's', label: <span style={{ fontSize: 11 }}>A</span>, title: 'Small' },
              { value: 'm', label: <span style={{ fontSize: 13 }}>A</span>, title: 'Medium' },
              { value: 'l', label: <span style={{ fontSize: 16 }}>A</span>, title: 'Large' },
            ]}
          />
        </Popover>
      </span>

      <IconButton label="Bold" active={allBold} onClick={() => actions.setNodesBold(ids, !allBold)}>
        <Bold size={15} />
      </IconButton>

      {roots.length > 0 && (
        <>
          <Divider />
          <span className="popover-host">
            <IconButton
              label="Layout direction"
              active={pop === 'dir'}
              onClick={() => toggle('dir')}
            >
              {dir === 'right' ? (
                <IconDirRight />
              ) : dir === 'down' ? (
                <IconDirDown />
              ) : (
                <IconDirBoth />
              )}
            </IconButton>
            <Popover open={pop === 'dir'} onClose={() => setPop(null)} label="Layout direction">
              <Segmented
                value={dir}
                onChange={(v) => actions.setRootsDir(ids, v)}
                options={[
                  { value: 'both', label: <IconDirBoth />, title: 'Both sides' },
                  { value: 'right', label: <IconDirRight />, title: 'Right' },
                  { value: 'down', label: <IconDirDown />, title: 'Down' },
                ]}
              />
            </Popover>
          </span>
          <span className="popover-host">
            <IconButton
              label="Connector style"
              active={pop === 'conn'}
              onClick={() => toggle('conn')}
            >
              {conn === 'elbow' ? <IconConnElbow /> : <IconConnCurved />}
            </IconButton>
            <Popover open={pop === 'conn'} onClose={() => setPop(null)} label="Connector style">
              <Segmented
                value={conn}
                onChange={(v) => actions.setRootsConnector(ids, v)}
                options={[
                  { value: 'curved', label: <IconConnCurved />, title: 'Curved' },
                  { value: 'elbow', label: <IconConnElbow />, title: 'Elbow' },
                ]}
              />
            </Popover>
          </span>
          <IconButton
            label={autoLayoutOn ? 'Auto-layout on' : 'Auto-layout off'}
            active={autoLayoutOn}
            onClick={() => roots.forEach((r) => actions.toggleRootAutoLayout(r.id))}
          >
            <Magnet size={15} />
          </IconButton>
        </>
      )}

      <Divider />

      {ids.length === 1 && (
        <IconButton label="Add child (Tab)" onClick={() => actions.addChild(ids[0])}>
          <Plus size={16} />
        </IconButton>
      )}
      {withKids.length > 0 && (
        <IconButton
          label={allCollapsed ? 'Expand branch (.)' : 'Collapse branch (.)'}
          onClick={() => withKids.forEach((n) => actions.toggleCollapse(n.id))}
        >
          {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
        </IconButton>
      )}
      <IconButton
        label="Layout nodes (clear manual offsets)"
        disabled={!canLayout}
        onClick={() => actions.layoutNodes(ids)}
      >
        <Wand2 size={15} />
      </IconButton>
      <IconButton label="Delete (⌫)" danger onClick={() => actions.deleteSelection()}>
        <Trash2 size={15} />
      </IconButton>

      <Divider />

      <IconButton
        label="More style options"
        active={uiStore.getState().stylePanelOpen}
        onClick={() => setStylePanelOpen(!uiStore.getState().stylePanelOpen)}
      >
        <SlidersHorizontal size={15} />
      </IconButton>
    </div>
  )
}

// ------------------------------------------------------------------ link bar

function LinkToolbar({ engine, linkId }: { engine: Engine; linkId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pop, setPop] = useState<'arrow' | null>(null)
  useForwardWheel(ref)
  useTrackedPosition(ref, engine, () => {
    const m = engine.board.mirror
    const link = m.links.find((l) => l.id === linkId)
    if (!link) return null
    const a = m.getAnyNode(link.fromId)
    const b = m.getAnyNode(link.toId)
    if (!a || !b) return null
    const mid = crossLinkMidpoint(a, b)
    return { x: mid.x - 8, y: mid.y - 8, w: 16, h: 16 }
  })

  const link = engine.board.mirror.links.find((l) => l.id === linkId)
  if (!link) return null
  const actions = engine.actions

  return (
    <div ref={ref} className="ctx-toolbar" data-chrome role="toolbar" aria-label="Link style">
      <Segmented
        value={link.style}
        onChange={(v) => actions.setLinkStyle(linkId, v)}
        options={[
          { value: 'solid', label: <IconLineSolid />, title: 'Solid' },
          { value: 'dashed', label: <IconLineDashed />, title: 'Dashed' },
        ]}
      />
      <span className="popover-host">
        <IconButton
          label="Arrowheads"
          active={pop === 'arrow'}
          onClick={() => setPop(pop === 'arrow' ? null : 'arrow')}
        >
          {link.arrow === 'none' ? (
            <IconArrowNone />
          ) : link.arrow === 'both' ? (
            <IconArrowBoth />
          ) : (
            <IconArrowEnd />
          )}
        </IconButton>
        <Popover open={pop === 'arrow'} onClose={() => setPop(null)} label="Arrowheads">
          <Segmented
            value={link.arrow}
            onChange={(v) => actions.setLinkArrow(linkId, v)}
            options={[
              { value: 'none', label: <IconArrowNone />, title: 'No arrows' },
              { value: 'end', label: <IconArrowEnd />, title: 'Arrow at end' },
              { value: 'both', label: <IconArrowBoth />, title: 'Arrows both ways' },
            ]}
          />
        </Popover>
      </span>
      <IconButton label="Edit label" onClick={() => uiStore.setState({ editingLinkId: linkId })}>
        <PenLine size={15} />
      </IconButton>
      <Divider />
      <IconButton label="Delete link (⌫)" danger onClick={() => actions.deleteLinkById(linkId)}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  )
}

// ------------------------------------------------------------------- helpers

function same<T>(values: T[]): T | null {
  if (values.length === 0) return null
  return values.every((v) => v === values[0]) ? values[0] : null
}

/**
 * Keep the toolbar glued above its world-space anchor every frame (pan, zoom,
 * reflow, tweens). Writes transform directly — no React re-render per frame.
 * Flips below the anchor when clipped by the top bar; the flip side is
 * published as data-placement so popovers open away from the selection.
 */
function useTrackedPosition(
  ref: RefObject<HTMLDivElement | null>,
  engine: Engine,
  getWorldRect: () => Rect | null,
): void {
  const getRect = useRef(getWorldRect)
  useEffect(() => {
    getRect.current = getWorldRect
  })
  useEffect(() => {
    let raf = 0
    let last = ''
    const sync = (): void => {
      raf = requestAnimationFrame(sync)
      const el = ref.current
      if (!el) return
      const b = getRect.current()
      if (!b) {
        el.style.visibility = 'hidden'
        return
      }
      const cam = uiStore.getState().camera
      const ax = (b.x + b.w / 2 - cam.x) * cam.zoom
      const yTop = (b.y - cam.y) * cam.zoom
      const yBottom = (b.y + b.h - cam.y) * cam.zoom
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let placement: 'above' | 'below' = 'above'
      let y = yTop - GAP - h
      if (y < TOPBAR_H + MARGIN) {
        placement = 'below'
        y = yBottom + GAP
      }
      y = clamp(y, TOPBAR_H + MARGIN, vh - h - MARGIN)
      const x = clamp(ax - w / 2, MARGIN, Math.max(MARGIN, vw - w - MARGIN))
      const t = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      if (t !== last) {
        last = t
        el.style.transform = t
        el.style.visibility = 'visible'
      }
      if (el.dataset.placement !== placement) el.dataset.placement = placement
    }
    sync()
    return () => cancelAnimationFrame(raf)
  }, [ref, engine])
}
