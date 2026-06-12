import type { BoardDoc } from './schema'
import {
  createLink,
  createNode,
  getSpacing,
  initMeta,
  openBoardDoc,
  seedOrigin,
  setSpacing,
} from './schema'
import type { BoardMeta } from './boards'
import {
  createBoardEntry,
  deleteBoard,
  getBoardMeta,
  openPersistentBoard,
  upsertBoardMeta,
} from './boards'
import type { Mirror } from './mirror'
import type {
  ArrowStyle,
  ConnectorStyle,
  LayoutDir,
  LinkStyle,
  Shape,
  Side,
  TextSize,
} from '../types'

/**
 * Text-format I/O (SPEC §11 + M6 scope): Markdown outline, OPML 2.0, CSV and
 * full-fidelity JSON. Importers are tolerant parsers (paste anything indented,
 * get a map); exporters round-trip through their matching importer.
 */

// ============================================================ shared helpers

interface TreeSpec {
  text: string
  collapsed?: boolean
  color?: string | null
  children: TreeSpec[]
}

/** Materialize parsed trees into a board (one transaction, not undoable on import-seed). */
export function materializeTrees(bd: BoardDoc, trees: TreeSpec[], origin = seedOrigin): void {
  bd.doc.transact(() => {
    const addTree = (spec: TreeSpec, parentId: string | null, index: number): void => {
      const id = createNode(
        bd,
        parentId,
        {
          text: spec.text,
          collapsed: spec.collapsed ?? false,
          ...(spec.color !== undefined ? { color: spec.color } : {}),
          ...(parentId === null ? { mx: 0, my: index * 240 } : {}),
        },
        undefined,
        origin,
      )
      for (const child of spec.children) addTree(child, id, 0)
    }
    trees.forEach((t, i) => addTree(t, null, i))
  }, origin)
}

const visibleChildren = (m: Mirror, id: string): string[] => m.nodes.get(id)?.childrenIds ?? []

// ================================================================== Markdown

/**
 * Indented `-` list, depth = nesting (SPEC §11). Multi-line node text folds to
 * `<br>`; cross-links become footnotes on the source line with definitions at
 * the bottom.
 */
export function exportMarkdown(m: Mirror): string {
  const lines: string[] = []
  const footnotes: string[] = []
  const refsByNode = new Map<string, number[]>()
  m.links.forEach((l, i) => {
    const n = i + 1
    const target = m.nodes.get(l.toId)
    if (!target) return
    const label = l.label ? ` (${l.label})` : ''
    footnotes.push(`[^l${n}]: → "${oneLine(target.text)}"${label}`)
    const arr = refsByNode.get(l.fromId) ?? []
    arr.push(n)
    refsByNode.set(l.fromId, arr)
  })

  const walk = (id: string, depth: number): void => {
    const n = m.nodes.get(id)
    if (!n) return
    const refs = (refsByNode.get(id) ?? []).map((i) => `[^l${i}]`).join('')
    lines.push(`${'  '.repeat(depth)}- ${oneLine(n.text) || 'Untitled'}${refs}`)
    for (const c of n.childrenIds) walk(c, depth + 1)
  }
  for (const rootId of m.rootIds) walk(rootId, 0)
  if (footnotes.length > 0) lines.push('', ...footnotes)
  return lines.join('\n') + '\n'
}

const oneLine = (text: string): string => text.replace(/\r?\n/g, '<br>').trim()
const fromOneLine = (text: string): string => text.replace(/<br\s*\/?>/gi, '\n').trim()

/**
 * Parse any indented outline: `-`/`*`/`+`/`1.` bullets or plain indented
 * lines (tabs or spaces), with `#` headings opening levels. Footnote
 * definitions and refs from our own exports are stripped.
 */
export function parseMarkdownOutline(text: string): TreeSpec[] {
  const roots: TreeSpec[] = []
  // stack[i] = last node at depth i
  const stack: TreeSpec[] = []
  /** indent widths seen, ascending — maps raw indent to a depth */
  const indents: number[] = []
  let headingDepth = 0
  let sawHeading = false

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    if (/^\[\^[^\]]+\]:/.test(raw.trim())) continue // footnote definition

    const heading = /^(#{1,6})\s+(.*)$/.exec(raw.trim())
    if (heading) {
      sawHeading = true
      headingDepth = heading[1].length - 1
      insert(heading[2], headingDepth)
      indents.length = 0
      continue
    }

    const m = /^([ \t]*)(?:[-*+]\s+|\d+[.)]\s+)?(.*)$/.exec(raw)
    if (!m || m[2].trim() === '') continue
    const indent = m[1].replace(/\t/g, '    ').length
    // map indent width to a depth level
    while (indents.length > 0 && indent < indents[indents.length - 1]) indents.pop()
    if (indents.length === 0 || indent > indents[indents.length - 1]) indents.push(indent)
    const listDepth = indents.length - 1
    const depth = (sawHeading ? headingDepth + 1 : 0) + listDepth
    insert(m[2], depth)
  }

  function insert(rawText: string, depth: number): void {
    const text = fromOneLine(rawText.replace(/\[\^[^\]]+\]/g, '')) // strip footnote refs
    const node: TreeSpec = { text, children: [] }
    const d = Math.min(depth, stack.length)
    if (d === 0) roots.push(node)
    else stack[d - 1].children.push(node)
    stack.length = d
    stack.push(node)
  }

  return roots
}

