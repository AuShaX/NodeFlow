# Build "Nodeflow" — a Miro-grade mind-mapping web app

You are building a production-quality, single-page mind-mapping web application with the interaction feel of Miro's mind map tool: an infinite canvas, buttery 60fps pan/zoom, keyboard-first node creation, live animated auto-layout, and connectors that stay perfectly attached and smoothly curved at every frame of every drag. Treat this spec as the source of truth.

**First action:** save this entire prompt as `SPEC.md` in the repo root. Re-read the relevant section before implementing each milestone.

---

## 1. Mission and quality bar

The product is a mind-mapping tool, not a general whiteboard. Everything serves one loop: *think → press a key → node appears in the right place → map reflows smoothly*. The bar:

- A user can build a 100-node map without touching the mouse.
- Layout changes are always animated (≈180ms ease-out). Nothing ever teleports or jumps.
- Connectors are recomputed every animation frame during drags — they never lag behind, detach, or straighten incorrectly.
- 60fps pan/zoom and node-drag with 1,000 nodes on a mid-range laptop; graceful degradation, never a frozen UI, at 5,000.
- Crisp rendering on retina/HiDPI at every zoom level.
- Zero data loss: every change persists locally within ~1s; reload restores exact state including viewport.

If any instruction here conflicts with making the interaction feel solid and fluid, fluidity wins — note the deviation in `DECISIONS.md`.

## 2. Locked tech decisions (do not bikeshed)

- **Vite + React 19 + TypeScript (strict)**. React renders only UI chrome (toolbar, panels, context menu, overlays). 
- **The board is a single `<canvas>` 2D element** with a custom engine. No DOM/SVG nodes on the board, no PixiJS, no react-flow, no konva. Reasons: full control over hit-testing, culling, and per-frame connector redraws; no dependency API churn.
- **Yjs is the document model**: `yjs`, `y-indexeddb` for persistence, `Y.UndoManager` for undo/redo. No server in v1, but every mutation goes through Yjs so multiplayer is a drop-in later.
- **Zustand** for ephemeral UI state only (selection, tool, camera, hover, edit state). Document truth lives in Yjs; a plain-JS mirror (see §5) feeds the renderer.
- Styling for chrome: **Tailwind** or plain CSS modules — your call. Icons: `lucide-react`.
- No other runtime dependencies without a written justification in `DECISIONS.md`.
- Tooling: ESLint + Prettier + `tsc --noEmit` in a `npm run check` script. Vitest for the layout/geometry math.

## 3. Process — how to work

Build in the milestones below, in order. After each milestone:

1. `npm run check` and `npm run test` must pass.
2. Start the dev server and actually exercise the milestone's acceptance checklist in a browser (use your browser tooling if available; otherwise write a Playwright smoke test).
3. Commit with a message naming the milestone.
4. Append any spec deviations or judgment calls to `DECISIONS.md`.

Seed data: implement a `createDemoBoard()` that generates a recognizable demo map (root "Product Launch", 4–5 branches, 40+ nodes, mixed depths, one collapsed branch, two cross-links, varied branch colors). Load it on first run so every milestone is testable against realistic content.

**Milestones**
- **M1 — Canvas engine:** camera, render loop, grid, HiDPI, pan/zoom, hit-testing, static demo nodes drawn.
- **M2 — Mindmap core:** Yjs schema, tidy-tree layout, animated reflow, Tab/Enter creation, inline text editing, delete.
- **M3 — Drag interactions:** node drag with live re-layout preview, drag-to-reparent, Ctrl/Cmd free-move, sibling reorder, marquee + multi-select.
- **M4 — Connectors & structure:** curved + elbow connector styles, collapse/expand with badges, cross-links, insert-between.
- **M5 — Styling & chrome:** node shapes, branch colors, context toolbar, style panel, layout-direction options, spacing controls.
- **M6 — Persistence & I/O:** multi-board home screen, autosave, viewport restore, export PNG / Markdown / JSON, import Markdown/JSON, node search.
- **M7 — Polish pass:** performance audit against §13 budget, touch/trackpad gestures, empty states, README with full shortcut table.

## 4. Architecture

