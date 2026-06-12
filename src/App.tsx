import { useEffect, useState } from 'react'
import { Board, EmptyBoardHint } from './ui/Board'
import { BoardHome } from './ui/BoardHome'
import { TopBar } from './ui/TopBar'
import { Toolbar } from './ui/Toolbar'
import { ContextToolbar } from './ui/ContextToolbar'
import { ContextMenu } from './ui/ContextMenu'
import { StylePanel } from './ui/StylePanel'
import { SearchPalette } from './ui/SearchPalette'
import { Hud } from './ui/Hud'
import { getBoardMeta } from './doc/boards'

/** Hash routes: `#/` (board home) and `#/board/:id`. */
type Route = { view: 'home' } | { view: 'board'; id: string }

function parseHash(): Route {
  const m = /^#\/board\/([\w-]+)/.exec(location.hash)
  return m ? { view: 'board', id: m[1] } : { view: 'home' }
}

function App() {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  if (route.view === 'board') return <BoardView key={route.id} id={route.id} />
  return <BoardHome />
}

function BoardView({ id }: { id: string }) {
  // Chrome mounts only once the engine exists (the doc opens asynchronously).
  const [ready, setReady] = useState(false)
  const known = getBoardMeta(id) !== null

  useEffect(() => {
    if (!known) location.hash = '#/'
  }, [known])
  if (!known) return null

  return (
    <div className="app">
      <Board boardId={id} onReady={setReady} />
      {ready && (
        <>
          <TopBar />
          <ContextToolbar />
          <ContextMenu />
          <StylePanel />
          <Toolbar />
          <SearchPalette />
          <EmptyBoardHint />
          <Hud />
        </>
      )}
    </div>
  )
}

export default App
