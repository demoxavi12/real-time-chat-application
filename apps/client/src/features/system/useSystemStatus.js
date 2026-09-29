import { useCallback, useEffect, useState } from 'react'

const INITIAL = { status: 'loading', health: null, readiness: null }

async function probe(call, signal) {
  try {
    return { ok: true, data: await call({ signal }) }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return {
      ok: false,
      code: error?.code ?? 'UNKNOWN',
      details: error?.details,
    }
  }
}

/** Loads backend liveness and readiness through the system API boundary. */
export function useSystemStatus(systemApi) {
  const [state, setState] = useState(INITIAL)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      probe(systemApi.getHealth, controller.signal),
      probe(systemApi.getReadiness, controller.signal),
    ]).then(
      ([health, readiness]) => setState({ status: 'done', health, readiness }),
      () => {
        // Aborted because the component unmounted or a re-check started.
      },
    )
    return () => controller.abort()
  }, [systemApi, attempt])

  const refresh = useCallback(() => {
    setState(INITIAL)
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, refresh }
}
