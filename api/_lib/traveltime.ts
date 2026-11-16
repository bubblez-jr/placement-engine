import { CEILING_MINUTES, type FailureCode, type MatrixCell, type MatrixRequest } from './contract.js'

// Everything specific to TravelTime lives in this file: the endpoint, the
// request and response shapes, the limits and how its errors map to ours.
//
// UNVERIFIED UNTIL A KEY EXISTS. This was written from TravelTime's public
// v4 documentation for the time-filter endpoint, without a key and without
// network access to it. The shapes below are typed and tested against
// fixtures written here, not against a live answer. What could be wrong:
//   - the request field names and nesting (arrival_searches, coords, properties);
//   - `properties` in each result as a list of objects (taken from the docs);
//   - the limits: travel_time at most 4 hours, 10 searches per request;
//   - whether `distance` is returned for public transport;
//   - which HTTP status codes mean a bad key, a rate limit or a bad request;
//   - whether TravelTime plans on the exact date asked for, or maps it onto its
//     own timetable period.
// Each wrong guess fails loudly: an error or an unexpected shape is reported
// with a code, nothing is invented, and the browser falls back to the labelled
// estimate. `/api/travel-status?check=1` makes one small real request to show
// whether the key and the shapes work.

export const TRAVELTIME_URL = 'https://api.traveltimeapp.com/v4/time-filter'
/** Most arrival searches sent in one request (one search per place). Unverified: see above. */
export const MAX_SEARCHES_PER_REQUEST = 10
/** The ceiling sent as travel_time, in seconds. TravelTime's documented maximum is 4 hours. */
export const TRAVEL_TIME_CEILING_S = CEILING_MINUTES * 60

export interface TtLocation {
  id: string
  coords: { lat: number; lng: number }
}

export interface TtArrivalSearch {
  id: string
  arrival_location_id: string
  departure_location_ids: string[]
  transportation: { type: 'public_transport' }
  arrival_time: string
  travel_time: number
  properties: ('travel_time' | 'distance')[]
}

export interface TtRequest {
  locations: TtLocation[]
  arrival_searches: TtArrivalSearch[]
}

export interface TtResponse {
  results: {
    search_id: string
    locations: { id: string; properties: { travel_time: number; distance?: number }[] }[]
    unreachable: string[]
  }[]
}

/** Our ids for the vendor: o0… for properties, d0… for places. Position only, never a real id. */
const oid = (i: number) => `o${i}`
const did = (i: number) => `d${i}`

/**
 * One arrival search per place: everyone travels from each property to that
 * place, arriving by its arrive-by time. Places are split into requests of at
 * most MAX_SEARCHES_PER_REQUEST searches. Coordinates and times only.
 */
export function buildRequests(m: MatrixRequest): { request: TtRequest; destinationIndexes: number[] }[] {
  const out: { request: TtRequest; destinationIndexes: number[] }[] = []
  const originLocations: TtLocation[] = m.origins.map((p, i) => ({ id: oid(i), coords: { lat: p.lat, lng: p.lng } }))
  for (let start = 0; start < m.destinations.length; start += MAX_SEARCHES_PER_REQUEST) {
    const idx = m.destinations.map((_, i) => i).slice(start, start + MAX_SEARCHES_PER_REQUEST)
    out.push({
      destinationIndexes: idx,
      request: {
        locations: [...originLocations, ...idx.map(i => ({ id: did(i), coords: { lat: m.destinations[i].lat, lng: m.destinations[i].lng } }))],
        arrival_searches: idx.map(i => ({
          id: did(i),
          arrival_location_id: did(i),
          departure_location_ids: m.origins.map((_, j) => oid(j)),
          transportation: { type: 'public_transport' },
          arrival_time: new Date(m.destinations[i].arriveAt).toISOString(),
          travel_time: TRAVEL_TIME_CEILING_S,
          properties: ['travel_time', 'distance'],
        })),
      },
    })
  }
  return out
}

export type ParseResult = { ok: true; rows: Map<number, MatrixCell[]>; partial: boolean } | { ok: false; code: FailureCode; message: string }

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/**
 * Read a time-filter answer for one request. Strict: an unknown search or
 * location id, a time over the ceiling, a location both reachable and
 * unreachable, or any missing field refuses the whole answer. A search or a
 * location with no answer at all is partial: those pairs come back as null.
 */
