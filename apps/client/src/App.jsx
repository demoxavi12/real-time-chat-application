import { SystemStatus } from './features/system/SystemStatus.jsx'
import { systemApi as defaultSystemApi } from './services/api/index.js'

function App({ systemApi = defaultSystemApi }) {
  return (
    <main className="app">
      <header>
        <h1>Real-Time Chat</h1>
        <p className="subtitle">
          Project foundation (Phase 0). Authentication and chat features are not
          implemented yet.
        </p>
      </header>
      <SystemStatus systemApi={systemApi} />
    </main>
  )
}

export default App
