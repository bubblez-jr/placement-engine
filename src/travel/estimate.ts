import { haversineKm } from '../engine/geo'
import type { TravelCell, TravelMatrix, TravelProvider, TravelQuery } from './provider'

/**
 * Demo-only journey estimate from straight-line distance. It is deliberately
 * simple and labelled everywhere it appears. It is also the fallback whenever
 * TravelTime is not switched on or fails.
 *
 * Public transport: walk if under ~1.5 km and quicker; otherwise 8 min to get
 * to a stop + 5 min wait + in-vehicle time on a road distance of 1.3× the
 * straight line, at a speed that rises with distance (bus → rail), plus 6 min
 * for a change on longer trips.
 */
export function estimatePublicTransportMinutes(km: number): number {
  const road = km * 1.3
  const walk = ((km * 1.25) / 4.8) * 60
  const speed = km < 3 ? 14 : km < 12 ? 20 : km < 30 ? 28 : 45
  const change = km > 8 ? 6 : 0
  const pt = 8 + 5 + (road / speed) * 60 + change
  return Math.round(km < 1.5 ? Math.min(walk, pt) : pt)
}

export function estimateDriveMinutes(km: number): number {
  const road = km * 1.35
  const speed = km < 8 ? 22 : km < 25 ? 35 : 55
  return Math.round(4 + (road / speed) * 60)
}

/** The estimate for every pair in a query. */
export function estimateCells(q: TravelQuery): TravelCell[] {
  const out: TravelCell[] = []
  for (const o of q.origins) {
    for (const d of q.destinations) {
      const km = haversineKm(o.location, d.location)
      const minutes =
        q.mode === 'drive' ? estimateDriveMinutes(km) : q.mode === 'walk' ? Math.round(((km * 1.25) / 4.8) * 60) : estimatePublicTransportMinutes(km)
      out.push({ originId: o.id, destinationId: d.id, minutes, distanceKm: Math.round(km * 10) / 10, source: 'estimate' })
    }
  }
  return out
}

export const estimateProvider: TravelProvider = {
  id: 'estimate-v1',
  async matrix(q: TravelQuery): Promise<TravelMatrix> {
    const cells = estimateCells(q)
    return { cells, run: { requested: 'estimate', fallback: null, counts: { measured: 0, estimated: cells.length, noRoute: 0 } } }
  },
}
