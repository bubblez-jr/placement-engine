import { describe, expect, it, vi } from 'vitest'
import { CEILING_MINUTES, MAX_DESTINATIONS, MAX_ORIGINS, parseMatrixResponse, validateMatrixRequest, type MatrixRequest } from '../api/_lib/contract'
import {
  buildRequests,
  callTimeFilter,
  classifyStatus,
  parseResponse,
  timeFilterMatrix,
  TRAVELTIME_URL,
  MAX_SEARCHES_PER_REQUEST,
  type TtRequest,
} from '../api/_lib/traveltime'
import { handleTravelMatrix, handleTravelStatus, type Deps } from '../api/_lib/handlers'
import { easterSunday, journeyPlanningDate, journeyProvenance, journeySourceOf } from '../src/engine/journeys'
import { createTravelTimeProvider } from '../src/travel/traveltime'
import { estimateProvider } from '../src/travel/estimate'
import type { TravelQuery } from '../src/travel/provider'
import { scenarioSearch, searchHousehold, TODAY } from './fixtures'
import { SCENARIOS } from '../src/data/households'

const NOW_MS = Date.parse('2026-11-16T10:00:00Z')
const req2x1: MatrixRequest = {
  origins: [
    { lat: 51.55, lng: 0.02 },
    { lat: 51.53, lng: 0.06 },
  ],
  destinations: [{ lat: 51.539, lng: 0.005, arriveAt: '2026-11-17T08:45:00.000Z' }],
}

/** A time-filter answer as TravelTime's v4 documentation describes it (written here: no live answer has been seen). */
const goodAnswer = {
  results: [
    {
      search_id: 'd0',
      locations: [{ id: 'o0', properties: [{ travel_time: 1260, distance: 4321 }] }],
      unreachable: ['o1'],
    },
  ],
}

