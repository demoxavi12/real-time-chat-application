/**
 * One-command quality gate: `npm run verify`.
 *
 * Runs every gate in order and stops at the first failure (later gates depend
 * on earlier ones and would only add noise). Exits non-zero on any failure;
 * nothing is skipped or ignored. Prints a summary table at the end.
 */
import { spawnSync } from 'node:child_process'

const STEPS = [
  { name: 'Format check', script: 'format:check' },
  { name: 'Lint', script: 'lint' },
  { name: 'Unit tests (server + client)', script: 'test:unit' },
  { name: 'Integration + Socket.IO tests', script: 'test:integration' },
  { name: 'Build', script: 'build' },
  { name: 'E2E tests (Playwright)', script: 'test:e2e' },
  { name: 'Security (npm audit + secret scan)', script: 'security' },
]

const results = []

function formatDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

for (const step of STEPS) {
  console.log(`\n━━━ ${step.name} (npm run ${step.script}) ━━━`)
  const startedAt = Date.now()
  // Script names are constants above, so running through a shell is safe
  // (and required for npm.cmd on Windows).
  const { status, error } = spawnSync(`npm run ${step.script}`, {
    stdio: 'inherit',
    shell: true,
  })
  const passed = !error && status === 0
  results.push({ ...step, passed, duration: Date.now() - startedAt })
  if (error) console.error(error.message)
  if (!passed) break
}

console.log('\n━━━ Verification summary ━━━')
for (const step of STEPS) {
  const result = results.find((r) => r.script === step.script)
  const label = !result ? 'SKIPPED' : result.passed ? 'PASS' : 'FAIL'
  const time = result ? ` (${formatDuration(result.duration)})` : ''
  console.log(`  ${label.padEnd(8)} ${step.name}${time}`)
}

const failed = results.find((r) => !r.passed)
if (failed) {
  console.error(
    `\nVerification FAILED at "${failed.name}". Re-run with: npm run ${failed.script}`,
  )
  process.exit(1)
}
console.log('\nVerification PASSED: all quality gates are green.')
