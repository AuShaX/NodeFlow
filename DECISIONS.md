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