function response(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('journey planning date', () => {
  it('works out Easter', () => {
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
  })
  it('is the first term-time Tuesday to Thursday on or after the date needed', () => {
    expect(journeyPlanningDate('2026-11-17')).toBe('2026-11-17') // Tuesday
    expect(journeyPlanningDate('2026-11-16')).toBe('2026-11-17') // Monday → Tuesday
    expect(journeyPlanningDate('2026-11-20')).toBe('2026-11-24') // Friday → next Tuesday
    expect(journeyPlanningDate('2026-11-19')).toBe('2026-11-19') // Thursday
  })
  it('skips the summer, Christmas and Easter holidays', () => {
    expect(journeyPlanningDate('2026-07-23')).toBe('2026-09-01') // summer → Tuesday 1 September
    expect(journeyPlanningDate('2026-12-22')).toBe('2027-01-05') // Christmas → Tuesday 5 January
    expect(journeyPlanningDate('2027-03-23')).toBe('2027-04-06') // Easter 28 March: 21 March to 4 April skipped
  })
  it('depends on the date needed only, so a search is repeatable', () => {
    expect(journeyPlanningDate('2026-11-21')).toBe(journeyPlanningDate('2026-11-21'))
  })
  it('the ceiling the server sends matches the 4 hours the record states', () => {
    expect(CEILING_MINUTES).toBe(240)
    const p = journeyProvenance({ requested: 'traveltime', fallback: null, counts: { measured: 5, estimated: 0, noRoute: 1 } }, '2026-11-17')
    expect(p.disclaimer).toContain('within 4 hours')
  })
})

describe('TravelTime request builder', () => {
  it('builds one arrival search per place with coordinates and times only', () => {
    const [{ request, destinationIndexes }] = buildRequests(req2x1)
    expect(destinationIndexes).toEqual([0])
    expect(request).toEqual<TtRequest>({
      locations: [
        { id: 'o0', coords: { lat: 51.55, lng: 0.02 } },
        { id: 'o1', coords: { lat: 51.53, lng: 0.06 } },
        { id: 'd0', coords: { lat: 51.539, lng: 0.005 } },
      ],
      arrival_searches: [
        {
          id: 'd0',
          arrival_location_id: 'd0',
          departure_location_ids: ['o0', 'o1'],
          transportation: { type: 'public_transport' },
          arrival_time: '2026-11-17T08:45:00.000Z',
          travel_time: 14400,
          properties: ['travel_time', 'distance'],
        },
      ],
    })
  })
  it('splits places into requests of at most the search limit', () => {
    const m: MatrixRequest = { origins: req2x1.origins, destinations: Array.from({ length: 12 }, () => ({ ...req2x1.destinations[0] })) }
    const reqs = buildRequests(m)
    expect(reqs.map(r => r.request.arrival_searches.length)).toEqual([MAX_SEARCHES_PER_REQUEST, 2])
    expect(reqs[1].request.arrival_searches.map(s => s.id)).toEqual(['d10', 'd11'])
  })
})

describe('TravelTime response parser', () => {
  const sent = buildRequests(req2x1)[0]
  it('reads times in minutes, distances in km, and unreachable places as no route', () => {
    const r = parseResponse(goodAnswer, sent, 2)
    expect(r).toEqual({ ok: true, partial: false, rows: new Map([[0, [{ minutes: 21, km: 4.3 }, { noRoute: true }]]]) })
  })
  it('leaves a distance it was not given as null', () => {
    const r = parseResponse({ results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: 600 }] }], unreachable: ['o1'] }] }, sent, 2)
    expect(r.ok && r.rows.get(0)![0]).toEqual({ minutes: 10, km: null })
  })
  it('marks a missing search or location as partial, with no answer for those pairs', () => {
    const missingLoc = parseResponse({ results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: 60 }] }], unreachable: [] }] }, sent, 2)
    expect(missingLoc.ok && missingLoc.partial).toBe(true)
    expect(missingLoc.ok && missingLoc.rows.get(0)![1]).toBeNull()
    const missingSearch = parseResponse({ results: [] }, sent, 2)
    expect(missingSearch).toEqual({ ok: true, partial: true, rows: new Map([[0, [null, null]]]) })
  })
  it.each([
    ['no results list', { foo: 1 }],
    ['an unknown search', { results: [{ search_id: 'd9', locations: [], unreachable: [] }] }],
    ['an unknown location', { results: [{ search_id: 'd0', locations: [{ id: 'o7', properties: [{ travel_time: 60 }] }], unreachable: [] }] }],
    ['a time over the ceiling', { results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: 14401 }] }], unreachable: [] }] }],
    [
      'a time that is not a whole number of seconds',
      { results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: '600' }] }], unreachable: [] }] },
    ],
    ['properties as an object, not a list', { results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: { travel_time: 600 } }], unreachable: [] }] }],
    [
      'reachable and unreachable at once',
      { results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: 60 }] }], unreachable: ['o0'] }] },
    ],
    ['two answers for one search', { results: [goodAnswer.results[0], goodAnswer.results[0]] }],
  ])('refuses the whole answer for %s', (_, body) => {
    const r = parseResponse(body, sent, 2)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.code).toBe('bad_response')
  })
  it('maps HTTP statuses to reasons', () => {
    expect(classifyStatus(401)).toBe('bad_key')
    expect(classifyStatus(403)).toBe('bad_key')
    expect(classifyStatus(429)).toBe('rate_limited')
    expect(classifyStatus(400)).toBe('rejected')
    expect(classifyStatus(422)).toBe('rejected')
    expect(classifyStatus(500)).toBe('vendor_error')
    expect(classifyStatus(503)).toBe('vendor_error')
  })
})

