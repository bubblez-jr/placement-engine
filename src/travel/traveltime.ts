import { MAX_DESTINATIONS, MAX_ORIGINS, parseMatrixResponse, type MatrixRequest, type StatusResponse } from '../../api/_lib/contract'
import { ukTimeToIso } from '../engine/dates'
import type { TravelFailureCode } from '../engine/types'
import { estimateCells } from './estimate'
import type { TravelCell, TravelMatrix, TravelProvider, TravelQuery } from './provider'

// Real journey times through this site's own serverless functions, which hold
// the TravelTime key (api/travel-matrix.ts). The browser never talks to
// TravelTime and never sees the key. It sends coordinates and arrival times
// only: no case reference, no names, no property ids.
//
// On any failure the estimate is used instead, and the search records which
// source produced each journey and why it fell back. Nothing here invents a
// time: a pair TravelTime did not answer is filled with the estimate and
// marked as an estimate.

export interface TravelTimeDeps {
  fetch: typeof fetch
  /** Where the site's functions live; '' for the same origin */
  base?: string
  /** How long to wait for the matrix (the server waits 8 seconds for TravelTime) */
  timeoutMs?: number
  statusTimeoutMs?: number
}

async function fetchJson(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; status: number; json: unknown } | { ok: false; code: 'timeout' | 'network' }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await f(url, { ...init, signal: ctrl.signal })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { ok: true, status: res.status, json }
  } catch {
    return { ok: false, code: ctrl.signal.aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

function isStatus(x: unknown): x is StatusResponse {
  return !!x && typeof x === 'object' && typeof (x as StatusResponse).configured === 'boolean' && (x as StatusResponse).provider === 'traveltime'
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export function createTravelTimeProvider(deps: TravelTimeDeps): TravelProvider {
  const base = deps.base ?? ''
  let cached: Promise<{ configured: boolean } | null> | null = null

  /** Whether the server has the key. A failed check is not cached: the next search asks again. */
  function status(): Promise<{ configured: boolean } | null> {
    if (!cached) {
      cached = fetchJson(
        deps.fetch,
        `${base}/api/travel-status`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        deps.statusTimeoutMs ?? 4_000,
      ).then(r => {
        const s = r.ok && r.status === 200 && isStatus(r.json) ? { configured: r.json.configured } : null
        if (!s) cached = null
        return s
      })
    }
    return cached
  }

  async function matrix(q: TravelQuery): Promise<TravelMatrix> {
    const estimate = estimateCells(q)
    const estimateOf = new Map(estimate.map(e => [`${e.originId}|${e.destinationId}`, e]))
    const total = estimate.length
    const fallBack = (code: TravelFailureCode): TravelMatrix => ({
      cells: estimate,
      run: { requested: 'traveltime', fallback: { code, pairs: total }, counts: { measured: 0, estimated: total, noRoute: 0 } },
    })
    if (q.mode !== 'public_transport') return fallBack('invalid_request')

    const s = await status()
    if (!s) return fallBack('status_unavailable')
    if (!s.configured) return fallBack('not_configured')

    const answers = new Map<string, TravelCell>()
    for (const os of chunks(q.origins, MAX_ORIGINS)) {
      for (const ds of chunks(q.destinations, MAX_DESTINATIONS)) {
        const body: MatrixRequest = {
          origins: os.map(o => ({ lat: o.location.lat, lng: o.location.lng })),
          destinations: ds.map(d => ({ lat: d.location.lat, lng: d.location.lng, arriveAt: ukTimeToIso(q.date, d.arriveBy) })),
        }
        const r = await fetchJson(
          deps.fetch,
          `${base}/api/travel-matrix`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
          deps.timeoutMs ?? 12_000,
        )
        if (!r.ok) return fallBack(r.code)
        const parsed = parseMatrixResponse(r.json, body)
        if (!parsed.ok) return fallBack(parsed.code === 'partial' ? 'bad_response' : parsed.code)
        if (r.status !== 200) return fallBack('bad_response')
        parsed.cells.forEach((row, di) =>
          row.forEach((c, oi) => {
            if (!c) return
            const o = os[oi]
            const d = ds[di]
            const est = estimateOf.get(`${o.id}|${d.id}`)!
            answers.set(`${o.id}|${d.id}`, {
              originId: o.id,
              destinationId: d.id,
              minutes: 'noRoute' in c ? null : c.minutes,
              // TravelTime's route distance when it gives one; otherwise the straight line the estimate uses.
              distanceKm: 'noRoute' in c ? est.distanceKm : (c.km ?? est.distanceKm),
              source: 'traveltime',
            })
          }),
        )
      }
    }
    const cells = estimate.map(e => answers.get(`${e.originId}|${e.destinationId}`) ?? e)
    const measured = cells.filter(c => c.source === 'traveltime').length
    const noRoute = cells.filter(c => c.source === 'traveltime' && c.minutes === null).length
    const estimated = total - measured
    return {
      cells,
      run: {
        requested: 'traveltime',
        fallback: estimated > 0 ? { code: 'partial', pairs: estimated } : null,
        counts: { measured, estimated, noRoute },
      },
    }
  }

  return { id: 'traveltime-v4', matrix }
}
