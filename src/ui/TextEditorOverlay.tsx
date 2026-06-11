import { useEffect, useLayoutEffect, useRef } from 'react'
import { engineRef } from '../engine'
import type { EditingState } from '../state/store'
import { uiStore, useUI } from '../state/store'
import { FONT_SIZES, LINE_HEIGHTS, MAX_TEXT_WIDTH } from '../engine/textMeasure'
import { FONT_STACK } from '../theme'

/**
 * Inline node text editing (SPEC §10): a single contenteditable positioned
 * over the node with camera transforms. The canvas keeps painting the node's
 * box (text suppressed), so the swap is pixel-stable; this element tracks
 * pan/zoom/reflow every frame and triggers live relayout as the user types.
 */
export function TextEditorOverlay() {
  const editing = useUI((s) => s.editing)
  if (!editing) return null
  return <Editor key={editing.id} editing={editing} />
}

function Editor({ editing }: { editing: EditingState }) {
  const ref = useRef<HTMLDivElement>(null)
  const committed = useRef(false)

  // Mount: seed text, focus, caret at end.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = editing.initialText
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editing])

  // Track the node through pan/zoom/reflow every frame.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const sync = () => {
      raf = requestAnimationFrame(sync)
      const engine = engineRef.current
      if (!engine) return
      const node = engine.board.mirror.nodes.get(editing.id)
      if (!node) return
      const camera = uiStore.getState().camera
      const sx = (node.renderX - camera.x) * camera.zoom
      const sy = (node.renderY - camera.y) * camera.zoom
      const deep = node.depth >= 2
      const color = deep ? node.effectiveColor : '#FFFFFF'
      el.style.transform = `translate(${sx}px, ${sy}px) scale(${camera.zoom}) translate(-50%, -50%)`
      el.style.color = color
      el.style.caretColor = color
      el.style.fontSize = `${FONT_SIZES[node.textStyle.size]}px`
      el.style.lineHeight = `${LINE_HEIGHTS[node.textStyle.size]}px`
      el.style.fontWeight = node.textStyle.bold ? '600' : '500'
    }
    sync()
    return () => cancelAnimationFrame(raf)
  }, [editing.id])

  const currentText = (): string => {
    const el = ref.current
    if (!el) return ''
    // innerText preserves visual line breaks; normalize NBSP, drop trailing newline
    return el.innerText.replace(/\u00A0/g, ' ').replace(/\n$/, '')
  }

  const commit = (fn: (id: string, text: string) => void) => {
    if (committed.current) return
    committed.current = true
    fn(editing.id, currentText())
  }

  const actions = () => engineRef.current!.actions

  return (
    <div
      ref={ref}
      className="node-text-editor"
      contentEditable="plaintext-only"
      spellCheck={false}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: MAX_TEXT_WIDTH,
        transformOrigin: '0 0',
        textAlign: 'center',
        fontFamily: FONT_STACK,
        outline: 'none',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        background: 'transparent',
        zIndex: 10,
      }}
      onInput={() => actions().liveEditText(editing.id, currentText())}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit((id, text) => actions().commitAndAddSibling(id, text))
        } else if (e.key === 'Tab') {
          e.preventDefault()
          commit((id, text) => actions().commitAndAddChild(id, text))
        } else if (e.key === 'Escape') {
          e.preventDefault()
          commit((id, text) => actions().cancelEditKeepText(id, text))
        }
      }}
      onBlur={() => commit((id, text) => actions().commitEdit(id, text))}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