describe('calling TravelTime', () => {
  const creds = { appId: 'app-123', apiKey: 'key-secret' }
  it('posts to time-filter with the key in the headers only', async () => {
    const f = vi.fn(async () => response(200, goodAnswer))
    const r = await timeFilterMatrix(req2x1, creds, f as unknown as typeof fetch, 1000)
    expect(r).toEqual({ ok: true, partial: false, cells: [[{ minutes: 21, km: 4.3 }, { noRoute: true }]] })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(TRAVELTIME_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'X-Application-Id': 'app-123', 'X-Api-Key': 'key-secret', 'Content-Type': 'application/json' })
    expect(String(init.body)).not.toContain('key-secret')
  })
  it('reports a timeout', async () => {
    const f = (_: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const r = await callTimeFilter(buildRequests(req2x1)[0].request, creds, f as unknown as typeof fetch, 20)
    expect(r).toEqual({ ok: false, code: 'timeout' })
  })
  it('reports an unreachable network', async () => {
    const r = await callTimeFilter(buildRequests(req2x1)[0].request, creds, (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch, 1000)
    expect(r).toEqual({ ok: false, code: 'network' })
  })
  it('reports a bad key, a rate limit and a rejected request with the vendor code', async () => {
    for (const [status, code] of [
      [401, 'bad_key'],
      [429, 'rate_limited'],
      [400, 'rejected'],
    ] as const) {
      const r = await timeFilterMatrix(
        req2x1,
        creds,
        (async () => response(status, { http_status: status, error_code: 7, description: 'x' })) as typeof fetch,
        1000,
      )
      expect(r).toEqual({ ok: false, code, status, vendorCode: 7 })
    }
  })
  it('reports an answer that is not JSON', async () => {
    const r = await timeFilterMatrix(req2x1, creds, (async () => response(200, '<html>')) as typeof fetch, 1000)
    expect(r).toEqual({ ok: false, code: 'bad_response', status: 200 })
  })
})

describe('the travel-matrix function', () => {
  const env = { TRAVELTIME_APP_ID: 'app-123', TRAVELTIME_API_KEY: 'key-secret' }
  function deps(over: Partial<Deps> = {}): Deps & { logs: string[] } {
    const logs: string[] = []
    return {
      env,
      fetch: (async () => response(200, goodAnswer)) as typeof fetch,
      now: () => NOW_MS,
      log: (e, f) => logs.push(JSON.stringify({ e, ...f })),
      logs,
      ...over,
    }
  }
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://placement.example/api/travel-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'placement.example', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  it('answers with minutes and distances per pair', async () => {
    const d = deps()
    const res = await handleTravelMatrix(post(req2x1), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({ ok: true, source: 'traveltime', partial: false, cells: [[{ minutes: 21, km: 4.3 }, { noRoute: true }]] })
    expect(JSON.stringify(body)).not.toContain('key-secret')
  })
  it('logs outcome codes and counts only, never coordinates or times', async () => {
    const d = deps()
    await handleTravelMatrix(post(req2x1), d)
    await handleTravelMatrix(post(req2x1), deps({ fetch: (async () => response(401, {})) as typeof fetch, log: d.log }))
    expect(d.logs.length).toBe(2)
    for (const line of d.logs) {
      expect(line).not.toMatch(/51\.5|0\.02|08:45|2026-11-17|key-secret|app-123/)
    }
    expect(d.logs[1]).toContain('"outcome":"bad_key"')
  })
  it.each([
    ['GET', new Request('https://placement.example/api/travel-matrix'), 405],
    ['another site', post(req2x1, { origin: 'https://evil.example' }), 403],
    ['not JSON', new Request('https://placement.example/api/travel-matrix', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }), 415],
    ['a broken body', post('{"origins":'), 400],
    ['too large', post({ origins: 'x'.repeat(40_000) }), 413],
  ])('refuses %s', async (_, request, status) => {
    const d = deps()
    const res = await handleTravelMatrix(request, d)
    expect(res.status).toBe(status)
    expect((await res.json()).code).toBe('invalid_request')
  })
  it('accepts its own site as the origin', async () => {
    const res = await handleTravelMatrix(post(req2x1, { origin: 'https://placement.example' }), deps())
    expect(res.status).toBe(200)
  })
  it.each([
    ['an extra field', { ...req2x1, caseRef: 'HN-1' }, /Fields not accepted: caseRef/],
    ['an id on a point', { ...req2x1, origins: [{ lat: 51.5, lng: 0, id: 'P05' }] }, /not accepted: id/],
    ['a point outside the UK', { ...req2x1, origins: [{ lat: 48.85, lng: 2.35 }] }, /outside the UK/],
    ['a latitude out of range', { ...req2x1, origins: [{ lat: 91, lng: 0 }] }, /lat must be/],
    ['a coordinate as text', { ...req2x1, origins: [{ lat: '51.5', lng: 0 }] }, /lat must be/],
    ['too many properties', { ...req2x1, origins: Array.from({ length: MAX_ORIGINS + 1 }, () => req2x1.origins[0]) }, /1 to 60/],
    ['too many places', { ...req2x1, destinations: Array.from({ length: MAX_DESTINATIONS + 1 }, () => req2x1.destinations[0]) }, /1 to 12/],
    ['no places', { ...req2x1, destinations: [] }, /1 to 12/],
    ['an arrival that is not a date and time', { ...req2x1, destinations: [{ lat: 51.5, lng: 0, arriveAt: '08:45' }] }, /ISO 8601/],
    ['an arrival years away', { ...req2x1, destinations: [{ lat: 51.5, lng: 0, arriveAt: '2030-01-01T09:00:00Z' }] }, /18 months/],
  ])('validates strictly: %s', async (_, body, msg) => {
    const res = await handleTravelMatrix(post(body), deps())
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.code).toBe('invalid_request')
    expect(j.message).toMatch(msg)
  })
  it('says when it is not configured, without calling TravelTime', async () => {
    const f = vi.fn()
    const res = await handleTravelMatrix(post(req2x1), deps({ env: { TRAVELTIME_APP_ID: 'x', TRAVELTIME_API_KEY: ' ' }, fetch: f as unknown as typeof fetch }))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('not_configured')
    expect(f).not.toHaveBeenCalled()
  })
  it('passes on vendor failures as codes, with no vendor text', async () => {
    for (const [status, code, ours] of [
      [401, 'bad_key', 502],
      [429, 'rate_limited', 429],
      [500, 'vendor_error', 502],
    ] as const) {
      const res = await handleTravelMatrix(
        post(req2x1),
        deps({ fetch: (async () => response(status, { description: 'Secret vendor text 51.5' })) as typeof fetch }),
      )
      expect(res.status).toBe(ours)
      const j = await res.json()
      expect(j.code).toBe(code)
      expect(JSON.stringify(j)).not.toContain('Secret vendor text')
    }
  })
  it('marks a partial answer', async () => {
    const res = await handleTravelMatrix(
      post(req2x1),
      deps({
        fetch: (async () =>
          response(200, { results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: 600 }] }], unreachable: [] }] })) as typeof fetch,
      }),
    )
    expect(await res.json()).toEqual({ ok: true, source: 'traveltime', partial: true, cells: [[{ minutes: 10, km: null }, null]] })
  })
})

