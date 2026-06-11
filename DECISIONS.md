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
