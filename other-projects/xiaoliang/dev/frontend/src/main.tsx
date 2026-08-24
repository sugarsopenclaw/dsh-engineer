import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'markstream-react/index.css'
import './styles/index.css'
import 'katex/dist/katex.min.css'

const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