describe('the travel-status function', () => {
  const base = {
    fetch: (async () =>
      response(200, { results: [{ search_id: 'd0', locations: [{ id: 'o0', properties: [{ travel_time: 1500 }] }], unreachable: [] }] })) as typeof fetch,
    now: () => NOW_MS,
    log: () => {},
  }
  it('says whether TravelTime is configured, and never returns the key', async () => {
    const off = await handleTravelStatus(new Request('https://x/api/travel-status'), { ...base, env: {} })
    expect(await off.json()).toEqual({ configured: false, provider: 'traveltime', region: null })
    const on = await handleTravelStatus(new Request('https://x/api/travel-status'), {
      ...base,
      env: { TRAVELTIME_APP_ID: 'a', TRAVELTIME_API_KEY: 'key-secret', VERCEL_REGION: 'lhr1' },
    })
    const text = await on.text()
    expect(JSON.parse(text)).toEqual({ configured: true, provider: 'traveltime', region: 'lhr1' })
    expect(text).not.toContain('key-secret')
  })
  it('with ?check=1 makes one small real request and reports the result', async () => {
    const env = { TRAVELTIME_APP_ID: 'a', TRAVELTIME_API_KEY: 'k' }
    const ok = await handleTravelStatus(new Request('https://x/api/travel-status?check=1'), { ...base, env })
    expect((await ok.json()).check).toEqual({ ok: true, minutes: 25 })
    const badKey = await handleTravelStatus(new Request('https://x/api/travel-status?check=1'), {
      ...base,
      env,
      fetch: (async () => response(401, {})) as typeof fetch,
    })
    expect((await badKey.json()).check).toMatchObject({ ok: false, code: 'bad_key' })
  })
})

