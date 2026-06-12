import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import './index.css'
import App from './App.tsx'
import { fontsReady } from './engine/textMeasure'
import { applyTheme } from './theme'
import { uiStore } from './state/store'

// Theme before first paint (no light flash in dark mode).
applyTheme(uiStore.getState().themeMode)

// Wait (briefly) for Inter so node text measurement uses the real font from
// the first layout; fontsReady falls through on a timeout if the font stalls.
fontsReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
