/**
 * Canonical JSON: object keys sorted, undefined dropped, no whitespace.
 * The same data always produces the same string, so its hash is stable.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number')
    return JSON.stringify(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter(k => obj[k] !== undefined)
      .sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`)
}
