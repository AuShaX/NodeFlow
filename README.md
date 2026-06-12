# Nodeflow

A fast, local-first mind-mapping app with Miro-grade interaction feel: animated tidy-tree
layout, drag-to-reparent with live insertion gaps, cross-links, per-branch styling, dark
mode, multi-board persistence, nine export formats, and full keyboard-first editing —
rendered on a single canvas at 120 fps.

Built on **Yjs** (CRDT document, ready for real-time collaboration), **React** (chrome
only — the canvas is framework-free), **Vite** and **TypeScript**.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit suite
npm run build      # production build
```

First launch seeds a demo board. Everything persists locally (IndexedDB per board,
registry + viewports in localStorage) — no server, no account.

## Keyboard shortcuts

`Mod` = ⌘ on macOS, Ctrl elsewhere.

### Create & edit

| Keys | Action |
| --- | --- |
| `Tab` | Add a child to the selected node |
| `Enter` | Add a sibling after the selected node |
| `Shift+Tab` | Select the parent |
| *type anything* | Start editing the selected node, replacing its text |
| `F2` | Edit the selected node (cursor at end) |
| `Enter` (while editing) | Commit, then chain a sibling |
| `Tab` (while editing) | Commit, then chain a child |
| `Shift+Enter` (while editing) | New line inside the node |
| `Esc` (while editing) | Commit and exit |
| Double-click empty canvas | New floating topic |
| Double-click a node | Edit it |

### Structure

| Keys | Action |
| --- | --- |
| `Delete` / `Backspace` | Delete selection (subtree) or selected link |
| `.` or `Mod+/` | Collapse / expand the selected branch |
| `Mod+↑` / `Mod+↓` | Reorder among siblings |
| `Mod+C` / `Mod+X` / `Mod+V` | Copy / cut / paste subtree (paste at viewport center) |
| `Mod+D` | Duplicate selection |
| Drag a node | Reparent (live insertion gap) — release in open space to place it freely |
| `Mod`+drag a node | Free-move without reparenting |
| `Alt`+drag a node | Drag a duplicate |
| `Esc` (mid-drag) | Cancel the gesture |

### Navigate & view

| Keys | Action |
| --- | --- |
| Arrow keys | Move selection spatially across the map |
| `Mod+F` | Search the board (fuzzy; `Enter` jumps & cycles) |
| `Mod+A` | Select all visible nodes |
| `Esc` | Peel one layer: menu → gesture → tool → selection |
| `Mod+0` | Fit map to view |
| `Mod+1` | Zoom to 100% |
| `Mod+Z` / `Shift+Mod+Z` | Undo / redo |
| `Space`+drag / middle-drag | Pan |
| Wheel / two-finger scroll | Pan |
| `Mod`+wheel / pinch | Zoom toward cursor |
| Touch: one finger | Drag nodes, pan on empty canvas |
| Touch: two fingers | Pinch-zoom around the midpoint |
| `Mod+Shift+D` | Debug HUD (fps, painted nodes, layout ms) |

### Mouse

| Gesture | Action |
| --- | --- |
| Click | Select node or link (`Shift` toggles multi-select) |
| Drag on empty | Marquee select |
| Right-click | Context menu (node or link) |
| Hover edge dot → drag | Draw a cross-link |
| Click collapse badge | Expand / collapse |

## Collaboration (optional)

Nodeflow is local-first; multiplayer is one command away:

```bash
npm run sync-server                      # ws://localhost:1234, rooms in server/data/
VITE_SYNC_URL=ws://localhost:1234 npm run dev
```

(or set `localStorage['nodeflow-sync-url']` and reload). Then **Share → Copy board
link** — anyone opening the link on the same server joins live: named cursors, remote
selections, editing indicators, presence avatars. Undo stays per-user. No accounts
yet — anyone with a board id can join its room (auth lands with Stage 3).

## Boards, I/O, theming

- **Board home** (`#/`): create, rename, duplicate, delete; thumbnails refresh on close.
- **Export**: PNG (2×, optional transparent), JPG, SVG (true vector), PDF, Markdown
  outline, OPML, CSV, full-fidelity Nodeflow JSON.
- **Import**: Markdown outline (headings + any bullet style), OPML, Nodeflow JSON —
  paste or pick a file; format auto-detected; always creates a new board.
- **Dark mode**: follows the system, toggleable in the top bar, persisted.
- `prefers-reduced-motion` disables all tweens.

## Architecture (short version)

```
input → interaction machine → mutation API (Yjs transact)
      → observers update the mirror → incremental tidy layout
      → animator tweens render fields → canvas renderer paints
```

React renders chrome only and reads the document through a versioned mirror
subscription. The renderer reads only mirror + animator + UI store — no Yjs in the hot
path, no React on the canvas. See `SPEC.md` (the v1 contract), `DECISIONS.md` (running
log of non-obvious choices, with measured §13 performance numbers) and `ROADMAP.md`
(stages beyond v1: realtime collaboration, accounts, whiteboard objects).

Verified at 1,000 nodes: 106 ms cold load, 2–4 ms full relayout, 120 fps interactions,
zero idle paints.
