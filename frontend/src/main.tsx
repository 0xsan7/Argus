import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const Investigation = lazy(() => import('./Investigation'))
const Console = location.pathname.replace(/\/$/, '') === '/investigation' ? Investigation : App

createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={<main role="status">Loading workspace…</main>}><Console /></Suspense></StrictMode>)
