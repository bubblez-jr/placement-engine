// The contract between the browser and this site's own journey-time
// functions (`api/travel-matrix.ts`, `api/travel-status.ts`). Shared by the
// client (src/travel/traveltime.ts) and the server, and free of any vendor
// detail: what TravelTime expects lives only in `traveltime.ts` next to this.
//
// The browser sends coordinates, arrival instants and nothing else: no case
// reference, no property or person id, no place name.

/** Most properties per request (the client splits a bigger inventory into several requests). */
export const MAX_ORIGINS = 60
/** Most places per request: up to 11 of the household's places plus the last settled area. */
export const MAX_DESTINATIONS = 12
/** Longest journey searched for. A place further than this has no route. Must match JOURNEY_CEILING_MINUTES in the engine. */
export const CEILING_MINUTES = 240
/** Largest request body accepted, in bytes (60 × 12 points are about 6 KB). */
export const MAX_BODY_BYTES = 32_000

/** Why real journey times were not available, in whole or in part. Mirrors `TravelFailureCode` in the engine. */
export type FailureCode =
  | 'not_configured'
  | 'status_unavailable'
  | 'invalid_request'
  | 'bad_key'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'rejected'
  | 'vendor_error'
  | 'bad_response'
  | 'partial'

export interface Point {
  lat: number
  lng: number
}

export interface MatrixRequest {
  origins: Point[]
  /** `arriveAt` is the arrival instant (ISO 8601 with offset or Z) */
  destinations: (Point & { arriveAt: string })[]
}

/**
 * One answer. `minutes` with `km` (null when TravelTime gave no distance);
 * `noRoute` when there is no public transport route within the ceiling;
 * null when TravelTime gave no answer for the pair (the client fills it with
 * the estimate and says so).
 */
export type MatrixCell = { minutes: number; km: number | null } | { noRoute: true } | null

export type MatrixResponse =
  | {
      ok: true
      source: 'traveltime'
      /** cells[destination][origin], in request order */
      cells: MatrixCell[][]
      /** True when some pairs have no answer (null cells) */
      partial: boolean
    }
  | { ok: false; code: FailureCode; message: string }

export interface StatusResponse {
  /** Both TravelTime variables are set on the server. Says nothing about whether the key works: see `check`. */
  configured: boolean
  provider: 'traveltime'
  /** The server region the function ran in, when the platform says */
  region: string | null
  /** Present with `?check=1`: the result of one small real request */
  check?: { ok: true; minutes: number } | { ok: false; code: FailureCode; message: string }
}

// UK only: the site plans journeys for English councils. A generous box
// around Great Britain and Northern Ireland, so nothing else is sent on.
export const UK_BOUNDS = { minLat: 49.8, maxLat: 60.9, minLng: -8.7, maxLng: 1.8 }

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function inUk(p: Point): boolean {
  return p.lat >= UK_BOUNDS.minLat && p.lat <= UK_BOUNDS.maxLat && p.lng >= UK_BOUNDS.minLng && p.lng <= UK_BOUNDS.maxLng
}

function point(x: unknown, where: string, extra: string[] = []): { ok: true; value: Point } | { ok: false; message: string } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, message: `${where} must be an object` }
  const o = x as Record<string, unknown>
  const unknown = Object.keys(o).filter(k => !['lat', 'lng', ...extra].includes(k))
  if (unknown.length) return { ok: false, message: `${where} has fields that are not accepted: ${unknown.join(', ')}` }
  if (!isNum(o.lat) || o.lat < -90 || o.lat > 90) return { ok: false, message: `${where}.lat must be a number from -90 to 90` }
  if (!isNum(o.lng) || o.lng < -180 || o.lng > 180) return { ok: false, message: `${where}.lng must be a number from -180 to 180` }
  if (!inUk({ lat: o.lat, lng: o.lng })) return { ok: false, message: `${where} is outside the UK` }
  return { ok: true, value: { lat: o.lat, lng: o.lng } }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Strict check of a matrix request. Anything not in the contract is refused,
 * so nothing but coordinates and times can reach the vendor through this
 * function. `nowMs` bounds the arrival times: from a day ago to 18 months on.
 */
