import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loadKeys } from './keys'
import './index.css'

loadKeys().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>))
