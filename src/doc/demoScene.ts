import type { LinkView, NodeView, Rect, SceneSource } from '../types'
import { nodeRenderRect, rectUnion } from '../types'
import { SpatialIndex } from '../engine/spatialIndex'
import { measureNode } from '../engine/textMeasure'
import { BRANCH_PALETTE, ROOT_DEFAULT_COLOR } from '../theme'
import type { DemoNode } from './demoTree'
import { demoRoot } from './demoTree'

/**
 * M1-only static scene: builds NodeViews from the demo tree with a naive
 * stacked layout so the canvas engine has something real to render. Replaced
 * by the Yjs mirror + tidy-tree layout in M2.
 */

const LEVEL_GAP = 56
const SIBLING_GAP = 14
const BRANCH_GAP = 28

class DemoScene implements SceneSource {
  nodes = new Map<string, NodeView>()
  paintList: string[] = []
  rootIds: string[] = []
  links: LinkView[] = []
  spatial = new SpatialIndex()

  contentBounds(): Rect | null {
    let bounds: Rect | null = null
    for (const id of this.rootIds) {
      const n = this.nodes.get(id)
      if (!n) continue
      bounds = bounds ? rectUnion(bounds, n.subtreeBounds) : n.subtreeBounds
    }
    return bounds
  }
}

let nextId = 0
const genId = (): string => 'demo-' + ++nextId

function buildViews(
  scene: DemoScene,
  spec: DemoNode,
  parentId: string | null,
  depth: number,
  index: number,
  inheritedColor: string | null,
): NodeView {
  const color = depth === 1 ? BRANCH_PALETTE[index % BRANCH_PALETTE.length] : null
  const effectiveColor = color ?? inheritedColor ?? ROOT_DEFAULT_COLOR
  const textStyle = { size: depth === 0 ? ('l' as const) : ('m' as const), bold: depth <= 1 }
  const size = measureNode(spec.text, textStyle)
  const node: NodeView = {
    id: genId(),
    parentId,
    order: String(index),
    text: spec.text,
    shape: depth === 0 ? 'rounded' : 'pill',
    color,
    textStyle,
    collapsed: spec.collapsed ?? false,
    layout: 'auto',
    mx: 0,
    my: 0,
    side: null,
    dir: depth === 0 ? 'both' : null,
    connectorStyle: depth === 0 ? 'curved' : null,
    childrenIds: [],
    depth,
    effectiveColor,
    width: size.width,
    height: size.height,
    textLines: size.lines,
    x: 0,
    y: 0,
    renderX: 0,
    renderY: 0,
    renderAlpha: 1,
    renderScale: 1,
    subtreeBounds: { x: 0, y: 0, w: 0, h: 0 },
    subtreeCount: 0,
    visible: true,
  }
  scene.nodes.set(node.id, node)
  const children = spec.children ?? []
  children.forEach((childSpec, i) => {
    const child = buildViews(scene, childSpec, node.id, depth + 1, i, effectiveColor)
    node.childrenIds.push(child.id)
    node.subtreeCount += 1 + child.subtreeCount
  })
  return node
}

/** Height of the stacked subtree (collapsed subtrees contribute only their own box). */
function stackHeight(scene: DemoScene, node: NodeView): number {
  if (node.collapsed || node.childrenIds.length === 0) return node.height
  let sum = 0
  for (const id of node.childrenIds) {
    const child = scene.nodes.get(id)!
    sum += stackHeight(scene, child)
  }
  const gap = node.depth === 0 ? BRANCH_GAP : SIBLING_GAP
  sum += gap * (node.childrenIds.length - 1)
  return Math.max(node.height, sum)
}

/** Naive stacked layout: children to one side of the parent, vertically packed. */
function layoutSubtree(scene: DemoScene, node: NodeView, sign: 1 | -1): void {
  if (node.collapsed || node.childrenIds.length === 0) return
  const gap = node.depth === 0 ? BRANCH_GAP : SIBLING_GAP
  const heights = node.childrenIds.map((id) => stackHeight(scene, scene.nodes.get(id)!))
  const total = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1)
  let cursor = node.y - total / 2
  node.childrenIds.forEach((id, i) => {
    const child = scene.nodes.get(id)!
    child.x = node.x + sign * (node.width / 2 + LEVEL_GAP + child.width / 2)
    child.y = cursor + heights[i] / 2
    child.side = node.depth === 0 ? (sign === 1 ? 'right' : 'left') : node.side
    cursor += heights[i] + gap
    layoutSubtree(scene, child, sign)
  })
}

function finalize(scene: DemoScene, node: NodeView, ancestorCollapsed: boolean): Rect {
  node.visible = !ancestorCollapsed
  node.renderX = node.x
  node.renderY = node.y
  let bounds = nodeRenderRect(node)
  for (const id of node.childrenIds) {
    const child = scene.nodes.get(id)!
    const childBounds = finalize(scene, child, ancestorCollapsed || node.collapsed)
    if (child.visible) bounds = rectUnion(bounds, childBounds)
  }
  node.subtreeBounds = bounds
  if (node.visible) scene.spatial.insert(node.id, nodeRenderRect(node))
  scene.paintList.push(node.id)
  return bounds
}

export function buildDemoScene(): SceneSource {
  nextId = 0 // deterministic ids per build (StrictMode mounts twice in dev)
  const scene = new DemoScene()
  const root = buildViews(scene, demoRoot, null, 0, 0, null)
  scene.rootIds.push(root.id)

  // Both-sides root: assign branches greedily to the lighter side.
  const right: NodeView[] = []
  const left: NodeView[] = []
  let rightH = 0
  let leftH = 0
  for (const id of root.childrenIds) {
    const branch = scene.nodes.get(id)!
    const h = stackHeight(scene, branch)
    if (rightH <= leftH) {
      right.push(branch)
      rightH += h + BRANCH_GAP
    } else {
      left.push(branch)
      leftH += h + BRANCH_GAP
    }
  }

  root.x = 0
  root.y = 0
  for (const [branches, sign] of [
    [right, 1],
    [left, -1],
  ] as const) {
    const heights = branches.map((b) => stackHeight(scene, b))
    const total = heights.reduce((a, b) => a + b, 0) + BRANCH_GAP * Math.max(0, heights.length - 1)
    let cursor = -total / 2
    branches.forEach((branch, i) => {
      branch.x = sign * (root.width / 2 + LEVEL_GAP + branch.width / 2)
      branch.y = cursor + heights[i] / 2
      branch.side = sign === 1 ? 'right' : 'left'
      cursor += heights[i] + BRANCH_GAP
      layoutSubtree(scene, branch, sign)
    })
  }

  // paintList in preorder (parents before children).
  finalize(scene, root, false)
  return scene
}