describe('the browser provider', () => {
  const q: TravelQuery = {
    origins: [
      { id: 'P01', location: { lat: 51.55, lng: 0.02 } },
      { id: 'P02', location: { lat: 51.53, lng: 0.06 } },
    ],
    destinations: [
      { id: 'd1', location: { lat: 51.539, lng: 0.005 }, arriveBy: '08:45' },
      { id: '__home', location: { lat: 51.548, lng: 0.026 }, arriveBy: '09:00' },
    ],
    mode: 'public_transport',
    date: '2026-11-17',
  }
  const statusOn = () => response(200, { configured: true, provider: 'traveltime', region: 'lhr1' })
  function server(matrix: (body: MatrixRequest) => Response | Promise<Response>, status: () => Response = statusOn) {
    const calls: { url: string; body?: string }[] = []
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined })
      if (url.endsWith('/api/travel-status')) return status()
      return matrix(JSON.parse(String(init?.body)))
    }) as unknown as typeof fetch
    return { f, calls }
  }
  const allMeasured = (b: MatrixRequest) =>
    response(200, {
      ok: true,
      source: 'traveltime',
      partial: false,
      cells: b.destinations.map((_, di) => b.origins.map((_, oi) => ({ minutes: 10 + di * 10 + oi, km: 3.2 }))),
    })

  it('uses TravelTime when configured, and records every journey as measured', async () => {
    const { f, calls } = server(allMeasured)
    const r = await createTravelTimeProvider({ fetch: f }).matrix(q)
    expect(r.run).toEqual({ requested: 'traveltime', fallback: null, counts: { measured: 4, estimated: 0, noRoute: 0 } })
    expect(r.cells.find(c => c.originId === 'P02' && c.destinationId === 'd1')).toEqual({
      originId: 'P02',
      destinationId: 'd1',
      minutes: 11,
      distanceKm: 3.2,
      source: 'traveltime',
    })
    const body = JSON.parse(calls.find(c => c.url.endsWith('/api/travel-matrix'))!.body!)
    // Coordinates and arrival times only: no property, place or case ids.
    expect(body).toEqual({
      origins: [
        { lat: 51.55, lng: 0.02 },
        { lat: 51.53, lng: 0.06 },
      ],
      destinations: [
        { lat: 51.539, lng: 0.005, arriveAt: '2026-11-17T08:45:00.000Z' },
        { lat: 51.548, lng: 0.026, arriveAt: '2026-11-17T09:00:00.000Z' },
      ],
    })
  })
  it('plans the arrival in UK summer time when it applies', async () => {
    const { f, calls } = server(allMeasured)
    await createTravelTimeProvider({ fetch: f }).matrix({ ...q, date: '2026-06-16' })
    const body = JSON.parse(calls.find(c => c.url.endsWith('/api/travel-matrix'))!.body!)
    expect(body.destinations[0].arriveAt).toBe('2026-06-16T07:45:00.000Z')
  })
  it.each([
    ['not configured', () => server(allMeasured, () => response(200, { configured: false, provider: 'traveltime', region: null })), 'not_configured'],
    ['the status check failing', () => server(allMeasured, () => Promise.reject(new TypeError('offline')) as unknown as Response), 'status_unavailable'],
    [
      'the status page being the app itself (local dev server)',
      () => server(allMeasured, () => new Response('<!doctype html>', { status: 200 })),
      'status_unavailable',
    ],
    ['a bad key', () => server(() => response(502, { ok: false, code: 'bad_key', message: 'x' })), 'bad_key'],
    ['a rate limit', () => server(() => response(429, { ok: false, code: 'rate_limited', message: 'x' })), 'rate_limited'],
    ['the server timing out', () => server(() => response(504, { ok: false, code: 'timeout', message: 'x' })), 'timeout'],
    ['a refused request', () => server(() => response(400, { ok: false, code: 'invalid_request', message: 'x' })), 'invalid_request'],
    [
      'an answer of the wrong size',
      () => server(() => response(200, { ok: true, source: 'traveltime', partial: false, cells: [[{ minutes: 5, km: 1 }]] })),
      'bad_response',
    ],
    [
      'a time out of range',
      () =>
        server(b =>
          response(200, { ok: true, source: 'traveltime', partial: false, cells: b.destinations.map(() => b.origins.map(() => ({ minutes: 999, km: 1 }))) }),
        ),
      'bad_response',
    ],
    ['an unknown failure code', () => server(() => response(500, { ok: false, code: 'meltdown' })), 'bad_response'],
    ['the network failing', () => server(() => Promise.reject(new TypeError('offline')) as unknown as Response), 'network'],
  ])('falls back to the estimate for everything on %s, and records why', async (_, make, code) => {
    const { f } = make()
    const r = await createTravelTimeProvider({ fetch: f }).matrix(q)
    expect(r.run).toEqual({ requested: 'traveltime', fallback: { code, pairs: 4 }, counts: { measured: 0, estimated: 4, noRoute: 0 } })
    const est = await estimateProvider.matrix(q)
    expect(r.cells).toEqual(est.cells)
    expect(r.cells.every(c => c.source === 'estimate')).toBe(true)
  })
  it('falls back on its own timeout', async () => {
    const { f } = server(() => new Promise<Response>(() => {}))
    const slow = (async (url: string, init?: RequestInit) =>
      url.endsWith('/api/travel-matrix')
        ? new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
        : f(url, init)) as unknown as typeof fetch
    const r = await createTravelTimeProvider({ fetch: slow, timeoutMs: 20 }).matrix(q)
    expect(r.run.fallback).toEqual({ code: 'timeout', pairs: 4 })
  })
  it('fills a partial answer with marked estimates, and keeps no-route answers', async () => {
    const { f } = server(() =>
      response(200, {
        ok: true,
        source: 'traveltime',
        partial: true,
        cells: [
          [{ minutes: 30, km: null }, null],
          [{ noRoute: true }, { minutes: 12, km: 2 }],
        ],
      }),
    )
    const r = await createTravelTimeProvider({ fetch: f }).matrix(q)
    expect(r.run).toEqual({ requested: 'traveltime', fallback: { code: 'partial', pairs: 1 }, counts: { measured: 3, estimated: 1, noRoute: 1 } })
    const byKey = (o: string, d: string) => r.cells.find(c => c.originId === o && c.destinationId === d)!
    expect(byKey('P02', 'd1').source).toBe('estimate')
    expect(byKey('P01', '__home')).toMatchObject({ minutes: null, source: 'traveltime' })
    // No distance from TravelTime: the straight line is kept, never a made-up route distance.
    expect(byKey('P01', 'd1')).toMatchObject({ minutes: 30, source: 'traveltime', distanceKm: (await estimateProvider.matrix(q)).cells[0].distanceKm })
  })
  it('splits a large inventory into requests the server accepts', async () => {
    const big: TravelQuery = { ...q, origins: Array.from({ length: 61 }, (_, i) => ({ id: `P${i}`, location: { lat: 51.5, lng: 0.01 * (i % 10) } })) }
    const { f, calls } = server(allMeasured)
    const r = await createTravelTimeProvider({ fetch: f }).matrix(big)
    const posts = calls.filter(c => c.url.endsWith('/api/travel-matrix')).map(c => JSON.parse(c.body!))
    expect(posts.map(p => p.origins.length)).toEqual([60, 1])
    expect(posts.every(p => validateMatrixRequest(p, NOW_MS).ok)).toBe(true)
    expect(r.run.counts.measured).toBe(122)
  })
  it('asks the server once for its status', async () => {
    const { f, calls } = server(allMeasured)
    const p = createTravelTimeProvider({ fetch: f })
    await p.matrix(q)
    await p.matrix(q)
    expect(calls.filter(c => c.url.endsWith('/api/travel-status')).length).toBe(1)
  })
  it('refuses a response with a code it does not know as not understood', () => {
    expect(parseMatrixResponse({ ok: false, code: 'meltdown' }, req2x1)).toMatchObject({ ok: false, code: 'bad_response' })
  })
})