export function validateMatrixRequest(x: unknown, nowMs: number): { ok: true; value: MatrixRequest } | { ok: false; message: string } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, message: 'The request must be a JSON object' }
  const o = x as Record<string, unknown>
  const unknown = Object.keys(o).filter(k => k !== 'origins' && k !== 'destinations')
  if (unknown.length) return { ok: false, message: `Fields not accepted: ${unknown.join(', ')}` }
  if (!Array.isArray(o.origins) || o.origins.length === 0 || o.origins.length > MAX_ORIGINS)
    return { ok: false, message: `origins must be a list of 1 to ${MAX_ORIGINS} points` }
  if (!Array.isArray(o.destinations) || o.destinations.length === 0 || o.destinations.length > MAX_DESTINATIONS)
    return { ok: false, message: `destinations must be a list of 1 to ${MAX_DESTINATIONS} points` }
  const origins: Point[] = []
  for (let i = 0; i < o.origins.length; i++) {
    const p = point(o.origins[i], `origins[${i}]`)
    if (!p.ok) return p
    origins.push(p.value)
  }
  const destinations: MatrixRequest['destinations'] = []
  for (let i = 0; i < o.destinations.length; i++) {
    const p = point(o.destinations[i], `destinations[${i}]`, ['arriveAt'])
    if (!p.ok) return p
    const at = (o.destinations[i] as Record<string, unknown>).arriveAt
    if (typeof at !== 'string' || !ISO_INSTANT.test(at) || Number.isNaN(Date.parse(at)))
      return { ok: false, message: `destinations[${i}].arriveAt must be an ISO 8601 date and time` }
    const ms = Date.parse(at)
    if (ms < nowMs - 86_400_000 || ms > nowMs + 548 * 86_400_000)
      return { ok: false, message: `destinations[${i}].arriveAt must be between yesterday and 18 months from now` }
    destinations.push({ ...p.value, arriveAt: at })
  }
  return { ok: true, value: { origins, destinations } }
}

/**
 * Strict check of a matrix response, on the client. A response that does not
 * match the request it answers is refused as a whole: better the labelled
 * estimate than journey times that cannot be placed.
 */
export function parseMatrixResponse(x: unknown, req: MatrixRequest): MatrixResponse {
  const bad = (message: string): MatrixResponse => ({ ok: false, code: 'bad_response', message })
  if (!x || typeof x !== 'object') return bad('The journey service did not return JSON')
  const o = x as Record<string, unknown>
  if (o.ok === false) {
    const codes: FailureCode[] = [
      'not_configured',
      'status_unavailable',
      'invalid_request',
      'bad_key',
      'rate_limited',
      'timeout',
      'network',
      'rejected',
      'vendor_error',
      'bad_response',
      'partial',
    ]
    const code = codes.includes(o.code as FailureCode) ? (o.code as FailureCode) : 'bad_response'
    return { ok: false, code, message: typeof o.message === 'string' ? o.message.slice(0, 300) : '' }
  }
  if (o.ok !== true || o.source !== 'traveltime' || typeof o.partial !== 'boolean') return bad('The journey service answered in an unknown form')
  if (!Array.isArray(o.cells) || o.cells.length !== req.destinations.length) return bad('The journey service answered for the wrong number of places')
  const cells: MatrixCell[][] = []
  for (const row of o.cells) {
    if (!Array.isArray(row) || row.length !== req.origins.length) return bad('The journey service answered for the wrong number of properties')
    const out: MatrixCell[] = []
    for (const c of row) {
      if (c === null) out.push(null)
      else if (c && typeof c === 'object' && (c as Record<string, unknown>).noRoute === true) out.push({ noRoute: true })
      else if (c && typeof c === 'object') {
        const m = (c as Record<string, unknown>).minutes
        const km = (c as Record<string, unknown>).km
        if (!isNum(m) || !Number.isInteger(m) || m < 0 || m > CEILING_MINUTES) return bad('A journey time was out of range')
        if (km !== null && (!isNum(km) || km < 0 || km > 1500)) return bad('A distance was out of range')
        out.push({ minutes: m, km })
      } else return bad('A journey answer was not understood')
    }
    cells.push(out)
  }
  return { ok: true, source: 'traveltime', cells, partial: o.partial }
}
