import {
  isDecisionV2,
  type ConsentRecord,
  type ExportFormat,
  type EventFact,
  type IsoDateTime,
  type Property,
  type Ruleset,
  type StatutoryClock,
  type TaskOwner,
} from '../engine/types'
import { ROLE_LABEL } from '../engine/permissions'
import { CONSENT_METHOD_LABEL, CONSENT_STATUS_LABEL, EMERGENCY_REASON_LABEL, MOVE_ON_ROUTE_LABEL, sixWeekRuleApplies } from '../engine/decision'
import { addDays, addHours, formatDate, formatUkTimeOn } from '../engine/dates'
import { quoted } from '../engine/text'
import { bnbLimitDays, EXCEPTION_LABEL, placementPolicyOf } from '../engine/policy'
import {
  DESTINATION_LABEL,
  foldApproval,
  foldPlacement,
  OFFER_METHOD_LABEL,
  STATE_LABEL,
  type ApprovalView,
  type Placement,
  type PlacementBase,
} from '../engine/placement'
import { deriveTasks, ownerLabel, type CaseFacts, type Task } from '../engine/tasks'
import type { ChainRecord, DecisionRecord } from './chain'
import { isDecisionSnapshot, isPlacementEvent, type DecisionSnapshot, type PlacementEvent } from './snapshot'

// Read-only views over the chain that every screen shares, so a schema-1
// record and a V2 record render through the same code. Nothing here changes
// a sealed record: later facts are read from later events.

export function decisionRecords(chain: ChainRecord[]): DecisionRecord[] {
  return chain.filter((r): r is DecisionRecord => isDecisionSnapshot(r.snapshot))
}

export function eventsAbout(chain: ChainRecord[], seq: number): ChainRecord<PlacementEvent>[] {
  return chain.filter((r): r is ChainRecord<PlacementEvent> => isPlacementEvent(r.snapshot) && r.snapshot.about?.seq === seq)
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
  if (c.status === 'not_asked') return `${CONSENT_STATUS_LABEL.not_asked}: ${(c.reason ?? '').replace(/[.\s]+$/, '')}`
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
  const about = p.about ? ` for #${p.about.seq}` : ''
  switch (p.event.type) {
    case 'consent_updated':
      return `Consent update${about}`
    case 'placement_transition':
      return `Placement update${about}`
    case 'stay_extended':
      return `Stay changed${about}`
    case 'approval':
      return `Approval${about}`
    case 'approval_deferred':
      return `Placed out of hours${about}`
    case 'task_completed':
      return `Task completed${about}`
    case 'task_reassigned':
      return `Task reassigned${about}`
    case 'task_cancelled':
      return `Task cancelled${about}`
    case 'records_exported':
      return p.event.format === 'placements_csv' ? 'Export of all placements' : `Export${about}`
  }
}

export function caseRefOf(r: ChainRecord): string {
  if (isDecisionSnapshot(r.snapshot)) return r.snapshot.search.household.caseRef
  if (r.snapshot.caseRef) return r.snapshot.caseRef
  return r.snapshot.event.type === 'records_exported' ? 'All placements' : 'Property task'
}

export function actorNameOf(r: ChainRecord): string {
  return isDecisionSnapshot(r.snapshot) ? deciderOf(r.snapshot).name : r.snapshot.actor.name
}

export function sealedAt(r: ChainRecord): string {
  return isDecisionSnapshot(r.snapshot) ? r.snapshot.frozenAt : r.snapshot.at
}

/** The decision record a chain record belongs to (itself, or the one an event is about), if any. */
export function decisionSeqOf(r: ChainRecord): number | null {
  return isDecisionSnapshot(r.snapshot) ? r.seq : (r.snapshot.about?.seq ?? null)
}

/** True for records the demo seed created (synthetic history, made through the same commands). */
export function isSeeded(r: ChainRecord): boolean {
  return r.snapshot.notes.some(n => n.startsWith(SEEDED_NOTE))
}
export const SEEDED_NOTE = 'Seeded demo history'

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  decision_json: 'the sealed decision record as JSON',
  case_note: 'a case note for the case system',
  audit_pdf: 'the audit pack as a PDF',
  placements_csv: 'the list of placements as CSV',
}

