/**
 * @fileoverview Punto de entrada del **frontend** Ariadne (React 18 + Vite): monta la SPA en `#root` con `StrictMode`.
 * Rutas, layout shell y llamadas al API documentadas en `src/App.tsx` y páginas bajo `src/pages/`.
 *
 * @module main
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 * @author Jorge Correa <jcorrea@e-personal.net>
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
