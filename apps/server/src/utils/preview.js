export const PREVIEW_MAX_LENGTH = 120

/** Single-line, bounded excerpt of a message for conversation lists. */
export function previewOf(content) {
  const line = String(content).replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_MAX_LENGTH
    ? `${line.slice(0, PREVIEW_MAX_LENGTH - 1)}…`
    : line
}
