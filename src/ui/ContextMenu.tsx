import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine'
import { engineRef } from '../engine'
import type { ContextMenu as ContextMenuState } from '../state/store'
import { hideContextMenu, uiStore, useUI } from '../state/store'
import { clipboardHasContent } from '../doc/clipboard'
import { useDismiss } from './hooks'

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

interface Item {
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  run: () => void
}
type Entry = Item | 'sep'

/** Right-click menu for nodes and cross-links (opened by the interaction machine). */
export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu)
  const engine = engineRef.current
  if (!menu || !engine) return null
  return <Menu key={`${menu.targetId}:${menu.x},${menu.y}`} menu={menu} engine={engine} />
}

function Menu({ menu, engine }: { menu: ContextMenuState; engine: Engine }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, hideContextMenu, true)

  // Clamp into the viewport, then take focus so arrows work immediately.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    el.style.left = `${Math.min(menu.x, window.innerWidth - w - 8)}px`
    el.style.top = `${Math.min(menu.y, window.innerHeight - h - 8)}px`
    el.focus()
  }, [menu])

  const entries =
    menu.targetType === 'node'
      ? nodeEntries(engine, menu.targetId)
      : linkEntries(engine, menu.targetId)

  const moveFocus = (delta: 1 | -1): void => {
    const el = ref.current
    if (!el) return
    const items = [...el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = items[(i + delta + items.length) % items.length]
    next.focus()
  }

  return (
    <div
      ref={ref}
      className="menu"
      data-chrome
      role="menu"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          moveFocus(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          moveFocus(-1)
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === 'sep' ? (
          <div key={`sep${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className={'menu-item' + (entry.danger ? ' is-danger' : '')}
            disabled={entry.disabled}
            onClick={() => {
              hideContextMenu()
              entry.run()
            }}
          >
            <span className="menu-check">{entry.checked ? '✓' : ''}</span>
            <span className="menu-label">{entry.label}</span>
            {entry.shortcut && <kbd className="menu-kbd">{entry.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  )
}

function nodeEntries(engine: Engine, targetId: string): Entry[] {
  const m = engine.board.mirror
  const a = engine.actions
  const node = m.nodes.get(targetId)
  if (!node) return []
  const selection = (): string[] => [...uiStore.getState().selection]
  const isRoot = node.parentId === null
  const hasKids = node.childrenIds.length > 0

  const entries: Entry[] = [
    { label: 'Add child', shortcut: 'Tab', run: () => a.addChild(targetId) },
  ]
  if (!isRoot) {
    entries.push(
      { label: 'Add sibling', shortcut: '↵', run: () => a.addSiblingAfter(targetId) },
      { label: 'Insert node before', run: () => a.insertNodeBefore(targetId) },
    )
  }
  entries.push('sep')
  if (hasKids) {
    entries.push({
      label: node.collapsed ? 'Expand branch' : 'Collapse branch',
      shortcut: '.',
      run: () => a.toggleCollapse(targetId),
    })
  }
  entries.push({
    label: 'Layout nodes',
    disabled: !a.hasManualInSubtrees(selection()),
    run: () => a.layoutNodes(selection()),
  })
  entries.push('sep')
  entries.push(
    { label: 'Copy', shortcut: `${mod}C`, run: () => a.copySelection() },
    { label: 'Cut', shortcut: `${mod}X`, run: () => a.cutSelection() },
    {
      label: 'Paste as child',
      shortcut: `${mod}V`,
      disabled: !clipboardHasContent(),
      run: () => a.paste(),
    },
    { label: 'Duplicate', shortcut: `${mod}D`, run: () => a.duplicateSelection() },
  )
  entries.push('sep')
  entries.push({ label: 'Delete', shortcut: '⌫', danger: true, run: () => a.deleteSelection() })
  return entries
}

function linkEntries(engine: Engine, linkId: string): Entry[] {
  const a = engine.actions
  const link = engine.board.mirror.links.find((l) => l.id === linkId)
  if (!link) return []
  return [
    { label: 'Edit label', run: () => uiStore.setState({ editingLinkId: linkId }) },
    'sep',
    { label: 'Solid', checked: link.style === 'solid', run: () => a.setLinkStyle(linkId, 'solid') },
    {
      label: 'Dashed',
      checked: link.style === 'dashed',
      run: () => a.setLinkStyle(linkId, 'dashed'),
    },
    'sep',
    {
      label: 'No arrows',
      checked: link.arrow === 'none',
      run: () => a.setLinkArrow(linkId, 'none'),
    },
    {
      label: 'Arrow at end',
      checked: link.arrow === 'end',
      run: () => a.setLinkArrow(linkId, 'end'),
    },
    {
      label: 'Arrows both ways',
      checked: link.arrow === 'both',
      run: () => a.setLinkArrow(linkId, 'both'),
    },
    'sep',
    { label: 'Delete link', shortcut: '⌫', danger: true, run: () => a.deleteLinkById(linkId) },
  ]
}