export function parseResponse(json: unknown, sent: { request: TtRequest; destinationIndexes: number[] }, originCount: number): ParseResult {
  const bad = (message: string): ParseResult => ({ ok: false, code: 'bad_response', message })
  if (!json || typeof json !== 'object' || !Array.isArray((json as TtResponse).results)) return bad('No results list in the answer')
  const results = (json as TtResponse).results
  const searchIds = new Set(sent.request.arrival_searches.map(s => s.id))
  const rows = new Map<number, MatrixCell[]>()
  let partial = false
  const seen = new Set<string>()
  for (const r of results) {
    if (!r || typeof r !== 'object' || typeof r.search_id !== 'string' || !searchIds.has(r.search_id)) return bad('An answer for a search that was not asked')
    if (seen.has(r.search_id)) return bad('Two answers for one search')
    seen.add(r.search_id)
    if (!Array.isArray(r.locations) || !Array.isArray(r.unreachable)) return bad('An answer without locations and unreachable lists')
    const row: MatrixCell[] = new Array(originCount).fill(null)
    const filled = new Set<number>()
    for (const loc of r.locations) {
      const i = typeof loc?.id === 'string' && /^o\d+$/.test(loc.id) ? Number(loc.id.slice(1)) : -1
      if (i < 0 || i >= originCount) return bad('An answer for a place that was not asked')
      if (filled.has(i)) return bad('Two answers for one journey')
      const props = Array.isArray(loc.properties) ? loc.properties[0] : undefined
      const t = props?.travel_time
      if (!isNum(t) || !Number.isInteger(t) || t < 0 || t > TRAVEL_TIME_CEILING_S) return bad('A journey time is missing or out of range')
      const d = props?.distance
      if (d !== undefined && (!isNum(d) || d < 0)) return bad('A distance is not a number')
      row[i] = { minutes: Math.round(t / 60), km: d === undefined ? null : Math.round(d / 100) / 10 }
      filled.add(i)
    }
    for (const id of r.unreachable) {
      const i = typeof id === 'string' && /^o\d+$/.test(id) ? Number(id.slice(1)) : -1
      if (i < 0 || i >= originCount) return bad('An unreachable place that was not asked')
      if (filled.has(i)) return bad('A journey both reachable and unreachable')
      row[i] = { noRoute: true }
      filled.add(i)
    }
    if (filled.size < originCount) partial = true
    rows.set(Number(r.search_id.slice(1)), row)
  }
  for (const i of sent.destinationIndexes) {
    if (!rows.has(i)) {
      rows.set(i, new Array(originCount).fill(null))
      partial = true
    }
  }
  return { ok: true, rows, partial }
}

/** How a non-2xx status from TravelTime maps to our reasons. Unverified: see the top of this file. */
export function classifyStatus(status: number): FailureCode {
  if (status === 401 || status === 403) return 'bad_key'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'rejected'
  return 'vendor_error'
}

const MESSAGES: Record<FailureCode, string> = {
  not_configured: 'TravelTime is not configured on this server',
  status_unavailable: 'The journey service could not be checked',
  invalid_request: 'The request was not valid',
  bad_key: 'TravelTime did not accept the key',
  rate_limited: 'TravelTime’s request limit was reached',
  timeout: 'TravelTime did not answer in time',
  network: 'TravelTime could not be reached',
  rejected: 'TravelTime rejected the request',
  vendor_error: 'TravelTime reported an error',
  bad_response: 'TravelTime’s answer was not in the expected form',
  partial: 'TravelTime did not answer for every journey',
}
export function failureMessage(code: FailureCode): string {
  return MESSAGES[code]
}

export interface Credentials {
  appId: string
  apiKey: string
}

export type CallResult = { ok: true; json: unknown } | { ok: false; code: FailureCode; status?: number; vendorCode?: number }

/** One POST to time-filter. The key travels only in these headers, from the server. */
export async function callTimeFilter(request: TtRequest, creds: Credentials, fetchImpl: typeof fetch, timeoutMs: number): Promise<CallResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(TRAVELTIME_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Application-Id': creds.appId,
        'X-Api-Key': creds.apiKey,
      },
      body: JSON.stringify(request),
      signal: ctrl.signal,
    })
  } catch {
    return { ok: false, code: ctrl.signal.aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    const vendorCode =
      json && typeof json === 'object' && typeof (json as Record<string, unknown>).error_code === 'number'
        ? Number((json as Record<string, unknown>).error_code)
        : undefined
    return { ok: false, code: classifyStatus(res.status), status: res.status, ...(vendorCode !== undefined ? { vendorCode } : {}) }
  }
  if (json === null) return { ok: false, code: 'bad_response', status: res.status }
  return { ok: true, json }
}

/**
 * The whole matrix: every request in turn. Any request that fails fails the
 * whole matrix (the browser then uses the estimate for everything and says
 * why). Pairs TravelTime leaves out come back as null, marked partial.
 */
export async function timeFilterMatrix(
  m: MatrixRequest,
  creds: Credentials,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ ok: true; cells: MatrixCell[][]; partial: boolean } | { ok: false; code: FailureCode; status?: number; vendorCode?: number }> {
  const cells: MatrixCell[][] = m.destinations.map(() => new Array(m.origins.length).fill(null))
  let partial = false
  for (const sent of buildRequests(m)) {
    const r = await callTimeFilter(sent.request, creds, fetchImpl, timeoutMs)
    if (!r.ok) return r
    const parsed = parseResponse(r.json, sent, m.origins.length)
    if (!parsed.ok) return { ok: false, code: parsed.code }
    for (const [i, row] of parsed.rows) cells[i] = row
    partial ||= parsed.partial
  }
  return { ok: true, cells, partial }
}
