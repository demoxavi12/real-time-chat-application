/**
 * Secret scan over every file Git would commit (tracked + untracked, not
 * ignored). Fails (exit 1) on:
 *   - secret-bearing files (.env, private keys, ...) that are not ignored
 *   - high-confidence credential patterns in file contents
 *   - env-style assignments of secrets whose value is not an obvious placeholder
 * Findings print file:line and the rule name, never the secret itself.
 *
 * A deliberately fake fixture (e.g. a test proving credentials are redacted)
 * can be exempted by ending its line with `secret-scan:allow` plus a reason.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const FORBIDDEN_FILES = [
  {
    rule: 'env file',
    test: (f) => /(^|\/)\.env(\..+)?$/.test(f) && !/\.example$/.test(f),
  },
  {
    rule: 'private key file',
    test: (f) =>
      /\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/.test(f),
  },
]

const CONTENT_RULES = [
  {
    rule: 'private key block',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    rule: 'MongoDB URI with credentials',
    pattern: /mongodb(?:\+srv)?:\/\/[^\s:@/'"`<>]+:[^\s@/'"`<>]+@/,
  },
  { rule: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    rule: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  },
  { rule: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { rule: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: 'Stripe live key', pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}/ },
  {
    rule: 'Anthropic/OpenAI API key',
    pattern: /\bsk-(?:ant-|proj-)[A-Za-z0-9_-]{20,}/,
  },
  {
    rule: 'JSON Web Token',
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
]

// KEY=value lines (env files, shell, YAML, docs) naming a secret.
const SECRET_ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|TOKEN)[A-Z0-9_]*)\s*[=:]\s*['"]?([^\s'"#]+)/
const PLACEHOLDER =
  /replace|placeholder|example|changeme|change-me|your[-_]|test-only|dummy|<[^>]*>|^\$\{|^\$\(|\*{3,}|x{6,}|^(true|false|null)$/i

const ALLOW_MARKER = /secret-scan:allow\b/

const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|eot|pdf|zip|gz)$/i
const SKIP_FILES = new Set(['package-lock.json'])

function listCandidateFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
  return out.split('\0').filter((file) => file && fs.existsSync(file))
}

function assertEnvIgnored() {
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'])
    return []
  } catch {
    return [{ file: '.gitignore', line: 0, rule: '.env is not ignored by Git' }]
  }
}

function scanFile(file) {
  const findings = []
  for (const { rule, test } of FORBIDDEN_FILES) {
    if (test(file)) findings.push({ file, line: 0, rule })
  }
  if (BINARY_EXTENSIONS.test(file) || SKIP_FILES.has(file.split('/').pop())) {
    return findings
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((text, index) => {
    if (ALLOW_MARKER.test(text)) return
    for (const { rule, pattern } of CONTENT_RULES) {
      if (pattern.test(text)) findings.push({ file, line: index + 1, rule })
    }
    const assignment = SECRET_ASSIGNMENT.exec(text)
    if (assignment && !PLACEHOLDER.test(assignment[2])) {
      findings.push({
        file,
        line: index + 1,
        rule: `non-placeholder value for ${assignment[1]}`,
      })
    }
  })
  return findings
}

const files = listCandidateFiles()
const findings = [...assertEnvIgnored(), ...files.flatMap(scanFile)]

if (findings.length > 0) {
  console.error(`Secret scan FAILED: ${findings.length} finding(s)`)
  for (const { file, line, rule } of findings) {
    console.error(`  ${file}${line ? `:${line}` : ''}  ${rule}`)
  }
  process.exit(1)
}
console.log(`Secret scan passed (${files.length} files checked).`)
