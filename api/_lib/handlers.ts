import { MAX_BODY_BYTES, validateMatrixRequest, type FailureCode, type MatrixResponse, type StatusResponse } from './contract.js'
import { failureMessage, timeFilterMatrix } from './traveltime.js'

// The logic of the two serverless functions, as plain functions of a
// Request and their dependencies, so they are unit-tested here with a mocked
// fetch. The files in `api/` only wire these to the platform.
//
// Logging: an outcome code and counts only. Never a coordinate, a time, a
// request body or a vendor message, and never the key.

export interface Env {
  TRAVELTIME_APP_ID?: string
  TRAVELTIME_API_KEY?: string
  VERCEL_REGION?: string
}

export interface Deps {
  env: Env
  fetch: typeof fetch
  now: () => number
  log: (event: string, fields: Record<string, string | number | boolean>) => void
  /** Per vendor request; the browser waits a little longer than this */
  timeoutMs?: number
}

export function liveDeps(env: Env): Deps {
  return {
    env,
    fetch: (...a) => globalThis.fetch(...a),
    now: () => Date.now(),
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  }
}

const DEFAULT_TIMEOUT_MS = 8_000

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}

function fail(status: number, code: FailureCode, message: string, extra: Record<string, string> = {}): Response {
  const body: MatrixResponse = { ok: false, code, message }
  return json(status, body, extra)
}

function credentials(env: Env): { appId: string; apiKey: string } | null {
  const appId = (env.TRAVELTIME_APP_ID ?? '').trim()
  const apiKey = (env.TRAVELTIME_API_KEY ?? '').trim()
  return appId && apiKey ? { appId, apiKey } : null
}

/** A browser on another site may not use this site's key. Requests without an Origin header (same-origin GETs, tools) pass. */
function crossSite(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return true
  }
  const own = new Set<string>()
  for (const h of [req.headers.get('x-forwarded-host'), req.headers.get('host')]) if (h) own.add(h.split(',')[0].trim())
  try {
    own.add(new URL(req.url).host)
  } catch {
    /* relative URL: rely on the headers */
  }
  return !own.has(host)
}

const STATUS_FOR: Record<FailureCode, number> = {
  not_configured: 503,
  status_unavailable: 503,
  invalid_request: 400,
  bad_key: 502,
  rate_limited: 429,
  timeout: 504,
  network: 502,
  rejected: 502,
  vendor_error: 502,
  bad_response: 502,
  partial: 200,
}

/** POST /api/travel-matrix: coordinates and arrival times in, minutes and distances out. */
export async function handleTravelMatrix(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'invalid_request', 'Use POST.', { Allow: 'POST' })
  if (crossSite(req)) return fail(403, 'invalid_request', 'This service answers this site only.')
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return fail(415, 'invalid_request', 'Send JSON.')
  const text = await req.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, 'invalid_request', 'The request is too large.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'invalid_request', 'The request is not valid JSON.')
  }
  const v = validateMatrixRequest(body, deps.now())
  if (!v.ok) {
    deps.log('travel-matrix', { outcome: 'invalid_request' })
    return fail(400, 'invalid_request', v.message)
  }
  const creds = credentials(deps.env)
  if (!creds) {
    deps.log('travel-matrix', { outcome: 'not_configured' })
    return fail(503, 'not_configured', failureMessage('not_configured'))
  }
  const counts = { origins: v.value.origins.length, destinations: v.value.destinations.length }
  const r = await timeFilterMatrix(v.value, creds, deps.fetch, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (!r.ok) {
    deps.log('travel-matrix', {
      outcome: r.code,
      ...counts,
      ...(r.status !== undefined ? { vendorStatus: r.status } : {}),
      ...(r.vendorCode !== undefined ? { vendorCode: r.vendorCode } : {}),
    })
    return fail(STATUS_FOR[r.code], r.code, failureMessage(r.code))
  }
  deps.log('travel-matrix', { outcome: r.partial ? 'partial' : 'ok', ...counts })
  const out: MatrixResponse = { ok: true, source: 'traveltime', cells: r.cells, partial: r.partial }
  return json(200, out)
}

// Two fixed public places for the key check: Stratford station to Liverpool Street station.
const CHECK_FROM = { lat: 51.5416, lng: -0.0034 }
const CHECK_TO = { lat: 51.5178, lng: -0.0823 }

/**
 * GET /api/travel-status: whether TravelTime is configured. With `?check=1`
 * it also makes one small real request between two fixed stations, so the
 * person switching it on can see the key and the request format work.
 */
export async function handleTravelStatus(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' })
  const creds = credentials(deps.env)
  const out: StatusResponse = { configured: !!creds, provider: 'traveltime', region: deps.env.VERCEL_REGION ?? null }
  let wantCheck = false
  try {
    wantCheck = new URL(req.url, 'http://localhost').searchParams.get('check') === '1'
  } catch {
    wantCheck = false
  }
  if (wantCheck) {
    if (crossSite(req)) return json(403, { error: 'This service answers this site only.' })
    if (!creds) out.check = { ok: false, code: 'not_configured', message: failureMessage('not_configured') }
    else {
      // Next Tuesday-to-Thursday morning at 09:00 UTC, a few days ahead.
      let d = new Date(deps.now() + 2 * 86_400_000)
      while (d.getUTCDay() < 2 || d.getUTCDay() > 4) d = new Date(d.getTime() + 86_400_000)
      const arriveAt = `${d.toISOString().slice(0, 10)}T09:00:00Z`
      const r = await timeFilterMatrix(
        { origins: [CHECK_FROM], destinations: [{ ...CHECK_TO, arriveAt }] },
        creds,
        deps.fetch,
        deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )
      const cell = r.ok ? r.cells[0][0] : null
      if (!r.ok) out.check = { ok: false, code: r.code, message: failureMessage(r.code) }
      else if (cell && 'minutes' in cell) out.check = { ok: true, minutes: cell.minutes }
      else out.check = { ok: false, code: 'partial', message: 'TravelTime answered but gave no time for the test journey' }
      deps.log('travel-status-check', { outcome: out.check.ok ? 'ok' : out.check.code })
    }
  }
  return json(200, out)
}
