import { haversineKm } from '../engine/geo'
import type { TravelCell, TravelProvider, TravelQuery } from './provider'

/**
 * Demo-only journey estimate from straight-line distance. It is deliberately
 * simple and labelled everywhere it appears. Replace before any pilot.
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

export const estimateProvider: TravelProvider = {
  id: 'estimate-v1',
  label: 'Estimated journey times (demo model)',
  disclaimer:
    'Journey times are estimated from straight-line distance for this demo. A pilot uses timetable-based times (TravelTime or a self-hosted r5 router on bus and rail timetables).',
  async matrix(q: TravelQuery): Promise<TravelCell[]> {
    const out: TravelCell[] = []
    for (const o of q.origins) {
      for (const d of q.destinations) {
        const km = haversineKm(o.location, d.location)
        const minutes =
          q.mode === 'drive' ? estimateDriveMinutes(km) : q.mode === 'walk' ? Math.round(((km * 1.25) / 4.8) * 60) : estimatePublicTransportMinutes(km)
        out.push({ originId: o.id, destinationId: d.id, minutes, distanceKm: Math.round(km * 10) / 10 })
      }
    }
    return out
  },
}
