# DECISIONS

Running log of spec deviations and judgment calls, newest last. (SPEC §3.)

## M1 — Canvas engine

- **Chrome styling: plain CSS** (single `index.css` with custom properties), not Tailwind. The
  chrome surface is small; zero extra dependencies and no class-name noise in components.
- **Extra dependency: `@fontsource-variable/inter`.** SPEC §12 mandates Inter for everything,
  including canvas-rendered node text. Self-hosting via fontsource guarantees the font is
  available offline, loads deterministically (no third-party CDN), and lets us await
  `document.fonts.load()` before measuring text so node boxes are sized against the real font.
- **Wheel heuristic.** SPEC §8 wants mouse-wheel zoom _and_ two-finger trackpad pan on the same
  `wheel` event stream. Disambiguation: `ctrl/cmd+wheel` (incl. macOS pinch) always zooms;
  otherwise line-mode deltas or large integer `deltaY` with `deltaX === 0` are treated as a
  discrete mouse wheel (zoom toward cursor, `1.0015^-deltaY` per spec); everything else pans.
  Pinch uses a steeper `1.0035^-deltaY` curve so it feels 1:1 — the spec factor is calibrated
  for ±120-per-notch wheel deltas, not ±3-per-event pinch deltas.
- **Fit-to-view caps zoom at 100%** so small maps don't get blown up to 400% on `Cmd/Ctrl+0`.
- **Root node default color** is the ink color `#1A1A18` (spec assigns palette colors only to
  depth-1 branches; the root needed a defined fill). White text on it, like Miro's dark roots.
- **Depth≥2 node text is painted in the branch color** per §8 "colored text accent"; depth 0–1
  use white text on a colored fill.
- **Dot grid is drawn with cached canvas patterns** (one pattern fill per visible grid level)
  instead of thousands of `arc()` calls. Tile size is quantized to whole device pixels, which
  can drift the grid ≤0.5px per tile vs. true world coordinates — invisible for a decorative
  grid, and it keeps grid cost ~constant regardless of zoom.
- **Left-drag on empty canvas pans in M1.** M3 replaces this with marquee selection per §9
  (space/middle/trackpad panning remain).
- **Depth-1 connector taper approximated** with a constant 2.5px stroke (vs 2px deeper) rather
  than a true tapered fill path; revisit in the M7 polish pass if it reads flat.
- **Connector axis/style live on the root** (`dir`, `connectorStyle`) and are resolved by
  walking parents in the renderer; M1 demo content is horizontal/curved only.

## M2 — Mindmap core

- **`textStyle` is stored as two flat Yjs fields** (`textSize`, `bold`) instead of a nested
  object — field-level updates and merges are simpler, and the mirror reassembles the
  `textStyle` object the renderer expects.
- **Root positions reuse `mx`/`my` as absolute world coordinates** (a root's "computed slot"
  is the origin). Avoids extra schema fields; manual-offset semantics stay uniform.
- **Manual (free-moved) node slots are parent-relative:** final position = parentCenter +
  (mx, my). SPEC §6 says "computed slot + (mx,my)" but a packing slot for a node excluded
  from packing is ill-defined; anchoring to the parent keeps offsets stable as siblings
  reflow, which is what free-move should feel like.
- **Fractional order keys are base-62** (`0-9A-Za-z`), not base-95 — same mechanics, keys
  stay readable in debuggers, and avoiding quote/backslash characters spares escaping pain.
- **Order-key edge case:** `keyBetween` pads with one-past-max when the upper bound is open,
  so append-heavy flows (the common case) grow keys logarithmically.
- **Undo steps:** `captureTimeout: 0` (every transaction = one step) with two carve-outs:
  intermediate gesture/typing writes use an untracked `ephemeralOrigin`, and a new node's
  first text commit merges into its creation item (one Tab+type = one undo). Committing a
  brand-new node with empty text _undoes_ the creation, leaving history clean — Miro-style
  "Enter on empty node ends the outliner chain".
- **Deleted subtrees fade out in place** (alpha+scale, 120ms) including their connectors,
  via an `exiting` list the renderer paints after live nodes. They don't drift toward the
  parent — geometry stays put, which reads calmer next to the simultaneous reflow.
- **Collapse tweens children into the nearest visible ancestor** and back out on expand
  (`vanishing` flag keeps them painted while animating out, spatial index drops them
  immediately so hit-testing is correct).
- **The mirror rebuilds derived data (children/depth/colors/counts) globally per change
  batch** rather than per-subtree: it's a linear pass over plain objects (sub-ms at 1k
  nodes); layout — the expensive part — stays scoped to dirty roots per SPEC §6.

## M3 — Drag interactions

- **Drop-candidate model** (matches Miro's documented behavior — see ROADMAP.md research
  notes): hovering a node directly targets it (drop = become its child); hovering near a
  node but not past its outward edge targets the node's _parent_ (drop = become a sibling,
  with the insertion index from the pointer's cross-axis position). Nothing within 80
  screen px → no preview, drop reverts animated.
