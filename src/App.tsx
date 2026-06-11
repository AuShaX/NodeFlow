import { Board } from './ui/Board'
import { TopBar } from './ui/TopBar'
import { Toolbar } from './ui/Toolbar'
import { ContextToolbar } from './ui/ContextToolbar'
import { ContextMenu } from './ui/ContextMenu'
import { StylePanel } from './ui/StylePanel'
import { Hud } from './ui/Hud'

function App() {
  return (
    <div className="app">
      {/* Board mounts first: it creates the engine the chrome below reads. */}
      <Board />
      <TopBar />
      <ContextToolbar />
      <ContextMenu />
      <StylePanel />
      <Toolbar />
      <Hud />
    </div>
  )
}

export default App
