// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Animator } from '../engine/animator'
import { setMeasureFunction } from '../engine/textMeasure'
import { createBoard } from './board'
import type { Board } from './board'
import { createLink, createNode, getSpacing, setSpacing } from './schema'
import {
  detectImportFormat,
  exportCSV,
  exportJSON,
  exportMarkdown,
  exportOPML,
  importJSON,
  importMarkdown,
  importOPML,
  parseMarkdownOutline,
  parseOPML,
} from './io'
import { fuzzyMatch } from '../ui/fuzzy'

let board: Board

beforeEach(() => {
  setMeasureFunction((text) => text.length * 8)
  board = createBoard(new Animator(), () => {}, new Y.Doc())
})

afterEach(() => {
  board.destroy()
  setMeasureFunction(null)
})

const freshBoard = (): Board => createBoard(new Animator(), () => {}, new Y.Doc())

const seed = () => {
  const root = createNode(board.bd, null, { text: 'Launch plan' })
  const a = createNode(board.bd, root, { text: 'Marketing', side: 'right' })
  const b = createNode(board.bd, root, { text: 'Engineering', side: 'right' })
  const a1 = createNode(board.bd, a, { text: 'Landing page' })
  createNode(board.bd, a, { text: 'Email "blast" & social' })
  createLink(board.bd, a1, b, { label: 'depends on' })
  return { root, a, b, a1 }
}

describe('markdown', () => {
  it('exports an indented outline with cross-link footnotes', () => {
    seed()
    const md = exportMarkdown(board.mirror)
    expect(md).toContain('- Launch plan\n')
    expect(md).toContain('  - Marketing\n')
    expect(md).toContain('    - Landing page[^l1]')
    expect(md).toContain('[^l1]: → "Engineering" (depends on)')
  })

  it('round-trips its own export', () => {
    seed()
    const md = exportMarkdown(board.mirror)
    const trees = parseMarkdownOutline(md)
    expect(trees).toHaveLength(1)
    expect(trees[0].text).toBe('Launch plan')
    expect(trees[0].children.map((c) => c.text)).toEqual(['Marketing', 'Engineering'])
    expect(trees[0].children[0].children.map((c) => c.text)).toEqual([
      'Landing page',
      'Email "blast" & social',
    ])
  })

  it('parses headings + mixed bullets with tab indentation', () => {
    const trees = parseMarkdownOutline(
      '# Title\n- a\n\t- a1\n\t- a2\n- b\n## Section\n1. s1\n2. s2\n',
    )
    expect(trees).toHaveLength(1)
    const title = trees[0]
    expect(title.text).toBe('Title')
    expect(title.children.map((c) => c.text)).toEqual(['a', 'b', 'Section'])
    expect(title.children[0].children.map((c) => c.text)).toEqual(['a1', 'a2'])
    expect(title.children[2].children.map((c) => c.text)).toEqual(['s1', 's2'])
  })

  it('imports into a board with multi-line text restored', () => {
    const target = freshBoard()
    expect(importMarkdown(target.bd, '- one<br>two\n  - kid\n', 'T')).toBe(true)
    const root = target.mirror.rootIds[0]
    expect(target.mirror.nodes.get(root)!.text).toBe('one\ntwo')
    expect(target.mirror.nodes.get(root)!.childrenIds).toHaveLength(1)
    target.destroy()
  })

  it('rejects empty input', () => {
    const target = freshBoard()
    expect(importMarkdown(target.bd, '\n\n', 'T')).toBe(false)
    target.destroy()
  })
})

describe('opml', () => {
  it('round-trips structure, escaping and collapsed state', () => {
    const { a } = seed()
    board.bd.doc.transact(() => {
      board.bd.nodes.get(a)!.set('collapsed', true)
    })
    const xml = exportOPML(board.mirror, 'My <Plan> & Co')
    const parsed = parseOPML(xml)
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe('My <Plan> & Co')
    expect(parsed!.trees[0].text).toBe('Launch plan')
    const marketing = parsed!.trees[0].children[0]
    expect(marketing.text).toBe('Marketing')
    expect(marketing.collapsed).toBe(true)
    expect(marketing.children.map((c) => c.text)).toEqual([
      'Landing page',
      'Email "blast" & social',
    ])
  })

  it('imports OPML 1 title attributes', () => {
    const target = freshBoard()
    const ok = importOPML(
      target.bd,
      '<opml version="1.0"><head><title>Old</title></head><body><outline title="Root"><outline title="Kid"/></outline></body></opml>',
      'fallback',
    )
    expect(ok).toBe(true)
    const root = target.mirror.rootIds[0]
    expect(target.mirror.nodes.get(root)!.text).toBe('Root')
    expect(target.mirror.boardName).toBe('Old')
    target.destroy()
  })

  it('rejects non-OPML xml', () => {
    const target = freshBoard()
    expect(importOPML(target.bd, '<rss><channel/></rss>', 'x')).toBe(false)
    expect(importOPML(target.bd, 'not xml at all', 'x')).toBe(false)
    target.destroy()
  })
})

