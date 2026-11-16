import type { ActorRef, ConsentRecord, DecisionV1, DecisionV2, IsoDateTime, Property, Ruleset, SearchResult, StatutoryClock } from '../engine/types'

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

/** Sealed from V2: the decider comes from the signed-in session and consent is a record. */
export interface DecisionSnapshotV2 extends DecisionSnapshotBase {
  schema: 'placement-decision/2'
  decision: DecisionV2
}

export type DecisionSnapshot = DecisionSnapshotV1 | DecisionSnapshotV2

/**
 * A later fact about a sealed decision. Nothing sealed is ever edited: a
 * change is a new record that points back to the one it is about.
 * Phase 1 writes `consent_updated`; the other bodies are reserved for phase 2
 * (placements, approvals, tasks) so the chain format does not change again.
 */
export type PlacementEventBody =
  | { type: 'consent_updated'; consent: ConsentRecord; previous: ConsentRecord | { legacyConsentToNotify: boolean } | null }
  | { type: 'placement_transition'; placementId: string; from: string; to: string; details: Record<string, string> }
  | { type: 'approval'; outcome: 'approved' | 'rejected'; exception: string; reason: string }
  | { type: 'task_completed'; taskId: string; evidence: string; reference: string }

export interface PlacementEvent {
  schema: 'placement-event/1'
  at: IsoDateTime
  actor: ActorRef
  caseRef: string
  /** The decision record this event is about */
  about: { seq: number; rowHash: string }
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