export function importMarkdown(bd: BoardDoc, text: string, boardName: string): boolean {
  const trees = parseMarkdownOutline(text)
  if (trees.length === 0) return false
  initMeta(bd, boardName)
  materializeTrees(bd, trees)
  return true
}

// ====================================================================== OPML

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function exportOPML(m: Mirror, boardName: string): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${xmlEscape(boardName)}</title></head>`,
    '  <body>',
  ]
  const walk = (id: string, indent: string): void => {
    const n = m.nodes.get(id)
    if (!n) return
    const attrs = [
      `text="${xmlEscape(oneLine(n.text) || 'Untitled')}"`,
      n.collapsed ? '_collapsed="true"' : '',
      n.color ? `_color="${xmlEscape(n.color)}"` : '',
    ]
      .filter(Boolean)
      .join(' ')
    const kids = visibleChildren(m, id)
    if (kids.length === 0) {
      out.push(`${indent}<outline ${attrs}/>`)
    } else {
      out.push(`${indent}<outline ${attrs}>`)
      for (const c of kids) walk(c, indent + '  ')
      out.push(`${indent}</outline>`)
    }
  }
  for (const rootId of m.rootIds) walk(rootId, '    ')
  out.push('  </body>', '</opml>', '')
  return out.join('\n')
}

export function parseOPML(xml: string): { name: string | null; trees: TreeSpec[] } | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror')) return null
  const body = doc.querySelector('opml > body, body')
  if (!body) return null
  const toSpec = (el: Element): TreeSpec => ({
    // `text` is the OPML 2 standard; fall back to `title` (OPML 1 producers)
    text: fromOneLine(el.getAttribute('text') ?? el.getAttribute('title') ?? ''),
    collapsed: el.getAttribute('_collapsed') === 'true',
    ...(el.getAttribute('_color') ? { color: el.getAttribute('_color') } : {}),
    children: [...el.children].filter((c) => c.tagName === 'outline').map(toSpec),
  })
  const trees = [...body.children].filter((c) => c.tagName === 'outline').map(toSpec)
  if (trees.length === 0) return null
  return { name: doc.querySelector('head > title')?.textContent?.trim() || null, trees }
}

export function importOPML(bd: BoardDoc, xml: string, fallbackName: string): boolean {
  const parsed = parseOPML(xml)
  if (!parsed) return false
  initMeta(bd, parsed.name ?? fallbackName)
  materializeTrees(bd, parsed.trees)
  return true
}

// ======================================================================= CSV

/** Flat node list (depth, text, parent text) — structure-keeping, RFC 4180 quoting. */
export function exportCSV(m: Mirror): string {
  const q = (s: string): string => `"${s.replace(/"/g, '""')}"`
  const rows = ['depth,text,parent']
  const walk = (id: string, depth: number, parentText: string): void => {
    const n = m.nodes.get(id)
    if (!n) return
    rows.push(`${depth},${q(n.text)},${q(parentText)}`)
    for (const c of n.childrenIds) walk(c, depth + 1, n.text)
  }
  for (const r of m.rootIds) walk(r, 0, '')
  return rows.join('\r\n') + '\r\n'
}

// ====================================================================== JSON

export const JSON_VERSION = 1

interface JsonNode {
  id: string
  parentId: string | null
  order: string
  text: string
  shape: Shape
  color: string | null
  textSize: TextSize
  bold: boolean
  collapsed: boolean
  layout: 'auto' | 'manual'
  mx: number
  my: number
  side: Side | null
  dir: LayoutDir | null
  connectorStyle: ConnectorStyle | null
}

interface JsonLink {
  fromId: string
  toId: string
  label: string
  style: LinkStyle
  arrow: ArrowStyle
}

export interface BoardJson {
  app: 'nodeflow'
  version: number
  name: string
  spacing: ReturnType<typeof getSpacing>
  nodes: JsonNode[]
  links: JsonLink[]
}

export function exportJSON(bd: BoardDoc, m: Mirror): string {
  const nodes: JsonNode[] = []
  for (const id of m.paintList) {
    const n = m.nodes.get(id)
    if (!n) continue
    nodes.push({
      id: n.id,
      parentId: n.parentId,
      order: n.order,
      text: n.text,
      shape: n.shape,
      color: n.color,
      textSize: n.textStyle.size,
      bold: n.textStyle.bold,
      collapsed: n.collapsed,
      layout: n.layout,
      mx: n.mx,
      my: n.my,
      side: n.side,
      dir: n.dir,
      connectorStyle: n.connectorStyle,
    })
  }
  const links: JsonLink[] = m.links.map((l) => ({
    fromId: l.fromId,
    toId: l.toId,
    label: l.label,
    style: l.style,
    arrow: l.arrow,
  }))
  const out: BoardJson = {
    app: 'nodeflow',
    version: JSON_VERSION,
    name: m.boardName || 'Untitled',
    spacing: getSpacing(bd),
    nodes,
    links,
  }
  return JSON.stringify(out, null, 2)
}

