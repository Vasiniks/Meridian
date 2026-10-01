import ReactDOM from 'react-dom/client'
import App from './App'
// Self-hosted fonts (no third-party font CDN round-trip on first paint)
import '@fontsource/hanken-grotesk/latin-400.css'
import '@fontsource/hanken-grotesk/latin-500.css'
import '@fontsource/hanken-grotesk/latin-600.css'
import '@fontsource/hanken-grotesk/latin-700.css'
import '@fontsource/hanken-grotesk/latin-500-italic.css'
import '@fontsource/dm-mono/latin-400.css'
import '@fontsource/dm-mono/latin-500.css'
// Editorial serif — italic emphasis words only (h1/h2 <em>)
import '@fontsource/newsreader/latin-400-italic.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/stage.css'
import './styles/nav.css'
import './styles/sections.css'
import './styles/lineup.css'
import './styles/buy.css'
import './styles/responsive.css'

// NOTE: no React.StrictMode — it double-mounts effects in dev, which creates
// two WebGLRenderers on the same canvas (context loss + immutable-texture
// GL warnings). The PencilExperience owns the canvas exclusively.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
