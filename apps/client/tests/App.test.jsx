import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { ApiError } from '../src/services/api/httpClient.js'

const healthy = {
  getHealth: vi.fn(async () => ({ status: 'ok' })),
  getReadiness: vi.fn(async () => ({
    status: 'ready',
    checks: { database: 'up' },
  })),
}

function statusValue(label) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling
    .textContent
}

describe('App', () => {
  it('renders the application shell', async () => {
    render(<App systemApi={healthy} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Real-Time Chat' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/not implemented yet/i)).toBeInTheDocument()
    await screen.findByLabelText('Backend status')
  })

  it('shows a loading state, then healthy backend status', async () => {
    render(<App systemApi={healthy} />)
    expect(screen.getByRole('status')).toHaveTextContent('Checking backend')
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()

    const list = await screen.findByLabelText('Backend status')
    expect(within(list).getByText('API')).toBeInTheDocument()
    expect(statusValue('API')).toBe('Online')
    expect(statusValue('Readiness')).toBe('Ready')
    expect(statusValue('Database')).toBe('Up')
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
  })

  it('reports an unreachable backend', async () => {
    const networkError = () =>
      Promise.reject(
        new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'x' }),
      )
    render(
      <App
        systemApi={{ getHealth: networkError, getReadiness: networkError }}
      />,
    )
    await screen.findByLabelText('Backend status')
    expect(statusValue('API')).toBe('Unreachable')
    expect(statusValue('Readiness')).toBe('Unknown')
    expect(screen.queryByText('Database')).not.toBeInTheDocument()
  })

  it('reports a live but not-ready backend with the failing dependency', async () => {
    render(
      <App
        systemApi={{
          getHealth: healthy.getHealth,
          getReadiness: () =>
            Promise.reject(
              new ApiError({
                status: 503,
                code: 'NOT_READY',
                message: 'Service is not ready',
                details: [{ check: 'database', status: 'down' }],
              }),
            ),
        }}
      />,
    )
    await screen.findByLabelText('Backend status')
    expect(statusValue('API')).toBe('Online')
    expect(statusValue('Readiness')).toBe('Not ready')
    expect(statusValue('Database')).toBe('Down')
  })

  it('re-checks the backend on demand', async () => {
    const api = {
      getHealth: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'x' }),
        )
        .mockResolvedValue({ status: 'ok' }),
      getReadiness: healthy.getReadiness,
    }
    render(<App systemApi={api} />)
    await screen.findByLabelText('Backend status')
    expect(statusValue('API')).toBe('Unreachable')

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await screen.findByRole('status')
    await screen.findByLabelText('Backend status')
    expect(statusValue('API')).toBe('Online')
    expect(api.getHealth).toHaveBeenCalledTimes(2)
  })

  it('aborts in-flight requests when unmounted', async () => {
    let signal
    const api = {
      getHealth: (options) => {
        signal = options.signal
        return new Promise(() => {})
      },
      getReadiness: () => new Promise(() => {}),
    }
    const { unmount } = render(<App systemApi={api} />)
    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
