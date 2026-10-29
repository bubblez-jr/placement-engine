import type { LatLng } from '../engine/types'

export type TravelMode = 'public_transport' | 'walk' | 'drive'

export interface TravelPoint {
  id: string
  location: LatLng
}

export interface TravelQuery {
  origins: TravelPoint[]
  destinations: TravelPoint[]
  mode: TravelMode
  /** Arrive-by time HH:MM on a term-time weekday */
  arriveBy: string
}

export interface TravelCell {
  originId: string
  destinationId: string
  /** null = not reachable */
  minutes: number | null
  distanceKm: number
}

/**
 * Any journey-time source. The engine never calls a vendor directly, so the
 * demo estimate can be swapped for TravelTime (time-filter/fast) or a
 * self-hosted r5 router without touching scoring. Whatever the provider,
 * its id, label and assumptions are frozen into every decision snapshot.
 */
export interface TravelProvider {
  id: string
  label: string
  disclaimer: string
  matrix(q: TravelQuery): Promise<TravelCell[]>
}