describe('what the search records about its journeys', () => {
  const household = SCENARIOS.find(s => s.id === 'brief')!.household(TODAY)
  it('the estimate on purpose: labelled as the demo model, no fallback', async () => {
    const s = await scenarioSearch('brief')
    expect(s.travelProvider).toMatchObject({ id: 'estimate-v1', requested: 'estimate', outcome: 'estimated', fallback: null, planningDate: '2026-11-03' })
    expect(s.candidates[0].journeys.every(j => j.source === 'estimate')).toBe(true)
  })
  it('TravelTime working: every journey measured, the day recorded', async () => {
    const travel = createTravelTimeProvider({
      fetch: (async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/travel-status')) return response(200, { configured: true, provider: 'traveltime', region: null })
        const b = JSON.parse(String(init!.body)) as MatrixRequest
        return response(200, { ok: true, source: 'traveltime', partial: false, cells: b.destinations.map(() => b.origins.map(() => ({ minutes: 20, km: 5 }))) })
      }) as unknown as typeof fetch,
    })
    const s = await searchHousehold(household, 'S-TT', { travel })
    expect(s.travelProvider).toMatchObject({ id: 'traveltime-v4', requested: 'traveltime', outcome: 'measured', fallback: null, planningDate: '2026-11-03' })
    expect(s.travelProvider.label).toBe('Public transport times from TravelTime')
    expect(s.travelProvider.disclaimer).toContain('Tuesday 3 Nov 2026')
    expect(s.candidates.every(c => c.journeys.every(j => j.source === 'traveltime' && j.minutes === 20))).toBe(true)
  })
  it('TravelTime failing: the estimate, with the reason in the record', async () => {
    const travel = createTravelTimeProvider({
      fetch: (async (url: string) =>
        url.endsWith('/api/travel-status')
          ? response(200, { configured: true, provider: 'traveltime', region: null })
          : response(502, { ok: false, code: 'bad_key', message: '' })) as unknown as typeof fetch,
    })
    const s = await searchHousehold(household, 'S-TT2', { travel })
    expect(s.travelProvider).toMatchObject({ id: 'estimate-v1', requested: 'traveltime', outcome: 'estimated', fallback: { code: 'bad_key' } })
    expect(s.travelProvider.label).toBe('Estimated journey times (TravelTime not used)')
    expect(s.travelProvider.disclaimer).toMatch(/^TravelTime did not accept this site’s key, so every journey time here is an estimate/)
    // Same journeys and the same ranking as the estimate on purpose.
    const est = await scenarioSearch('brief')
    expect(s.candidates.map(c => [c.propertyId, c.rank])).toEqual(est.candidates.map(c => [c.propertyId, c.rank]))
  })
  it('a search recorded before phase 3 reads its journeys as estimates', () => {
    expect(journeySourceOf({}, { id: 'estimate-v1' })).toBe('estimate')
    expect(journeySourceOf({ source: 'traveltime' }, { id: 'estimate-v1' })).toBe('traveltime')
  })
})
