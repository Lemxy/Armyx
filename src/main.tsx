import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loadKeys } from './keys'
import './index.css'

// The browser's own right-click menu (Back, Refresh, Save as, Inspect) has no place in the app: the app has its menus. Text fields keep theirs (copy, paste).
document.addEventListener('contextmenu', (e) => { if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) e.preventDefault() })

loadKeys().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>))
