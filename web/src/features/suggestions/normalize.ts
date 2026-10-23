const WRAPPING_FENCE = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n?```\s*$/

/**
 * Clean up a model proposal before diffing: drop a ```markdown wrapper the
 * model was told not to add, and match the original's trailing newline so the
 * diff doesn't show a spurious last-line change.
 */
export function normalizeProposal(proposal: string, baseText: string): string {
  let text = proposal.replace(/\r\n/g, '\n')
  const fenced = WRAPPING_FENCE.exec(text)
  if (fenced && !baseText.trimStart().startsWith('```')) text = fenced[1] ?? ''

  if (baseText.endsWith('\n')) {
    if (!text.endsWith('\n')) text += '\n'
  } else {
    text = text.replace(/\n+$/, '')
  }
  return text
}