// ---------- Placements, approvals and tasks ----------

function factOf(r: ChainRecord<PlacementEvent>): EventFact {
  return { seq: r.seq, at: r.snapshot.at, actor: r.snapshot.actor, body: r.snapshot.event }
}

/**
 * What a decision sealed about its placement. Records sealed from phase 2 carry
 * `terms`. Older ones (schema 1, and phase 1's schema 2) never had a hold or a
 * lifecycle: they are read as a hold from the decision time under the default
 * policy, with no exceptions recorded, so they work through the same code and
 * nothing in them is edited.
 */
export function placementBaseOf(r: DecisionRecord): PlacementBase | null {
  const s = r.snapshot
  const d = s.decision
  if (!d.chosenPropertyId) return null
  const terms = s.schema === 'placement-decision/2' ? s.terms : undefined
  const cand = s.search.candidates.find(c => c.propertyId === d.chosenPropertyId)
  const prop = s.properties.find(p => p.id === d.chosenPropertyId)
  const decidedBy = isDecisionV2(d) ? { userId: d.decidedBy.userId, name: d.decidedBy.name, role: d.decidedBy.role } : null
  const common = {
    seq: r.seq,
    caseRef: s.search.household.caseRef,
    propertyId: d.chosenPropertyId,
    propertyLabel: cand?.label ?? prop?.label ?? d.chosenPropertyId,
    startDate: d.startDate,
    decidedAt: d.decidedAt,
    decidedBy,
    decidedByName: deciderOf(s).name,
  }
  if (terms?.placement) {
    const t = terms.placement
    return {
      ...common,
      plannedEnd: t.plannedEnd,
      holdUntil: t.holdUntil,
      sixWeekRule: t.sixWeekRule,
      limitDays: t.limitDays,
      exceptions: terms.exceptions,
      approvalRequired: terms.approvalRequired,
      ...(t.emergency ? { emergency: t.emergency } : {}),
      ...(t.moveOnPlan ? { moveOnPlan: t.moveOnPlan } : {}),
      legacy: false,
    }
  }
  return {
    ...common,
    plannedEnd: addDays(d.startDate, s.search.household.expectedNights),
    holdUntil: addHours(d.decidedAt, placementPolicyOf(s.ruleset).holdHours),
    sixWeekRule: sixWeekRuleApplies(s.search.household, prop),
    limitDays: bnbLimitDays(s.ruleset),
    exceptions: [],
    approvalRequired: false,
    legacy: true,
  }
}

/** Approval of a decision's exceptions as it stands (also for "no suitable option" decisions, which have no placement). */
export function approvalOf(chain: ChainRecord[], r: DecisionRecord): ApprovalView {
  const terms = r.snapshot.schema === 'placement-decision/2' ? r.snapshot.terms : undefined
  return foldApproval({ exceptions: terms?.exceptions ?? [], approvalRequired: !!terms?.approvalRequired }, eventsAbout(chain, r.seq).map(factOf))
}

export function placementOf(chain: ChainRecord[], r: DecisionRecord, now: IsoDateTime): Placement | null {
  const base = placementBaseOf(r)
  return base ? foldPlacement(base, eventsAbout(chain, r.seq).map(factOf), now) : null
}

export function placementsFrom(chain: ChainRecord[], now: IsoDateTime): Placement[] {
  return decisionRecords(chain)
    .map(r => placementOf(chain, r, now))
    .filter((p): p is Placement => !!p)
}