// ======================================================== import → new board

export type ImportFormat = 'markdown' | 'opml' | 'json'

/** Filename extension first, then content sniffing — paste needs no filename. */
export function detectImportFormat(filename: string | null, text: string): ImportFormat {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'json') return 'json'
  if (ext === 'opml' || ext === 'xml') return 'opml'
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return 'markdown'
  const t = text.trimStart()
  if (t.startsWith('{')) return 'json'
  if (/<opml[\s>]/i.test(t) || /^<\?xml/i.test(t)) return 'opml'
  return 'markdown'
}

export interface ImportResult {
  ok: boolean
  meta?: BoardMeta
  error?: string
}

/** Create a new persisted board from imported text; cleans up on failure. */
export async function importBoardFromText(
  text: string,
  filename: string | null,
): Promise<ImportResult> {
  if (text.trim() === '') return { ok: false, error: 'Nothing to import.' }
  const format = detectImportFormat(filename, text)
  // pasted text has no filename — name the board after its first topic
  const firstTopic = format === 'markdown' ? parseMarkdownOutline(text)[0]?.text.split('\n')[0] : null
  const fallbackName =
    filename?.replace(/\.[a-z0-9]+$/i, '').trim() || firstTopic?.slice(0, 60) || 'Imported board'

  const meta = createBoardEntry(fallbackName)
  const { doc, provider } = await openPersistentBoard(meta.id)
  const bd = openBoardDoc(doc)
  const ok =
    format === 'json'
      ? importJSON(bd, text, fallbackName)
      : format === 'opml'
        ? importOPML(bd, text, fallbackName)
        : importMarkdown(bd, text, fallbackName)

  if (ok) {
    const name = (bd.meta.get('name') as string) || fallbackName
    upsertBoardMeta(meta.id, { name, updatedAt: Date.now() })
  }
  // let y-indexeddb flush the import transaction before closing
  await new Promise((r) => setTimeout(r, 100))
  provider.destroy()
  doc.destroy()
  if (!ok) {
    await deleteBoard(meta.id)
    const what =
      format === 'json'
        ? 'a Nodeflow JSON export'
        : format === 'opml'
          ? 'an OPML outline'
          : 'a Markdown outline'
    return { ok: false, error: `Couldn't read that as ${what}.` }
  }
  return { ok: true, meta: getBoardMeta(meta.id) ?? meta }
}

/** Full-fidelity import; ids are regenerated to keep them collision-free. */
export function importJSON(bd: BoardDoc, text: string, fallbackName: string): boolean {
  let data: BoardJson
  try {
    data = JSON.parse(text) as BoardJson
  } catch {
    return false
  }
  if (!data || data.app !== 'nodeflow' || !Array.isArray(data.nodes)) return false

  initMeta(bd, typeof data.name === 'string' && data.name ? data.name : fallbackName)
  const idMap = new Map<string, string>()
  bd.doc.transact(() => {
    if (data.spacing) setSpacing(bd, data.spacing, seedOrigin)
    // parents before children: sort by depth in the source structure
    const byId = new Map(data.nodes.map((n) => [n.id, n]))
    const depthOf = (n: JsonNode): number => {
      let d = 0
      let cur: JsonNode | undefined = n
      while (cur?.parentId && byId.has(cur.parentId)) {
        d++
        cur = byId.get(cur.parentId)
        if (d > data.nodes.length) break // cycle guard
      }
      return d
    }
    const sorted = [...data.nodes].sort((a, b) => depthOf(a) - depthOf(b))
    for (const n of sorted) {
      const parentNew = n.parentId ? (idMap.get(n.parentId) ?? null) : null
      const newId = createNode(
        bd,
        parentNew,
        {
          text: String(n.text ?? ''),
          shape: n.shape,
          color: n.color ?? null,
          textSize: n.textSize,
          bold: !!n.bold,
          collapsed: !!n.collapsed,
          layout: n.layout === 'manual' ? 'manual' : 'auto',
          mx: Number(n.mx) || 0,
          my: Number(n.my) || 0,
          side: n.side ?? null,
          dir: n.dir ?? null,
          connectorStyle: n.connectorStyle ?? null,
        },
        undefined,
        seedOrigin,
      )
      idMap.set(n.id, newId)
    }
    for (const l of data.links ?? []) {
      const from = idMap.get(l.fromId)
      const to = idMap.get(l.toId)
      if (!from || !to) continue
      createLink(bd, from, to, { label: l.label, style: l.style, arrow: l.arrow }, seedOrigin)
    }
  }, seedOrigin)
  return true
}
