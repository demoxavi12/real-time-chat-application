import { useSystemStatus } from './useSystemStatus.js'

function describeReadiness(readiness) {
  if (readiness.ok) return { value: 'Ready', tone: 'ok' }
  if (readiness.code === 'NOT_READY') return { value: 'Not ready', tone: 'bad' }
  return { value: 'Unknown', tone: 'bad' }
}

function dependencyStatuses(readiness) {
  if (readiness.ok) return Object.entries(readiness.data.checks)
  return (readiness.details ?? [])
    .filter((detail) => detail.check)
    .map((detail) => [detail.check, detail.status])
}

function StatusRow({ label, value, tone }) {
  return (
    <div className="status-row">
      <dt>{label}</dt>
      <dd className={`status-value status-${tone}`}>
        <span aria-hidden="true" className="status-dot" />
        {value}
      </dd>
    </div>
  )
}

export function SystemStatus({ systemApi }) {
  const { status, health, readiness, refresh } = useSystemStatus(systemApi)
  const loading = status === 'loading'

  return (
    <section className="card" aria-labelledby="system-status-heading">
      <h2 id="system-status-heading">System status</h2>
      {loading ? (
        <p role="status">Checking backend…</p>
      ) : (
        <dl aria-label="Backend status">
          <StatusRow
            label="API"
            value={health.ok ? 'Online' : 'Unreachable'}
            tone={health.ok ? 'ok' : 'bad'}
          />
          <StatusRow label="Readiness" {...describeReadiness(readiness)} />
          {dependencyStatuses(readiness).map(([name, value]) => (
            <StatusRow
              key={name}
              label={name[0].toUpperCase() + name.slice(1)}
              value={value === 'up' ? 'Up' : 'Down'}
              tone={value === 'up' ? 'ok' : 'bad'}
            />
          ))}
        </dl>
      )}
      <button type="button" onClick={refresh} disabled={loading}>
        Check again
      </button>
    </section>
  )
}
