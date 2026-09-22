import ReactDOM from 'react-dom/client'
import App from './App'
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