/** What each decision contributes to the task list. */
export function caseFactsFrom(chain: ChainRecord[], now: IsoDateTime): CaseFacts[] {
  return decisionRecords(chain).map(r => {
    const s = r.snapshot
    const d = s.decision
    const decider: TaskOwner = isDecisionV2(d)
      ? { kind: 'user', userId: d.decidedBy.userId, name: d.decidedBy.name, role: d.decidedBy.role }
      : { kind: 'role', role: 'ta_officer' }
    const at = consentAtDecision(s)
    const cur = currentConsent(chain, r)
    const nowStatus: CaseFacts['consent']['now'] =
      cur.now.kind === 'record' ? cur.now.consent.status : cur.now.kind === 'legacy' ? (cur.now.consented ? 'given' : 'not_asked') : 'not_applicable'
    return {
      seq: r.seq,
      caseRef: s.search.household.caseRef,
      decidedAt: d.decidedAt,
      decider,
      outcome: d.outcome,
      placement: placementOf(chain, r, now),
      approval: approvalOf(chain, r),
      clocks: clocksNow(chain, r),
      consent: {
        atDecision: at.kind === 'not_applicable' ? 'not_applicable' : at.kind === 'record' && at.consent.status === 'not_asked' ? 'not_asked' : 'answered',
        now: nowStatus,
        ...(cur.updates.length ? { recordedSeq: cur.updates[cur.updates.length - 1].seq } : {}),
      },
      policy: placementPolicyOf(s.ruleset),
    }
  })
}

/** Every task at `now`, from the chain, the inventory and the active policy. */
export function tasksFrom(chain: ChainRecord[], properties: Property[], ruleset: Ruleset, now: IsoDateTime): Task[] {
  return deriveTasks({
    now,
    cases: caseFactsFrom(chain, now),
    properties,
    ruleset,
    policy: placementPolicyOf(ruleset),
    events: chain.filter((r): r is ChainRecord<PlacementEvent> => isPlacementEvent(r.snapshot)).map(factOf),
  })
}

/** One plain sentence for a later record, for the placement history, the audit pack and the PDF. */
export function describeEvent(e: PlacementEvent): string {
  const b = e.event
  switch (b.type) {
    case 'consent_updated':
      return `Consent changed: ${consentSummary({ kind: 'record', consent: b.consent })}.`
    case 'placement_transition': {
      const d = b.details
      switch (d.action) {
        case 'confirm_provider':
          return `Provider confirmed the booking: ${d.contactName}, reference ${d.providerReference}.`
        case 'offer':
          return `Offered to the household (${OFFER_METHOD_LABEL[d.method].toLowerCase()}).${d.note ? ` Note: “${d.note}”` : ''}`
        case 'accept':
          return `The household accepted the offer.${d.note ? ` Note: “${d.note}”` : ''}`
        case 'refuse':
          return `The household refused the offer. Their reason: ${quoted(d.householdReason)} Sent to a manager for review.`
        case 'check_in':
          return `The household moved in on ${formatDate(d.checkedInOn)}.`
        case 'move_out':
          return `The household moved out on ${formatDate(d.movedOutOn)}. Reason: ${d.reason}. Went to: ${DESTINATION_LABEL[d.destination].toLowerCase()}${d.destinationNote ? ` (${d.destinationNote})` : ''}.`
        case 'cancel':
          return `Placement cancelled: ${d.reason}`
      }
      break
    }
    case 'stay_extended':
      return `Planned end changed from ${formatDate(b.previousEnd)} to ${formatDate(b.newEnd)}: ${b.reason}`
    case 'approval':
      return `${b.outcome === 'approved' ? 'Approved' : 'Rejected'} by a manager. Exceptions: ${b.exceptions.map(x => EXCEPTION_LABEL[x]).join('; ')}. Reasons: “${b.reason}”`
    case 'approval_deferred':
      return `Placed out of hours, approval to follow: ${quoted(b.reason)} A manager’s approval is due by ${formatUkTimeOn(b.approveBy)}.${b.duringWorkingHours ? ' This route was used during working hours.' : ''}`
    case 'task_completed':
      return `Task done: ${b.title}. What was done: ${quoted(b.evidence)} Reference: ${b.reference}.`
    case 'task_reassigned':
      return `Task reassigned: ${b.title}, from ${ownerLabel(b.from)} to ${ownerLabel(b.to)}. Note: “${b.note}”`
    case 'task_cancelled':
      return `Task cancelled: ${b.title}. Reason: “${b.reason}”`
    case 'records_exported':
      return `Exported ${EXPORT_FORMAT_LABEL[b.format]}${b.records !== undefined ? ` (${b.records} placement${b.records === 1 ? '' : 's'})` : ''}, ${b.delivery === 'download' ? 'downloaded as a file' : 'copied out to paste elsewhere'}. Content fingerprint ${b.contentSha256.slice(0, 16)}.`
  }
  return ''
}