describe('csv', () => {
  it('quotes per RFC 4180 and keeps depth + parent text', () => {
    seed()
    const csv = exportCSV(board.mirror)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('depth,text,parent')
    expect(lines[1]).toBe('0,"Launch plan",""')
    expect(lines).toContain('1,"Marketing","Launch plan"')
    expect(lines).toContain('2,"Email ""blast"" & social","Marketing"')
  })
})

describe('json', () => {
  it('round-trips nodes, links, styling and spacing with fresh ids', () => {
    const { root, a } = seed()
    board.bd.doc.transact(() => {
      board.bd.nodes.get(a)!.set('shape', 'rect')
      board.bd.nodes.get(a)!.set('textSize', 'lg')
      board.bd.nodes.get(root)!.set('dir', 'down')
    })
    setSpacing(board.bd, { levelGap: 80 })
    const json = exportJSON(board.bd, board.mirror)

    const target = freshBoard()
    expect(importJSON(target.bd, json, 'fallback')).toBe(true)
    const m = target.mirror
    // source board has no meta name → export writes 'Untitled', import keeps it
    expect(m.boardName).toBe('Untitled')
    expect(m.rootIds).toHaveLength(1)
    const newRoot = m.nodes.get(m.rootIds[0])!
    expect(newRoot.text).toBe('Launch plan')
    expect(newRoot.dir).toBe('down')
    expect(newRoot.childrenIds.map((id) => m.nodes.get(id)!.text)).toEqual([
      'Marketing',
      'Engineering',
    ])
    const newA = m.nodes.get(newRoot.childrenIds[0])!
    expect(newA.shape).toBe('rect')
    expect(newA.textStyle.size).toBe('lg')
    // ids regenerated
    expect(m.nodes.has(root)).toBe(false)
    // links remapped
    expect(m.links).toHaveLength(1)
    expect(m.links[0].label).toBe('depends on')
    expect(m.nodes.get(m.links[0].fromId)!.text).toBe('Landing page')
    expect(m.nodes.get(m.links[0].toId)!.text).toBe('Engineering')
    expect(getSpacing(target.bd).levelGap).toBe(80)
    target.destroy()
  })

  it('rejects foreign json', () => {
    const target = freshBoard()
    expect(importJSON(target.bd, '{"foo": 1}', 'x')).toBe(false)
    expect(importJSON(target.bd, 'nope', 'x')).toBe(false)
    target.destroy()
  })
})

describe('detectImportFormat', () => {
  it('prefers the filename extension', () => {
    expect(detectImportFormat('a.json', '- list')).toBe('json')
    expect(detectImportFormat('a.opml', '- list')).toBe('opml')
    expect(detectImportFormat('a.md', '{}')).toBe('markdown')
  })
  it('sniffs pasted content', () => {
    expect(detectImportFormat(null, '  {"app":"nodeflow"}')).toBe('json')
    expect(detectImportFormat(null, '<?xml version="1.0"?><opml/>')).toBe('opml')
    expect(detectImportFormat(null, '<opml version="2.0"></opml>')).toBe('opml')
    expect(detectImportFormat(null, '- hello\n  - world')).toBe('markdown')
  })
})

describe('fuzzyMatch', () => {
  it('ranks exact substring above scattered subsequence', () => {
    const sub = fuzzyMatch('Landing page', 'land')!
    const scattered = fuzzyMatch('Legal and compliance', 'land')!
    expect(sub.score).toBeGreaterThan(scattered.score)
  })
  it('is case-insensitive and returns highlight indices', () => {
    const m = fuzzyMatch('Email blast', 'blast')!
    expect([...m.indices]).toEqual([6, 7, 8, 9, 10])
  })
  it('returns null when not a subsequence', () => {
    expect(fuzzyMatch('Marketing', 'xyz')).toBeNull()
  })
})
