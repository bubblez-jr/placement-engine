import { isDecisionV2, type ConsentRecord, type StatutoryClock } from '../engine/types'
import { ROLE_LABEL } from '../engine/permissions'
import { CONSENT_METHOD_LABEL, CONSENT_STATUS_LABEL } from '../engine/decision'
import type { ChainRecord, DecisionRecord } from './chain'
import { isDecisionSnapshot, isPlacementEvent, type DecisionSnapshot, type PlacementEvent } from './snapshot'

// Read-only views over the chain that every screen shares, so a schema-1
// record and a V2 record render through the same code. Nothing here changes
// a sealed record: later facts are read from later events.

export function decisionRecords(chain: ChainRecord[]): DecisionRecord[] {
  return chain.filter((r): r is DecisionRecord => isDecisionSnapshot(r.snapshot))
}

export function eventsAbout(chain: ChainRecord[], seq: number): ChainRecord<PlacementEvent>[] {
  return chain.filter((r): r is ChainRecord<PlacementEvent> => isPlacementEvent(r.snapshot) && r.snapshot.about.seq === seq)
}

export interface Decider {
  name: string
  roleLabel: string
  /** True when the name came from a signed-in session (V2); false for schema-1 free text */
  signedIn: boolean
}

export function deciderOf(s: DecisionSnapshot): Decider {
  const d = s.decision
  if (isDecisionV2(d)) return { name: d.decidedBy.name, roleLabel: d.decidedBy.roleLabel || ROLE_LABEL[d.decidedBy.role], signedIn: true }
  return { name: d.officer, roleLabel: d.officerRole, signedIn: false }
}

export type ConsentView =
  /** No children, or no placement: s213AA does not apply */
  | { kind: 'not_applicable' }
  /** Schema 1 recorded a tick-box, not who or how */
  | { kind: 'legacy'; consented: boolean }
  | { kind: 'record'; consent: ConsentRecord }

export function consentAtDecision(s: DecisionSnapshot): ConsentView {
  const d = s.decision
  if (isDecisionV2(d)) return d.consent ? { kind: 'record', consent: d.consent } : { kind: 'not_applicable' }
  if (!s.search.household.members.some(m => m.role === 'child')) return { kind: 'not_applicable' }
  return { kind: 'legacy', consented: d.consentToNotifyServices }
}

export interface ConsentHistoryEntry {
  /** Chain record that holds this entry */
  seq: number
  consent: ConsentRecord
}

/** Consent as it stands now: the latest consent event about this decision, else what the decision sealed. */
export function currentConsent(chain: ChainRecord[], rec: DecisionRecord): { now: ConsentView; updates: ConsentHistoryEntry[] } {
  const updates: ConsentHistoryEntry[] = []
  for (const e of eventsAbout(chain, rec.seq)) if (e.snapshot.event.type === 'consent_updated') updates.push({ seq: e.seq, consent: e.snapshot.event.consent })
  const last = updates[updates.length - 1]
  return { now: last ? { kind: 'record', consent: last.consent } : consentAtDecision(rec.snapshot), updates }
}

/** One line for any consent view, for tables and the PDF. */
export function consentSummary(v: ConsentView): string {
  if (v.kind === 'not_applicable') return 'Not applicable'
  if (v.kind === 'legacy')
    return `Consent recorded as ${v.consented ? 'yes' : 'no'} under the earlier version (a tick-box: who gave it and how were not recorded)`
  const c = v.consent
  if (c.status === 'not_asked') return `${CONSENT_STATUS_LABEL.not_asked}: ${c.reason ?? ''}`
  return `${CONSENT_STATUS_LABEL[c.status]} by ${c.givenBy}, ${c.method ? CONSENT_METHOD_LABEL[c.method].toLowerCase() : 'method not recorded'}`
}

/**
 * Deadlines as they stand now. The sealed clocks never change; a later consent
 * event only changes how the consent-related ones read.
 */
export function clocksNow(chain: ChainRecord[], rec: DecisionRecord): StatutoryClock[] {
  const { now, updates } = currentConsent(chain, rec)
  const sealed = rec.snapshot.clocks
  if (updates.length === 0 || now.kind !== 'record') return sealed
  const status = now.consent.status
  return sealed.map(c => {
    if (c.key === 'consent-follow-up' && status !== 'not_asked') return { ...c, status: 'done' as const }
    if (c.key === 's213aa' && status === 'refused')
      return { ...c, status: 'done' as const, label: 'Consent refused: do not notify the school, GP or health visitor' }
    if (c.key === 's213aa' && status === 'given') return { ...c, label: "Notify the children's school(s), GP and health visitor" }
    return c
  })
}

/** Short description of any chain record, for the audit log. */
export function recordKind(r: ChainRecord): string {
  const p = r.snapshot
  if (isDecisionSnapshot(p)) return p.schema === 'placement-decision/1' ? 'Decision (earlier version)' : 'Decision'
  switch (p.event.type) {
    case 'consent_updated':
      return `Consent update for #${p.about.seq}`
    case 'placement_transition':
      return `Placement update for #${p.about.seq}`
    case 'approval':
      return `Approval for #${p.about.seq}`
    case 'task_completed':
      return `Task completed for #${p.about.seq}`
  }
}

export function caseRefOf(r: ChainRecord): string {
  return isDecisionSnapshot(r.snapshot) ? r.snapshot.search.household.caseRef : r.snapshot.caseRef
}

export function actorNameOf(r: ChainRecord): string {
  return isDecisionSnapshot(r.snapshot) ? deciderOf(r.snapshot).name : r.snapshot.actor.name
}

export function sealedAt(r: ChainRecord): string {
  return isDecisionSnapshot(r.snapshot) ? r.snapshot.frozenAt : r.snapshot.at
}