/** The sealed terms of a decision as label/value rows, for the audit pack and the PDF. */
export function termsRows(r: DecisionRecord): [string, string][] {
  const s = r.snapshot
  const terms = s.schema === 'placement-decision/2' ? s.terms : undefined
  if (!terms)
    return s.decision.chosenPropertyId
      ? [
          [
            'Hold and approval',
            'Recorded before placements were tracked: no hold or exceptions were sealed. The hold is read from the decision time under the default policy.',
          ],
        ]
      : []
  const rows: [string, string][] = [
    ['Exceptions', terms.exceptions.length ? `${terms.exceptions.map(x => EXCEPTION_LABEL[x]).join('; ')}. Needs a manager’s approval.` : 'None'],
  ]
  const p = terms.placement
  if (p) {
    rows.push(['Hold', `Until ${formatUkTimeOn(p.holdUntil)} (${p.holdHours} hours), unless the provider confirms`])
    rows.push(['Planned stay', `${formatDate(s.decision.startDate)} to ${formatDate(p.plannedEnd)}`])
    if (p.emergency) rows.push(['Emergency reason', `${EMERGENCY_REASON_LABEL[p.emergency.reasonCode]}. “${p.emergency.reasonText}”`])
    if (p.moveOnPlan)
      rows.push([
        'Move-on plan',
        `Move by ${formatDate(p.moveOnPlan.targetDate)} to ${MOVE_ON_ROUTE_LABEL[p.moveOnPlan.route].toLowerCase()}${p.moveOnPlan.routeNote ? ` (${p.moveOnPlan.routeNote})` : ''}. Owner: ${p.moveOnPlan.owner.name}. Six-week limit: ${formatDate(addDays(s.decision.startDate, p.limitDays))}.`,
      ])
  }
  return rows
}

export interface StoryEntry {
  seq: number
  at: IsoDateTime
  who: string
  text: string
  rowHash: string
}

/** The whole story of a decision in chain order: the decision, then every sealed record about it. */
export function storyOf(chain: ChainRecord[], r: DecisionRecord): StoryEntry[] {
  const d = r.snapshot.decision
  const by = deciderOf(r.snapshot)
  const first: StoryEntry = {
    seq: r.seq,
    at: d.decidedAt,
    who: `${by.name} (${by.roleLabel.toLowerCase()})`,
    text: d.chosenPropertyId ? 'Decision recorded; the property is held.' : 'Decision recorded: no suitable option.',
    rowHash: r.rowHash,
  }
  return [
    first,
    ...eventsAbout(chain, r.seq).map(e => ({
      seq: e.seq,
      at: e.snapshot.at,
      who: `${e.snapshot.actor.name} (${e.snapshot.actor.roleLabel.toLowerCase()})`,
      text: describeEvent(e.snapshot),
      rowHash: e.rowHash,
    })),
  ]
}

/** One line for where things stand at `now`, labelled as such: never sealed. */
export function statusLine(chain: ChainRecord[], r: DecisionRecord, now: IsoDateTime): string {
  const p = placementOf(chain, r, now)
  const a = approvalOf(chain, r)
  const approval =
    a.status === 'not_required'
      ? ''
      : a.status === 'awaiting'
        ? ' Awaiting approval.'
        : a.status === 'out_of_hours'
          ? ' Placed out of hours, approval to follow.'
          : ` Exception ${a.status}.`
  return `${p ? `Placement: ${STATE_LABEL[p.state].toLowerCase()}.` : 'No placement.'}${approval}`
}
