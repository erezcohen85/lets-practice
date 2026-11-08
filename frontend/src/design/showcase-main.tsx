import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { TokenShowcase } from './TokenShowcase.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TokenShowcase />
  </StrictMode>,
)
