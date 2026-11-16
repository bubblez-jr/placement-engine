import type { TravelRunSummary } from '../engine/journeys'
import type { IsoDate, JourneySource, LatLng } from '../engine/types'

export type TravelMode = 'public_transport' | 'walk' | 'drive'

export interface TravelPoint {
  id: string
  location: LatLng
}

export interface TravelDestination extends TravelPoint {
  /** Arrive-by time, HH:MM UK time, on the query's date */
  arriveBy: string
}

export interface TravelQuery {
  origins: TravelPoint[]
  destinations: TravelDestination[]
  mode: TravelMode
  /** The term-time weekday to plan for (YYYY-MM-DD), chosen by the engine from the search's inputs */
  date: IsoDate
}

export interface TravelCell {
  originId: string
  destinationId: string
  /** null = no route found within the search limit */
  minutes: number | null
  distanceKm: number
  source: JourneySource
}

export interface TravelMatrix {
  cells: TravelCell[]
  /** What was asked for, what produced the times and, if it fell back, why */
  run: TravelRunSummary
}

/**
 * Any journey-time source. The engine never calls a vendor directly: it gets a
 * provider passed in, so the estimate, TravelTime (through this site's own
 * server, `src/travel/traveltime.ts`) or a self-hosted router can be used
 * without touching scoring. Whatever answers, the search records which source
 * produced each journey and whether it fell back, and that is frozen into
 * every decision snapshot.
 */
export interface TravelProvider {
  id: string
  label: string
  disclaimer: string
  matrix(q: TravelQuery): Promise<TravelMatrix>
}
