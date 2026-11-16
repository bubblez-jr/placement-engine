/** SHA-256 hex digest using Web Crypto (browsers and Node 20+). */
export async function sha256Hex(text: string): Promise<string> {
  return sha256BytesHex(new TextEncoder().encode(text))
}

/** SHA-256 hex digest of raw bytes (a PDF, for its export record). */
export async function sha256BytesHex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}