```
src/
  engine/        # rendering + input, framework-free
    camera.ts        # world<->screen transforms, zoom-to-point, fit
    renderer.ts      # rAF loop, dirty flags, layer draw order
    drawNode.ts      # node painting (shape, text, badges, selection)
    drawConnector.ts # bezier/elbow path construction + painting
    hitTest.ts       # point->node/connector/handle resolution
    input.ts         # pointer/keyboard/wheel -> InteractionMachine events
    interactions.ts  # explicit interaction state machine (§9)
    animator.ts      # tweens node positions/opacity; drives dirty flag
    spatialIndex.ts  # simple grid or quadtree for culling + hit queries
  doc/           # document layer
    schema.ts        # Yjs types, accessors, mutation API (all writes here)
    mirror.ts        # Yjs -> plain JS object graph, updated via observers
    undo.ts          # UndoManager config, drag coalescing
    clipboard.ts     # subtree copy/paste serialization
    io.ts            # PNG/Markdown/JSON export, Markdown/JSON import
  layout/
    tidyTree.ts      # variable-size tidy tree (§6), pure + unit-tested
    mindmapLayout.ts # both-sides root balancing, offsets, collapse handling
  ui/            # React chrome only
    Toolbar.tsx, ContextToolbar.tsx, StylePanel.tsx, Minimap.tsx,
    TextEditorOverlay.tsx, BoardHome.tsx, SearchPalette.tsx
  state/store.ts # zustand: camera, selection, tool, hover, editing, prefs
```

Data flow: **input → interaction machine → mutation API (Yjs transact) → observers update mirror → layout recomputes affected subtree → animator tweens → renderer paints.** The renderer reads only from the mirror + animator + UI store. React never touches the canvas directly.

## 5. Document model (Yjs schema)

One Y.Doc per board.

```ts
// doc.getMap('meta'): { name, createdAt, schemaVersion }
// doc.getMap('nodes'): Map<nodeId, Y.Map> with fields:
{
  id: string,            // nanoid
  parentId: string|null, // null = a root (multiple roots allowed)
  order: string,         // fractional index among siblings (e.g. base-95 string)
  text: string,          // plain text; preserve \n
  // styling
  shape: 'pill'|'rounded'|'rect',
  color: string|null,    // branch color; null = inherit from nearest ancestor
  textStyle: { size:'s'|'m'|'l', bold:boolean },
  // layout
  collapsed: boolean,
  layout: 'auto'|'manual',   // manual = excluded from parent's auto-layout
  mx: number, my: number,    // manual offset from computed slot (0,0 default)
  side: 'left'|'right'|null, // only meaningful for depth-1 children of a root
  dir: 'right'|'down'|'both'|null, // only on roots: layout direction
  connectorStyle: 'curved'|'elbow'|null, // on roots; null=curved
}
// doc.getArray('links'): cross-links
{ id, fromId, toId, label: string, style:'solid'|'dashed', arrow:'none'|'end'|'both' }
```

Rules:
- **All mutations** go through functions in `schema.ts`, each wrapped in `doc.transact(fn, localOrigin)` so UndoManager scoping works.
- **Fractional ordering** for siblings (insert between = midpoint string) so reorders are single-field writes.
- Deleting a node deletes its entire subtree and any links touching deleted nodes (single transaction → single undo step).
- The **mirror** rebuilds incrementally from Yjs observers into: `nodes: Map<id, NodeView>` where `NodeView` adds derived data: `childrenIds` (sorted), `depth`, `effectiveColor`, measured `width/height`, computed `x/y` (layout slot), `renderX/renderY` (animated), `subtreeBounds`, `visible` (false if any ancestor collapsed).
- Text measurement: measure with canvas `measureText` against the node's font; wrap at `maxWidth = 320px` world units; cache by `(text, size, bold)`.

**Undo/redo:** `Y.UndoManager` tracking `nodes` + `links` + `meta`, `trackedOrigins = {localOrigin}`. During continuous drags, write intermediate positions with a *non-tracked* origin and commit the final value with the tracked origin so one drag = one undo step. Same for text edits (commit on blur/Esc/Enter).

## 6. Layout engine — the crown jewel