- **The insertion gap is real layout, not a drawing trick:** during a drag the mirror lays
  out with the dragged subtree removed and a phantom slot (sized like the dragged node)
  spliced into the candidate — siblings shift apart via the normal 180 ms tween machinery.
  A dashed outline marks the phantom slot.
- **Insertion indexes count a defined universe** — auto-layout, non-dragged children,
  side-filtered for both-sides roots — shared verbatim between preview layout and the drop
  commit so what you see is exactly what commits.
- **Plain-dragging a root live-moves the whole tree** (no ghost, no reparent targets) per
  SPEC §9's parenthetical; merging two maps by dropping a root onto a node is deferred.
- **Free-move commits restore-then-write** (like text edits) so the tracked transaction
  captures pre-drag → final; mid-drag writes are ephemeral. Undo of a first-time free-move
  returns the node to `layout:'auto'`.
- **Alt+drag duplicates before dragging** (one tracked step), then drags the copies.
- **Clipboard is app-internal for v1** (module state, not the system clipboard); paste
  targets the selected node as parent or pastes floating roots at the viewport center.
- **Left-drag on empty canvas is now marquee** (M1's temporary pan behavior removed);
  Shift+marquee adds to the selection.

## M4 — Connectors & structure

- **Affordances follow Miro's verified pattern** (see ROADMAP.md research log): hover/select
  shows "–" (collapse) and "+" (add child, = Tab) on the outward edge; collapsed nodes show
  the descendant-count badge in the – slot and clicking it expands. One geometry function
  (`affordanceAt`) is shared by painting and hit-testing.
- **The cross-link drag handle is a single dot on the top edge** — the outward edge is
  already occupied by +/– and the badge. Drop on a node creates the link (arrow at end,
  solid); drop on empty cancels.
- **Cross-links anchor on the box edge along the center-to-center ray** with control points
  along that edge's outward normal (`max(24, dist·0.35)` reach) — close enough to "nearest
  edges" §7 while staying smooth at every relative position.
- **Cross-links are painted in the muted gray**, not branch colors, so structure edges stay
  the loud thing; selection turns them accent. Labels sit on a white pill at t=0.5.
- **Link label editing is an inline input at the link midpoint** (double-click). Dash/arrow
  toggles land in the M5 context toolbar (mutations already exist).
- **Links to hidden (collapsed-away) or mid-drag nodes are not painted**; deleting a node
  cascades to its links inside the same transaction (single undo step restores both).
- **Connector draw-in**: new edges fade in with their child's enter animation; the §12
  stroke-dash reveal is deferred to the M7 polish pass (needs per-edge reveal state).

## M5 — Styling & chrome

- **Chrome reactivity = mirror version + subscribe.** The mirror got a `subscribe()`
  listener set fired on every version bump; React chrome uses it via
  `useSyncExternalStore` (`useMirrorVersion`) and reads mirror data directly during
  render. No document state is copied into React state.
- **Spacing tokens live in Yjs meta** as four flat fields (consistent with the M2
  flat-`textStyle` call), clamped on read AND write; the mirror observes meta and
  reflows every root when they change. Slider drags write ephemerally and commit
  restore-then-write on release — one undo step per drag, like free-move.
- **Chrome buttons never steal canvas focus**: `preventDefault()` on pointerdown
  (Figma/Miro pattern), so Tab/Enter keep creating nodes right after a toolbar click.
  Keyboard users can still Tab into chrome; `input.ts` ignores key events originating
  inside `[data-chrome]` so chrome-focused keys don't double as canvas shortcuts.
- **Context toolbar tracks the selection per frame** (rAF writing `transform`, no React
  re-render) and flips below the selection when clipped by the top bar; popovers read
  the flip via `data-placement` and always open away from the selection. It hides
  mid-gesture (marquee/drags) via a `gesture` mirror of the interaction-machine state
  in the UI store, and while the text editor owns the node.
- **Toolbar scope mirrors Miro's verified pattern** (see ROADMAP research log): common
  controls inline (color, shape pill/rounded/rect, text size/bold), root-only controls
  (direction, connector style, auto-layout) appear only when a root is selected, and
  the right slide-in panel holds the full set + board spacing. Multi-select applies
  styles to every selected node in one transaction = one undo step; mixed values show
  an indeterminate swatch / no highlight.
- **Auto-layout toggle state is implicit** — ON while any direct child of the root still
  has `layout:'auto'` — so no schema field was added; toggling OFF freezes direct
  children at their current offsets (their subtrees keep auto-laying-out beneath them,
  SPEC §6), ON releases all of them. "Layout nodes" clears manual offsets across the
  selected subtrees but never a root's `mx/my` (that's its board position).
