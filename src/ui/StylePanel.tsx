import type { ReactNode } from 'react'
import { Bold, Magnet, Wand2, X } from 'lucide-react'
import type { Engine } from '../engine'
import { engineRef } from '../engine'
import { setStylePanelOpen, useUI } from '../state/store'
import type { NodeView, Shape, TextSize } from '../types'
import { DEFAULT_SPACING } from '../layout/mindmapLayout'
import { useMirrorVersion } from './hooks'
import { ColorPalette, IconButton, Segmented } from './kit'
import { SpacingSlider } from './SpacingQuick'
import {
  IconConnCurved,
  IconConnElbow,
  IconDirBoth,
  IconDirDown,
  IconDirRight,
  IconShapePill,
  IconShapeRect,
  IconShapeRounded,
} from './icons'

/**
 * Right slide-in panel ("More" in the context toolbar, SPEC §12): the full
 * style controls plus the per-board spacing tokens (SPEC §6) — adjustable
 * spacing is a deliberate edge over Miro's fixed gaps.
 */
export function StylePanel() {
  const open = useUI((s) => s.stylePanelOpen)
  const selection = useUI((s) => s.selection)
  useMirrorVersion()
  const engine = engineRef.current
  if (!engine) return null

  const m = engine.board.mirror
  const nodes = [...selection]
    .map((id) => m.nodes.get(id))
    .filter((n): n is NodeView => n !== undefined)
  const ids = nodes.map((n) => n.id)
  const roots = nodes.filter((n) => n.parentId === null)
  const actions = engine.actions

  const shape = same(nodes.map((n) => n.shape))
  const size = same(nodes.map((n) => n.textStyle.size))
  const allBold = nodes.length > 0 && nodes.every((n) => n.textStyle.bold)
  const ownColor = same(nodes.map((n) => n.color ?? null))
  const effective = same(nodes.map((n) => n.effectiveColor))
  const dir = roots.length > 0 ? same(roots.map((r) => r.dir ?? 'both')) : null
  const conn = roots.length > 0 ? same(roots.map((r) => r.connectorStyle ?? 'curved')) : null
  const autoOn = roots.length > 0 && roots.every((r) => actions.rootAutoLayoutOn(r.id))

  return (
    <aside
      className={'style-panel' + (open ? ' is-open' : '')}
      data-chrome
      aria-hidden={!open}
      aria-label="Style panel"
      // keep the hidden panel out of the tab order without unmounting (slide transition)
      inert={!open || undefined}
    >
      <header className="panel-head">
        <h2>Style</h2>
        <IconButton label="Close panel" onClick={() => setStylePanelOpen(false)}>
          <X size={15} />
        </IconButton>
      </header>

      <div className="panel-body">
        {nodes.length > 0 ? (
          <Section title={nodes.length === 1 ? 'Node' : `${nodes.length} nodes`}>
            <Row label="Color">
              <ColorPalette
                current={ownColor ?? effective}
                showAuto={nodes.some((n) => n.parentId !== null)}
                onPick={(c) => actions.setNodesColor(ids, c)}
              />
            </Row>
            <Row label="Shape">
              <Segmented<Shape>
                value={shape}
                onChange={(v) => actions.setNodesShape(ids, v)}
                options={[
                  { value: 'pill', label: <IconShapePill />, title: 'Pill' },
                  { value: 'rounded', label: <IconShapeRounded />, title: 'Rounded' },
                  { value: 'rect', label: <IconShapeRect />, title: 'Rectangle' },
                ]}
              />
            </Row>
            <Row label="Text">
              <Segmented<TextSize>
                value={size}
                onChange={(v) => actions.setNodesTextSize(ids, v)}
                options={[
                  { value: 's', label: <span style={{ fontSize: 11 }}>A</span>, title: 'Small' },
                  { value: 'm', label: <span style={{ fontSize: 13 }}>A</span>, title: 'Medium' },
                  { value: 'l', label: <span style={{ fontSize: 16 }}>A</span>, title: 'Large' },
                ]}
              />
              <IconButton
                label="Bold"
                active={allBold}
                onClick={() => actions.setNodesBold(ids, !allBold)}
              >
                <Bold size={15} />
              </IconButton>
            </Row>
          </Section>
        ) : (
          <p className="panel-hint">Select a node to style it.</p>
        )}

        {roots.length > 0 && (
          <Section title="Map layout">
            <Row label="Direction">
              <Segmented
                value={dir}
                onChange={(v) => actions.setRootsDir(ids, v)}
                options={[
                  { value: 'both', label: <IconDirBoth />, title: 'Both sides' },
                  { value: 'right', label: <IconDirRight />, title: 'Right' },
                  { value: 'down', label: <IconDirDown />, title: 'Down' },
                ]}
              />
            </Row>
            <Row label="Connectors">
              <Segmented
                value={conn}
                onChange={(v) => actions.setRootsConnector(ids, v)}
                options={[
                  { value: 'curved', label: <IconConnCurved />, title: 'Curved' },
                  { value: 'elbow', label: <IconConnElbow />, title: 'Elbow' },
                ]}
              />
            </Row>
            <Row label="Auto-layout">
              <IconButton
                label={autoOn ? 'Turn auto-layout off (freeze positions)' : 'Turn auto-layout on'}
                active={autoOn}
                onClick={() => roots.forEach((r) => actions.toggleRootAutoLayout(r.id))}
              >
                <Magnet size={15} />
              </IconButton>
              <button
                type="button"
                className="text-btn"
                disabled={!actions.hasManualInSubtrees(ids)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => actions.layoutNodes(ids)}
              >
                <Wand2 size={13} /> Layout nodes
              </button>
            </Row>
          </Section>
        )}

        <Section title="Spacing (board)">
          <SpacingSlider
            engine={engine}
            token="compactness"
            label="Compactness"
            format={(v) => `${v.toFixed(2)}×`}
            step={0.05}
          />
          <SpacingSlider engine={engine} token="levelGap" label="Level gap" format={px} step={2} />
          <SpacingSlider
            engine={engine}
            token="siblingGap"
            label="Sibling gap"
            format={px}
            step={1}
          />
          <SpacingSlider
            engine={engine}
            token="branchGap"
            label="Branch gap"
            format={px}
            step={1}
          />
          <button
            type="button"
            className="text-btn"
            disabled={isDefaultSpacing(engine)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() =>
              engine.actions.commitSpacing(engine.board.mirror.spacing, DEFAULT_SPACING)
            }
          >
            Reset spacing
          </button>
        </Section>
      </div>
    </aside>
  )
}

const px = (v: number): string => `${Math.round(v)}px`

function isDefaultSpacing(engine: Engine): boolean {
  const s = engine.board.mirror.spacing
  return (
    s.levelGap === DEFAULT_SPACING.levelGap &&
    s.siblingGap === DEFAULT_SPACING.siblingGap &&
    s.branchGap === DEFAULT_SPACING.branchGap &&
    s.compactness === DEFAULT_SPACING.compactness
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="panel-row">
      <span className="panel-row-label">{label}</span>
      <span className="panel-row-controls">{children}</span>
    </div>
  )
}

function same<T>(values: T[]): T | null {
  if (values.length === 0) return null
  return values.every((v) => v === values[0]) ? values[0] : null
}
