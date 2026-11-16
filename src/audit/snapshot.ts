import type {
  ActorRef,
  DecisionTerms,
  DecisionV1,
  DecisionV2,
  IsoDateTime,
  PlacementEventBody,
  Property,
  Ruleset,
  SearchResult,
  StatutoryClock,
} from '../engine/types'

export type { PlacementEventBody } from '../engine/types'

/**
 * Everything frozen at the moment of decision. The record of what the officer
 * saw and decided, including every rejected option and why, is the evidence a
 * review, Ombudsman complaint or court will ask for.
 */
interface DecisionSnapshotBase {
  frozenAt: string
  councilName: string
  search: SearchResult
  ruleset: Ruleset
  /** The properties as held when the decision was recorded */
  properties: Property[]
  clocks: StatutoryClock[]
  notes: string[]
}

/** Sealed by schema 1 (the MVP). Still verified and rendered; never written again. */
export interface DecisionSnapshotV1 extends DecisionSnapshotBase {
  schema: 'placement-decision/1'
  decision: DecisionV1
}

/**
 * Sealed from V2: the decider comes from the signed-in session and consent is
 * a record. From phase 2 it also carries `terms` (the hold, the exceptions that
 * need approval, and for a family in shared accommodation the emergency reason
 * and move-on plan). Phase 1 records have no `terms` and are read as legacy.
 */
export interface DecisionSnapshotV2 extends DecisionSnapshotBase {
  schema: 'placement-decision/2'
  decision: DecisionV2
  terms?: DecisionTerms
}

export type DecisionSnapshot = DecisionSnapshotV1 | DecisionSnapshotV2

export interface PlacementEvent {
  schema: 'placement-event/1'
  at: IsoDateTime
  actor: ActorRef
  /** The case, or null for a task about a property rather than a case */
  caseRef: string | null
  /** The decision record this event is about; null for a task about a property */
  about: { seq: number; rowHash: string } | null
  /** For a task about a property (a certificate), which property */
  propertyId?: string
  event: PlacementEventBody
  notes: string[]
}

/** What one chain record holds. */
export type ChainPayload = DecisionSnapshot | PlacementEvent

export function isDecisionSnapshot(p: ChainPayload): p is DecisionSnapshot {
  return p.schema === 'placement-decision/1' || p.schema === 'placement-decision/2'
}

export function isPlacementEvent(p: ChainPayload): p is PlacementEvent {
  return p.schema === 'placement-event/1'
}
