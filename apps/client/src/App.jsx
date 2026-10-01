import { Link, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider.jsx'
import { LoginPage } from './features/auth/LoginPage.jsx'
import { RegisterPage } from './features/auth/RegisterPage.jsx'
import { GuestOnly, RequireAuth } from './features/auth/RouteGuards.jsx'
import { SystemStatus } from './features/system/SystemStatus.jsx'
import { HomePage } from './pages/HomePage.jsx'
import {
  authApi as defaultAuthApi,
  systemApi as defaultSystemApi,
} from './services/api/index.js'

/**
 * Routes: `/` (protected shell), `/login` and `/register` (guests only),
 * `/status` (public backend diagnostics). Must be rendered inside a router
 * (BrowserRouter in main.jsx, MemoryRouter in tests).
 */
function App({ systemApi = defaultSystemApi, authApi = defaultAuthApi }) {
  return (
    <AuthProvider authApi={authApi}>
      <main className="app">
        <header>
          <h1>
            <Link to="/" className="brand">
              Real-Time Chat
            </Link>
          </h1>
          <p className="subtitle">
            Authentication is available. Chat features are not implemented yet.
          </p>
        </header>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<HomePage systemApi={systemApi} />} />
          </Route>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route
            path="/status"
            element={<SystemStatus systemApi={systemApi} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </AuthProvider>
  )
}

export default App
