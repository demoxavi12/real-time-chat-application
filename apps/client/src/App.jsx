import { Link, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider.jsx'
import { LoginPage } from './features/auth/LoginPage.jsx'
import { RegisterPage } from './features/auth/RegisterPage.jsx'
import { GuestOnly, RequireAuth } from './features/auth/RouteGuards.jsx'
import {
  ConversationView,
  NoConversationSelected,
} from './features/chat/ConversationView.jsx'
import { RealtimeProvider } from './features/realtime/RealtimeProvider.jsx'
import { SystemStatus } from './features/system/SystemStatus.jsx'
import { HomePage } from './pages/HomePage.jsx'
import {
  authApi as defaultAuthApi,
  chatApi as defaultChatApi,
  systemApi as defaultSystemApi,
} from './services/api/index.js'
import { createAppSocket } from './services/socket/index.js'

/**
 * Routes: `/` and `/conversations/:conversationId` (protected chat shell),
 * `/login` and `/register` (guests only),
 * `/status` (public backend diagnostics). Must be rendered inside a router
 * (BrowserRouter in main.jsx, MemoryRouter in tests).
 */
function App({
  systemApi = defaultSystemApi,
  authApi = defaultAuthApi,
  chatApi = defaultChatApi,
  createSocket = createAppSocket,
}) {
  return (
    <AuthProvider authApi={authApi}>
      <RealtimeProvider createSocket={createSocket}>
        <main className="app">
          <header>
            <h1>
              <Link to="/" className="brand">
                Real-Time Chat
              </Link>
            </h1>
            <p className="subtitle">
              Real-time chat. File sharing and notifications are not implemented
              yet.
            </p>
          </header>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/" element={<HomePage chatApi={chatApi} />}>
                <Route index element={<NoConversationSelected />} />
                <Route
                  path="conversations/:conversationId"
                  element={<ConversationView />}
                />
              </Route>
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
      </RealtimeProvider>
    </AuthProvider>
  )
}

export default App
