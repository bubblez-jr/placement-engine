/** Someone's words in quotes, ending the sentence once: “Too far.” rather than “Too far.”. */
export function quoted(s: string): string {
  const t = s.trim()
  return /[.!?]$/.test(t) ? `“${t}”` : `“${t}”.`
}