Implement a **variable-node-size tidy tree** (Reingold–Tilford with Buchheim's linear-time improvements, or an equivalent flextree approach). Pure functions, fully unit-tested with at least: single chain, wide fan-out, deep unbalanced tree, mixed node heights, collapsed branches, manual-offset nodes.

- Primary axis = layout direction (right or down). For `dir:'right'`: children stack vertically to the right of the parent; node's x = parent right edge + `levelGap`; subtree vertical packing uses contours so **tall subtrees never overlap**, with `siblingGap` between sibling subtree contours and `branchGap` between depth-1 branches.
- **Both-sides root (`dir:'both'`, the default for new maps):** depth-1 children carry a `side`. New children auto-balance: assign to the side with smaller total subtree height. Each side is laid out as an independent right/left tidy tree; left side is the mirrored computation. Users can drag a depth-1 branch across the root to flip its `side`.
- Spacing tokens (user-adjustable in the style panel, stored per board): `levelGap=56`, `siblingGap=14`, `branchGap=28`, `compactness` slider scaling all three (0.6×–1.6×). *This is deliberately better than Miro, where fixed spacing is a top user complaint.*
- `collapsed:true` ⇒ subtree contributes only the node's own box to packing.
- `layout:'manual'` nodes: final position = computed slot + `(mx,my)`; their *subtree* still auto-lays-out relative to them. A root with auto-layout toggled off freezes children at current offsets (write their `mx/my`, set `layout:'manual'`).
- **Incremental:** relayout only the affected root's tree (track dirty roots per transaction). Must complete < 8ms for 1,000 nodes; if you can't hit that, move layout to a Web Worker (structured-clone the minimal tree) — measure first.
- **Animation:** when layout produces new slots, don't snap. The animator tweens each moved node's `renderX/renderY` from current to target over 180ms `cubic-bezier(0.25,1,0.4,1)`. New nodes fade/scale in (120ms, from 0.85 scale at the parent edge); deleted subtrees fade out. Interrupted tweens retarget from current animated value — never restart from origin.

## 7. Connectors — geometry spec

Connectors are drawn every frame from **current animated positions**, so they are correct mid-tween and mid-drag by construction. No caching of paths across frames during motion.

**Anchor points:** parent edge midpoint on the side facing the child; child edge midpoint on the side facing the parent. For horizontal layouts: parent right-center → child left-center (mirrored on the left side). For `dir:'down'`: parent bottom-center → child top-center.

**Curved style (default):** cubic Bézier. For a horizontal edge from P=(px,py) to C=(cx,cy): `dx = max(24, |cx-px| * 0.45)`; control points `(px+dx, py)` and `(cx−dx, cy)` (sign flips on the left side). Tangents are therefore horizontal at both ends — branches leave and enter nodes cleanly, like Miro. Vertical layout: same with axes swapped.

**Elbow style:** orthogonal route with a single bend at the midpoint of the primary axis, corners rounded with radius `min(10, |Δ|/2)` via `arcTo`.

**Painting:** stroke width 2 (world units), color = child's `effectiveColor`. Optional taper for depth-1 edges (width 3→2) for visual hierarchy. Cross-links: same Bézier math but anchored on nearest edges of the two nodes, support dashed pattern, arrowheads (filled triangle, 8px, oriented along end tangent), and a centered label drawn on a small pill background. Hit-testing for connectors/links: sample the Bézier at ~24 points, hit if pointer within 6 screen px of the polyline.

## 8. Canvas engine

- **Camera:** `{x, y, zoom}` world→screen: `sx = (wx - x) * zoom`. Zoom range **0.05–4.0**. Wheel = zoom **toward cursor** (multiply by `1.0015^(-deltaY)`, clamp); Ctrl/Cmd+wheel also zooms (trackpad pinch arrives this way); plain two-finger trackpad scroll **pans**; Space+drag or middle-button drag pans; touch: one finger drags nodes / pans empty canvas, two-finger pinch zooms around the midpoint.
- **HiDPI:** canvas backing store = `css size × devicePixelRatio`, `ctx.setTransform(dpr·zoom, 0, 0, dpr·zoom, …)` once per frame; re-handle on `resize` and DPR change.
- **Render loop:** single rAF; skip painting entirely when no dirty flag and no active tweens (idle CPU ≈ 0). Draw order: dot-grid background (spacing adapts to zoom: fade between 8/40/200px steps) → connectors → cross-links → nodes (parents before children) → selection outlines + handles → drag previews/ghosts → marquee.
- **Culling:** query the spatial index for the viewport rect (+20% margin); skip everything else. Rebuild index entries lazily on node move (cheap uniform grid is fine).
- **Node painting:** rounded rect / pill / rect per `shape`; fill = effectiveColor for depth 0–1, white fill + colored 2px border + colored text accent for deeper nodes (clear hierarchy, configurable later); text via cached wrapped lines, 14px Inter at `m` (12/17 for s/l), centered; ellipsize beyond 6 lines. Selection: 2px accent outline + 4 corner handles. Hover: subtle outline. Collapsed badge: small circle with descendant count on the outward edge; hover "+" affordances: circles on the outward edge (add child) — clicking is equivalent to Tab/Enter.
- **Zoom LOD:** below 0.25 zoom, skip text and draw nodes as colored blocks; below 0.1, draw subtree bounds only.

## 9. Interaction state machine

Implement `interactions.ts` as an explicit FSM. States: `idle`, `panning`, `marquee`, `draggingNodes`, `draggingFreeMove`, `draggingLink`, `editingText`, `spacePan`. Every pointer/key event maps to a transition; no booleans scattered across handlers.

**Pointer:**
- Click node → select (Shift = toggle into multi-selection). Click connector/link → select it. Click empty → clear selection; drag empty → marquee (intersect = select).
- Drag selected node(s) ≥ 4px → `draggingNodes`: render subtree as ghost at 60% opacity following cursor; every frame compute the **drop preview**: nearest non-descendant node within 80 screen px of the dragged node's anchor edge.
  - Preview over a candidate parent: highlight it and show an animated **insertion gap** opening between its children at the index implied by pointer position (this gap is rendered by feeding a phantom slot into a preview layout — siblings smoothly shift apart, which is the "seamless" feel).
  - Drop on candidate → reparent + fractional-index insert (one transaction) → animated reflow. Drop on empty within the same parent's region → sibling reorder. Drop far from any node with no parent change → revert with animation (or, if dragged a root, just move the root).
  - Dragging a depth-1 node across to the root's other side flips `side`.
- **Ctrl/Cmd+drag** → `draggingFreeMove`: move node+subtree as a unit, write `mx/my`, set `layout:'manual'`. Never reparents.
- **Alt+drag** → duplicate subtree then drag the copy.
- Drag from a node's small edge dot (visible on hover/selection) → `draggingLink`: live Bézier from anchor to cursor; drop on a node creates a cross-link; drop on empty cancels.
- Double-click node → edit text. Double-click empty canvas → create a new floating root node there and edit it.

**Keyboard (selected node, not editing):**
| Key | Action |
|---|---|
| `Tab` | Create child (auto side-balance at depth 1), select it, enter edit mode |
| `Enter` | Create sibling below, select, edit (on a root: create child) |
| `Shift+Tab` | Select parent |
| `F2` or start typing | Edit text (typing replaces content, like Miro/Excel) |
| `Delete`/`Backspace` | Delete node + subtree (confirm via undo, no dialog) |
| `←↑→↓` | Navigate: toward parent/child along layout axis; between siblings on the cross axis |
| `Cmd/Ctrl+↑/↓` | Reorder among siblings |
| `Cmd/Ctrl+C/X/V` | Copy/cut subtree; paste as child of selection (or floating root if none) |
| `Cmd/Ctrl+D` | Duplicate subtree as next sibling |
| `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` | Undo / redo |
| `Cmd/Ctrl+A` | Select all visible nodes |
| `Space` (hold) | Pan tool |
| `Cmd/Ctrl+0` / `Cmd/Ctrl+1` | Fit map to view / 100% |
| `Cmd/Ctrl+F` | Search palette |
| `.` or `Cmd/Ctrl+/` | Collapse/expand selected branch |
| `Esc` | Clear selection / cancel current drag (revert) |

**While editing:** `Enter` commits + creates sibling and keeps editing flow going; `Shift+Enter` newline; `Tab` commits + creates child; `Esc` commits and exits. This chain is what makes the app feel like an outliner — get it exactly right.

## 10. Inline text editing

A single absolutely-positioned `contenteditable` div (`TextEditorOverlay.tsx`) placed over the node using camera transforms, matching the node's font, size, alignment, padding, and wrap width exactly — the swap from canvas text to editor must be pixel-stable (hide the canvas text for that node while editing). It tracks pan/zoom live. Node width grows with text up to 320px, then wraps and grows downward; layout reflows (animated) *as the user types*, throttled to one relayout per frame.

## 11. Feature checklist (complete = done)

- Multiple independent mindmaps per board + floating standalone nodes.
- Collapse/expand with counts; collapsed state persists; expand animates children back out from the parent.
- Cross-links with labels, dash style, arrowheads; editable via context toolbar; deletable.
- Insert node between parent and child (context action "Insert node before").
- Context toolbar floating above selection: color swatches (10-color default palette + custom), shape, text size/bold, connector style (on roots), layout direction (on roots), auto-layout toggle, collapse, add child, delete, "Layout nodes" (clears manual offsets in subtree, animated).
- Multi-select editing applies style to all selected.
- Minimap (bottom-right, canvas-based, ~200×140): rendered subtree bounds + viewport rect; click/drag to navigate; throttled redraw.
- Search palette (`Cmd/Ctrl+F`): fuzzy match node text, ↑↓ to cycle, Enter pans/zooms to the node with a brief highlight pulse.
- Export: **PNG** (render to offscreen canvas at 2×, fit bounds + 64px padding, transparent or background toggle), **Markdown outline** (indented `-` list, depth = nesting; cross-links as footnotes), **JSON** (full fidelity). Import: Markdown outline → mindmap (this is a killer feature — paste any indented list, get a map), JSON.
- Board home: grid of boards (name, updated-at, tiny thumbnail from last PNG snapshot), create/rename/duplicate/delete. Routing via URL hash `#/board/:id`. Autosave indicator ("Saved" / "Saving…").
- Viewport (camera) persisted per board in localStorage; restored on open; new boards open fit-to-content.
- Onboarding empty state: a ready root node "Press Tab to add an idea" + a dismissible shortcut hint card.

## 12. UI chrome and visual design

Follow this direction; don't default to a generic template look. The app's personality: **a quiet, paper-like thinking space where the user's map is the only loud thing.**

- Canvas: very light warm gray `#FAFAF8` with a faint dot grid `#E4E4DE`. Chrome surfaces: white, 1px `#E8E8E3` borders, soft shadows, 10px radius. Text: `#1A1A18`; muted `#8A8A82`. Accent (selection, focus, primary buttons): a confident teal `#0D9488` — *not* the default blue/violet.
- Default branch palette (assigned round-robin to new depth-1 branches): `#0D9488 #E07A3F #5B7FD4 #C2528B #6BA34F #8A63C9 #D4A013 #4FA3A5 #C75450 #7A7A72`.
- Type: Inter (variable) for everything; board name in the top bar gets 600 weight. No display-font theatrics — this is a tool.
- Layout: slim top bar (board name inline-editable, undo/redo, search, export menu, share placeholder); floating bottom-center pill toolbar (select, add root, link tool, spacing slider popover, zoom controls with % readout); context toolbar appears above selection; style details in a right slide-in panel only when "More" is clicked. Keep chrome out of the way — the canvas is the hero.
- Signature element: the **animated insertion gap** during drag-to-reparent and the ink-like draw-in of new connectors (stroke-dash reveal, 150ms). Spend polish there.
- Quality floor: visible keyboard focus in chrome, `prefers-reduced-motion` disables tweens (snap instantly), cursor changes per state (grab/grabbing/crosshair/text), sensible touch targets.

## 13. Performance budget (verify in M7, record numbers in DECISIONS.md)

- 1,000-node demo (write a generator): pan/zoom and single-node drag ≥ 55fps; full relayout < 8ms; initial load < 1.5s.
- Idle: zero rAF paints (verify via counter in a debug HUD, toggled with `Cmd/Ctrl+Shift+D`: fps, painted-node count, last layout ms).
- Text measurement cached; no per-frame allocations in the hot paint path (reuse arrays/objects); no Yjs reads in the render loop (mirror only).

## 14. Definition of done

Walk this script end-to-end in the browser without breakage:

1. New board → root appears → type name → `Tab`, type, `Enter`, type, `Enter` … build 10 nodes by keyboard only, watching the map balance left/right and animate.
2. Drag a mid-depth node onto another branch — see ghost, insertion gap, drop, smooth reflow. Undo restores in one step.
3. Ctrl-drag a node away (manual offset), then "Layout nodes" snaps it back animated.
4. Collapse a big branch, badge shows count, expand animates back.
5. Draw a cross-link between distant nodes, label it, style it dashed.
6. Recolor a depth-1 branch — color flows to descendants and connectors.
7. Switch root to top-down elbow style — whole tree re-routes animatedly.
8. Zoom to 5% and 400% — crisp, LOD kicks in, dot grid adapts.
9. Reload the page — exact map + viewport restored. Export PNG and Markdown; re-import the Markdown into a new board.
10. Paste a 3-level indented list from a text editor via Import → correct mindmap.
11. Run the 1k-node generator; confirm the budget; check the HUD.

## 15. Non-goals for v1 (do not build)

Real-time multiplayer server and presence (Yjs makes this phase 2 — leave a `// PHASE2` note where the provider would attach), comments, frames, stickies/freeform shapes, AI generation, auth/accounts, mobile-specific layouts, Electron/Tauri packaging (phase 3 — but keep the app free of Node-only APIs so wrapping is trivial).

Now begin with M1. Read §2–§4 and §8 again before writing code.
