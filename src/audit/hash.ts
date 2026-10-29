/** SHA-256 hex digest using Web Crypto (browsers and Node 20+). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}
