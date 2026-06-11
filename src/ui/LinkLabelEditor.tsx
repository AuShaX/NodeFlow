import { useEffect, useRef } from 'react'
import { engineRef } from '../engine'
import { uiStore, useUI } from '../state/store'
import { crossLinkMidpoint } from '../engine/drawConnector'
import { FONT_STACK } from '../theme'

/**
 * Inline label editor for cross-links: a small pill input pinned to the
 * link's midpoint (opened by double-clicking a link).
 */
export function LinkLabelEditor() {
  const editingLinkId = useUI((s) => s.editingLinkId)
  if (!editingLinkId) return null
  return <Editor key={editingLinkId} linkId={editingLinkId} />
}

function Editor({ linkId }: { linkId: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const committed = useRef(false)

  useEffect(() => {
    const el = ref.current
    const engine = engineRef.current
    if (!el || !engine) return
    const link = engine.board.mirror.links.find((l) => l.id === linkId)
    el.value = link?.label ?? ''
    el.focus()
    el.select()

    let raf = 0
    const sync = () => {
      raf = requestAnimationFrame(sync)
      const m = engine.board.mirror
      const lk = m.links.find((l) => l.id === linkId)
      if (!lk) return
      const a = m.getAnyNode(lk.fromId)
      const b = m.getAnyNode(lk.toId)
      if (!a || !b) return
      const mid = crossLinkMidpoint(a, b)
      const cam = uiStore.getState().camera
      const sx = (mid.x - cam.x) * cam.zoom
      const sy = (mid.y - cam.y) * cam.zoom
      el.style.transform = `translate(${sx}px, ${sy}px) scale(${cam.zoom}) translate(-50%, -50%)`
    }
    sync()
    return () => cancelAnimationFrame(raf)
  }, [linkId])

  const commit = (save: boolean) => {
    if (committed.current) return
    committed.current = true
    const engine = engineRef.current
    if (save && engine && ref.current) {
      engine.actions.setLinkLabel(linkId, ref.current.value.trim())
    }
    uiStore.setState({ editingLinkId: null })
  }

  return (
    <input
      ref={ref}
      className="link-label-editor"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        width: 140,
        fontFamily: FONT_STACK,
        fontSize: 11,
        fontWeight: 500,
        textAlign: 'center',
        zIndex: 10,
      }}
      placeholder="Label"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit(true)
        else if (e.key === 'Escape') commit(false)
      }}
      onBlur={() => commit(true)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
