# Nodeflow — Product Roadmap

**North star:** grow Nodeflow from the SPEC.md v1 mind-map tool into a Miro-class visual
collaboration service, sold as a subscription. SPEC.md stays the v1 contract; this file
tracks everything beyond it — competitive research, stage planning, and architecture bets
that keep the SaaS path open. Update it whenever research or direction changes.

## Stages

### Stage 1 — v1 mind-map tool (current, SPEC.md M1–M7)

Local-first, single-user, canvas mind mapping with Miro-grade interaction feel.
Status: M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅ · M5 ✅ · M6 ✅ · M7 pending.

### Stage 2 — Real-time collaboration

The document model is already Yjs precisely for this (SPEC §2). Work items:

- Sync provider: `y-websocket` (self-hosted) or a managed offering (Liveblocks/PartyKit/
  y-sweet); evaluate cost + auth story before committing.
- Presence: cursors with names/colors, live selections, follow-mode. Yjs `awareness` API.
- Conflict UX: Yjs handles merge; we need visual affordances (who's editing this node).
- Server: start with a thin Node/Bun websocket relay + persistence to object storage
  (y-websocket has leveldb persistence; S3-compatible snapshot + update-log is the
  scalable shape).
- Undo scoping: per-user undo (Y.UndoManager trackedOrigins already keyed by origin —
  extend to per-client origins).

### Stage 3 — Accounts, boards, sharing

- Auth (email + OAuth), workspaces/teams, board permissions (view/comment/edit).
- Board sharing links à la Miro (public read-only, invite-to-edit).
- Billing: subscription tiers (free with board limit → paid unlimited + team features),
  Stripe. Miro's free tier is 3 editable boards — a proven shape.

### Stage 4 — Beyond mind maps (whiteboard objects)

Miro's mind map is one tool on a general canvas. Our engine is already a general
canvas + scene graph; widen the object model: sticky notes, shapes, text, frames,
connectors between arbitrary objects, images. The mind-map layout engine becomes one
"smart object" among several. This is the biggest architectural step — keep `NodeView`/
renderer generic enough that a `kind` discriminator can slot in.

### Stage 5 — Distribution & polish

- Templates gallery, import from competitors (Miro/Mural/XMind formats where feasible),
  Markdown/CSV importers (M6 already builds the Markdown path).
- Embeds, REST/Web SDK for integrations (Miro's developer platform is a moat — long-term).

## Research notes (running log)

### 2026-06-11 — Miro mind-map drag behavior

Verified against Miro Help Center + community threads before building M3:

- Default drag **reparents**; dropping a node onto another node makes it a child.
- **Ctrl/Cmd+drag moves the node without reassigning** (matches SPEC §9 free-move).
- When dropping onto another branch, the **side relative to the root** decides left/right
  attachment.
- Holding the button and moving away **cancels** the pending attach — preview must be
  non-committal until drop. Our implementation mirrors all four.

Sources: [Miro Help: Mind map](https://help.miro.com/hc/en-us/articles/360017730753-Mind-map),
[Miro community: move element between levels](https://community.miro.com/ask-the-community-45/can-i-move-a-mind-map-element-from-one-level-to-another-397),
[Miro community: reassign parent](https://community.miro.com/ask-the-community-45/mind-map-how-can-i-select-another-node-to-be-the-parent-node-4030).

### 2026-06-12 — Miro mind-map styling surface (M5 chrome)

Checked against Miro Help Center + community threads before building the context
toolbar:

- Node customization rides the **context menu/toolbar on the selection**: change style
  and color, text styling; **Delete** lives behind the three-dots overflow as well as
  the keyboard.
- Node shapes are exactly three: **square, rounded square, pill** — matches our SPEC
  `rect | rounded | pill`.
- Right-clicking a node opens customization options (color, font size); community
  threads confirm color/text options are per-node with branch inheritance.

Our deviations, on purpose: adjustable per-board spacing (fixed in Miro — a top user
complaint) and an explicit auto-layout freeze/release toggle on roots.

Sources: [Miro Help: Mind map](https://help.miro.com/hc/en-us/articles/360017730753-Mind-map),
[Miro community: change mind map appearance](https://community.miro.com/ask-the-community-45/how-to-change-mind-map-s-appearance-13621),
[Guideflow: change node style/color in Miro](https://www.guideflow.com/tutorial/how-to-change-the-style-and-color-of-a-node-in-a-miro-mind-map).

### Open research questions (next passes)

- Miro mind map: exact collapse/expand affordances and badge styling (before M4). ✅ M4
- Miro cross-link ("connector") editing UX: label placement, arrow toggles (M4). ✅ M4
- Miro toolbar/context-menu layout for mind maps (M5 chrome). ✅ M5 (see above)
- Pricing teardown: Miro/FigJam/Whimsical tiers and limits (Stage 3 design input).
- Multiplayer providers comparison: y-websocket vs Liveblocks vs PartyKit costs at small
  scale (Stage 2).

### 2026-06-12 — Miro export surface (M6 I/O scope)

Verified against Miro Help Center before building the export menu: Miro boards export
to **image (PNG/JPG), vector/PDF, and CSV** (mind-map/table contexts), with
high-res raster behind paid tiers; there is no Markdown/OPML export. Nodeflow ships
**PNG (2×), transparent PNG, JPG, SVG (true vector), PDF** plus text formats Miro
lacks — **Markdown, OPML, CSV, full-fidelity JSON** — because mind-map users
round-trip with outliners (workflowy/obsidian) constantly. Import: Markdown / OPML /
Nodeflow JSON, file-or-paste, always into a new board (Miro's "create from" pattern).

M6 shipped: theme system + dark mode, board home (registry + thumbnails +
rename/duplicate/delete), per-board y-indexeddb persistence with viewport restore and
autosave indicator, the full export/import surface above, and Cmd/Ctrl+F fuzzy search
with collapse-revealing pulse jumps. 117 tests green.

### 2026-06-12 — Drag UX feedback round (post-M6)

User testing against Miro surfaced three drag flaws, all shipped in the M6 follow-up:

- **Out-of-range drops used to revert silently** while the parked ghost kept painting at
  the drop point (layout slots unchanged → no re-tween) — the map showed a move that
  never happened, with dead selection at the visible spot. Now an open-space release
  *places* the subtree there (tracked manual offset, exact under-cursor anchoring), and
  relayout re-tweens whenever render ≠ slot.
- **Manual subtrees now orient by actual position** (children flip outward when a branch
  crosses its parent), and depth-1 crossings of a both-root rewrite `side`.
- **Live drag connector** to the candidate/current parent — the ghost never floats.

Miro parity check: Miro keeps the edge attached during drags and lets free drops stick
where released; we now match both and keep the insertion-gap preview Miro lacks at
sibling level.
