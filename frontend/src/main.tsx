import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import './index.css'
import { ClientsProvider } from '@/lib/clients'
import { createClients } from '@/lib/createClients'
import { PlanProvider } from '@/lib/plan'
import { SessionProvider } from '@/lib/session'
import { NotConfiguredPage } from '@/pages/NotConfiguredPage'
import { routes } from '@/routes'

const clients = createClients()
const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {clients === null ? (
      <NotConfiguredPage />
    ) : (
      <ClientsProvider clients={clients}>
        <SessionProvider>
          <PlanProvider>
            <RouterProvider router={router} />
          </PlanProvider>
        </SessionProvider>
      </ClientsProvider>
    )}
  </StrictMode>,
)
