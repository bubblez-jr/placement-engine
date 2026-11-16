import type { LatLng } from '../engine/types'

// Turn a UK postcode into a map location with the public postcodes.io
// service, from the browser. Only the postcode is sent. The lookup can fail
// or be blocked; the form never depends on it (the example places stay).

export const POSTCODES_IO = 'https://api.postcodes.io/postcodes/'

/** A full UK postcode: outward code, a space, inward code ("E15 1AA"); null if it is not one. */
export function normalisePostcode(input: string): string | null {
  const t = input.toUpperCase().replace(/\s+/g, '')
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(t)
  return m ? `${m[1]} ${m[2]}` : null
}

export type PostcodeLookup =
  | { ok: true; postcode: string; location: LatLng; district: string | null }
  | { ok: false; reason: 'invalid' | 'unknown' | 'no_location' | 'failed'; message: string }

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export async function lookupPostcode(input: string, fetchImpl: typeof fetch, timeoutMs = 6_000): Promise<PostcodeLookup> {
  const pc = normalisePostcode(input)
  if (!pc) return { ok: false, reason: 'invalid', message: 'Enter a full UK postcode, for example E15 1AA.' }
  const failed: PostcodeLookup = {
    ok: false,
    reason: 'failed',
    message: 'The postcode lookup is not available just now. Try again, or choose a place from the list.',
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  let json: unknown
  try {
    res = await fetchImpl(`${POSTCODES_IO}${encodeURIComponent(pc)}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    json = await res.json().catch(() => null)
  } catch {
    return failed
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 404) return { ok: false, reason: 'unknown', message: `No postcode ${pc} was found. Check it, or choose a place from the list.` }
  const result = json && typeof json === 'object' ? (json as { result?: Record<string, unknown> }).result : undefined
  if (res.status !== 200 || !result || typeof result !== 'object') return failed
  const lat = result.latitude
  const lng = result.longitude
  if (!isNum(lat) || !isNum(lng))
    return { ok: false, reason: 'no_location', message: `${pc} was found but has no map location. Choose a place from the list instead.` }
  if (lat < 49.8 || lat > 60.9 || lng < -8.7 || lng > 1.8) return failed
  const district = typeof result.admin_district === 'string' ? result.admin_district : null
  return { ok: true, postcode: typeof result.postcode === 'string' ? result.postcode : pc, location: { lat, lng }, district }
}