- **Switching a root to `dir:'both'` redistributes depth-1 sides** (greedy
  subtree-height balance, first branch right): sides from a single-direction layout are
  stale, and unfolding everything on one side reads broken. Side choices are preserved
  while dir stays `both`.
- **Tools are one-shot** (add-topic, link): they apply on the next canvas press, then
  revert to select; Esc cancels. Letter shortcuts for tools are deliberately absent —
  SPEC §9 reserves bare letters for type-to-edit on the selection.
- **Right-click selects its target** before opening the context menu (node or link),
  matching Miro; the menu closes on outside press, Esc (one layer at a time:
  menu → gesture → tool → selection), wheel, any other key, or when undo removes its
  target. Right-click on empty canvas intentionally shows nothing in v1.
- **Search/export/share are visible-but-disabled** top-bar placeholders (export/search
  land in M6, share with Stage-2 collaboration) so the §12 layout is final without
  dead-looking gaps later. Floating chrome forwards wheel events to the canvas
  (non-passive) — no pan/zoom dead zones over the toolbars.

## M6 — Persistence, boards, I/O, search, dark mode

- **`COLORS` is a live-mutated theme object** (`Object.assign` on switch), not a set of
  constants: every canvas paint site keeps reading `COLORS.*` per frame with zero call
  site churn. Roots with no explicit color store the `'auto-root'` sentinel in
  `effectiveColor`; `resolveNodeColor()` maps it to the theme's `rootFill` at paint time
  (light: ink chip, dark: paper chip). Node text uses luminance-based `textOnFill()` so
  custom fills stay readable in both themes. CSS gets the same values via
  `:root[data-theme='dark']` custom-property overrides; the dot-grid pattern cache keys
  on the dot color and remakes tiles on switch. First paint honors
  localStorage → `prefers-color-scheme`.
- **Exports always use the light palette** (swap-and-restore around the offscreen
  paint): shared artifacts shouldn't depend on the author's theme.
- **One IndexedDB database per board** (`nodeflow-board-<id>`, y-indexeddb), with a
  localStorage **registry** (id, name, timestamps, JPEG thumbnail ≤ ~13 KB) so the home
  grid renders without opening any doc. Hash routing (`#/` home, `#/board/:id`)
  needs no router dependency. Board chrome mounts only after the doc syncs (async
  open), keyed remounts per board id.
- **Viewport restore must not wait for a frame**: rAF never fires on hidden pages
  (background-tab opens), and the pagehide snapshot would persist the default camera
  over the saved one. The camera restores synchronously in `createEngine`; only
  fit-to-content (which needs a measured canvas) stays in the rAF. Found by the
  preview browser running hidden — a real background-tab bug.
- **Autosave indicator is honest-but-simple**: any doc update → "Saving…", 700 ms of
  quiet → "Saved" (y-indexeddb exposes no flush event; IndexedDB writes are
  fast-local). Registry name/updatedAt sync is debounced 1 s off mirror updates;
  thumbnails regenerate on board close and pagehide.
- **Home renames write through to the closed doc** (`renameClosedBoard` opens the doc,
  sets meta, closes): registry-only renames would be overwritten by the doc's name on
  next open. Delete is a two-click in-place confirm (3 s window) — no modal, and
  board deletion is intentionally not undoable (idb wipe).
- **Import always creates a new board** (Miro-style "create from file"), never merges
  into the current one; failed imports delete their half-created board. Format
  detection: extension first, then content sniffing (`{` → JSON, `<opml`/`<?xml` →
  OPML, else Markdown outline). The Markdown parser accepts headings + any
  bullet/indent mix (tabs or spaces, indent-width stack); our own exports round-trip,
  including `<br>`-folded multi-line text and cross-link footnotes (stripped on
  import). OPML uses `_collapsed`/`_color` custom attrs and reads OPML-1 `title`.
  JSON re-keys all node ids on import (collision-free), preserving sibling order via
  stable depth sort.
- **SVG export is true vector** built from the same geometry functions the canvas uses
  (connector controls, wrapped text lines); Inter is referenced with system fallbacks,
  not embedded. **PDF is a hand-rolled single page embedding the @2x JPEG**
  (DCTDecode) — matches Miro's standard-quality raster PDF without a dependency;
  vector PDF needs font embedding and is deferred. CSV keeps structure as
  `depth,text,parent` rows (RFC 4180).
- **Search jumps are view actions**: revealing a match inside a collapsed subtree
  expands ancestors with the ephemeral (untracked) origin so Cmd/Ctrl+F never creates
  undo entries. The jump is an instant center (zoom clamped to 0.75–1.5) plus a
  renderer-driven double ring pulse (~1.2 s, self-scheduling frames); fuzzy scoring
  favors exact substrings, word starts and contiguity, and the palette stays open —
  Enter cycles matches, Esc closes.
