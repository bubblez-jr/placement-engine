import { addDays, daysBetween, formatUkTimeOn, ukDate } from './dates'
import { isRealDate } from './validate'
import type {
  ActorRef,
  EmergencyRecord,
  EventFact,
  ExceptionKind,
  IsoDate,
  IsoDateTime,
  Issue,
  MoveOnPlan,
  MoveOutDestination,
  OfferMethod,
  PersonRef,
  PlacementAction,
  PlacementState,
  TransitionDetails,
} from './types'

// The placement lifecycle as a pure state machine. A placement is not stored:
// it is folded from the sealed decision and the sealed events about it, so the
// chain is the only record. Hold expiry is worked out from the `now` passed in.
//
//   held → provider_confirmed → offered → accepted → checked_in → moved_out
//                                     ↘ refused
//   held, provider_confirmed, offered, accepted → cancelled (with a reason)
//   held, not confirmed by the hold's end → hold_expired

export const STATE_LABEL: Record<PlacementState, string> = {
  held: 'Held',
  provider_confirmed: 'Provider confirmed',
  offered: 'Offered',
  accepted: 'Accepted',
  checked_in: 'Moved in',
  moved_out: 'Moved out',
  refused: 'Refused',
  cancelled: 'Cancelled',
  hold_expired: 'Hold expired',
}

/** The happy path, in order, for the status stepper. */
export const LIFECYCLE: PlacementState[] = ['held', 'provider_confirmed', 'offered', 'accepted', 'checked_in', 'moved_out']

export const ACTION_LABEL: Record<PlacementAction, string> = {
  confirm_provider: 'Record provider confirmation',
  offer: 'Record the offer',
  accept: 'Household accepted',
  refuse: 'Household refused',
  check_in: 'Record move-in',
  move_out: 'Record move-out',
  cancel: 'Cancel the placement',
}

/** Which states each action may start from. Anything else is refused. */
export const ALLOWED_FROM: Record<PlacementAction, PlacementState[]> = {
  confirm_provider: ['held'],
  offer: ['provider_confirmed'],
  accept: ['offered'],
  refuse: ['offered'],
  check_in: ['accepted'],
  move_out: ['checked_in'],
  cancel: ['held', 'provider_confirmed', 'offered', 'accepted'],
}

export const TARGET: Record<PlacementAction, PlacementState> = {
  confirm_provider: 'provider_confirmed',
  offer: 'offered',
  accept: 'accepted',
  refuse: 'refused',
  check_in: 'checked_in',
  move_out: 'moved_out',
  cancel: 'cancelled',
}

/** Steps that wait for a manager's approval, unless the out-of-hours route was used. */
export const NEEDS_APPROVAL: PlacementAction[] = ['confirm_provider', 'offer', 'check_in']

/** States that hold or occupy the property and still have a next step. */
export const LIVE: PlacementState[] = ['held', 'provider_confirmed', 'offered', 'accepted', 'checked_in']

export const OFFER_METHOD_LABEL: Record<OfferMethod, string> = { in_person: 'In person', phone: 'By phone', written: 'In writing' }

export const DESTINATION_LABEL: Record<MoveOutDestination, string> = {
  settled_home: 'A settled home',
  other_ta: 'Other temporary accommodation',
  left: 'Left without saying where',
  other: 'Somewhere else',
}

export const MIN_REASON_CHARS = 10

/** What the decision sealed about the placement, read version-aware by audit/records.ts. */
export interface PlacementBase {
  /** The decision record's sequence number: the placement's identity */
  seq: number
  caseRef: string
  propertyId: string
  propertyLabel: string
  startDate: IsoDate
  plannedEnd: IsoDate
  decidedAt: IsoDateTime
  /** The signed-in decider; null for a schema-1 record (free-text name) */
  decidedBy: PersonRef | null
  decidedByName: string
  holdUntil: IsoDateTime
  sixWeekRule: boolean
  limitDays: number
  exceptions: ExceptionKind[]
  approvalRequired: boolean
  emergency?: EmergencyRecord
  moveOnPlan?: MoveOnPlan
  /** Sealed before phase 2: the hold and terms are read under the default policy */
  legacy: boolean
}

export interface StepRecord {
  seq: number
  at: IsoDateTime
  actor: ActorRef
  from: PlacementState
  to: PlacementState
  details: TransitionDetails
}

export interface ExtensionRecord {
  seq: number
  at: IsoDateTime
  actor: ActorRef
  previousEnd: IsoDate
  newEnd: IsoDate
  reason: string
}

interface ByWhom {
  seq: number
  at: IsoDateTime
  actor: ActorRef
}

export type ApprovalView =
  | { status: 'not_required'; exceptions: ExceptionKind[] }
  | { status: 'awaiting'; exceptions: ExceptionKind[] }
  | { status: 'out_of_hours'; exceptions: ExceptionKind[]; deferral: ByWhom & { reason: string; approveBy: IsoDateTime; duringWorkingHours: boolean } }
  | {
      status: 'approved' | 'rejected'
      exceptions: ExceptionKind[]
      deferral?: ByWhom & { reason: string; approveBy: IsoDateTime; duringWorkingHours: boolean }
      decision: ByWhom & { reason: string }
    }

export interface Placement extends PlacementBase {
  id: string
  state: PlacementState
  /** The planned end now, after any extensions */
  currentEnd: IsoDate
  steps: StepRecord[]
  extensions: ExtensionRecord[]
  approval: ApprovalView
  checkedInOn?: IsoDate
  movedOutOn?: IsoDate
  refusal?: ByWhom & { reason: string }
  cancellation?: ByWhom & { reason: string; byRejection: boolean }
}

export function placementId(seq: number): string {
  return `PL-${seq}`
}

/** Approval as it stands, from the sealed exceptions and the approval events in order. */
export function foldApproval(base: { exceptions: ExceptionKind[]; approvalRequired: boolean }, events: EventFact[]): ApprovalView {
  let view: ApprovalView = base.approvalRequired ? { status: 'awaiting', exceptions: base.exceptions } : { status: 'not_required', exceptions: base.exceptions }
  for (const e of events) {
    const b = e.body
    if (b.type === 'approval_deferred' && view.status === 'awaiting')
      view = {
        status: 'out_of_hours',
        exceptions: view.exceptions,
        deferral: { seq: e.seq, at: e.at, actor: e.actor, reason: b.reason, approveBy: b.approveBy, duringWorkingHours: b.duringWorkingHours },
      }
    if (b.type === 'approval' && (view.status === 'awaiting' || view.status === 'out_of_hours'))
      view = {
        status: b.outcome,
        exceptions: view.exceptions,
        ...(view.status === 'out_of_hours' ? { deferral: view.deferral } : {}),
        decision: { seq: e.seq, at: e.at, actor: e.actor, reason: b.reason },
      }
  }
  return view
}

/** Approval lets the placement go ahead: not needed, given, or the out-of-hours route was used. */
export function approvalClears(a: ApprovalView): boolean {
  return a.status === 'not_required' || a.status === 'approved' || a.status === 'out_of_hours'
}

/**
 * The placement as it stands at `now`: the sealed decision plus every sealed
 * event about it, in chain order. A hold nobody confirmed by its end reads as
 * expired; nothing is written when that happens.
 */
export function foldPlacement(base: PlacementBase, events: EventFact[], now: IsoDateTime): Placement {
  const p: Placement = {
    ...base,
    id: placementId(base.seq),
    state: 'held',
    currentEnd: base.plannedEnd,
    steps: [],
    extensions: [],
    approval: foldApproval(base, []),
  }
  const approvalEvents: EventFact[] = []
  for (const e of events) {
    const b = e.body
    if (b.type === 'placement_transition') {
      p.steps.push({ seq: e.seq, at: e.at, actor: e.actor, from: b.from, to: b.to, details: b.details })
      p.state = b.to
      const d = b.details
      if (d.action === 'check_in') p.checkedInOn = d.checkedInOn
      if (d.action === 'move_out') p.movedOutOn = d.movedOutOn
      if (d.action === 'refuse') p.refusal = { seq: e.seq, at: e.at, actor: e.actor, reason: d.householdReason }
      if (d.action === 'cancel') p.cancellation = { seq: e.seq, at: e.at, actor: e.actor, reason: d.reason, byRejection: false }
    } else if (b.type === 'stay_extended') {
      p.extensions.push({ seq: e.seq, at: e.at, actor: e.actor, previousEnd: b.previousEnd, newEnd: b.newEnd, reason: b.reason })
      p.currentEnd = b.newEnd
    } else if (b.type === 'approval' || b.type === 'approval_deferred') {
      approvalEvents.push(e)
      p.approval = foldApproval(base, approvalEvents)
      // A rejection releases the hold, unless the family has already moved in
      // under the out-of-hours route; then a task asks for a move instead.
      if (b.type === 'approval' && b.outcome === 'rejected' && ALLOWED_FROM.cancel.includes(p.state)) {
        p.state = 'cancelled'
        p.cancellation = { seq: e.seq, at: e.at, actor: e.actor, reason: `Exception rejected by ${e.actor.name}: ${b.reason}`, byRejection: true }
      }
    }
  }
  if (p.state === 'held' && now >= p.holdUntil) p.state = 'hold_expired'
  return p
}

/** Steps open to someone now (before permission checks), for the next-action panel. */
export function nextActions(p: Placement): PlacementAction[] {
  return (Object.keys(ALLOWED_FROM) as PlacementAction[]).filter(a => ALLOWED_FROM[a].includes(p.state))
}

/** Why a step cannot be taken yet because of approval, or null. */
export function approvalBlock(p: Placement, action: PlacementAction): string | null {
  if (!NEEDS_APPROVAL.includes(action) || approvalClears(p.approval)) return null
  if (p.approval.status === 'rejected') return 'The exception was rejected, so this placement cannot go ahead.'
  return 'Waiting for a manager to approve the exception. In a real emergency, use “Placed out of hours, approval to follow”.'
}

/** What the officer enters for a step. Nothing is filled in for them. */
export interface TransitionInput {
  action: PlacementAction
  contactName?: string
  providerReference?: string
  method?: string
  note?: string
  householdReason?: string
  checkedInOn?: string
  movedOutOn?: string
  reason?: string
  destination?: string
  destinationNote?: string
}

const t = (s: string | undefined) => (s ?? '').trim()

/** Every rule for a step, as issues whose paths are the form's control ids. */
export function validateTransition(p: Placement, input: TransitionInput, now: IsoDateTime): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  const a = input.action
  if (!(a in ALLOWED_FROM)) {
    error('pl-action', 'Choose a step.')
    return issues
  }
  if (!ALLOWED_FROM[a].includes(p.state)) {
    error(
      'pl-action',
      p.state === 'hold_expired'
        ? `The hold ended at ${formatUkTimeOn(p.holdUntil)} without provider confirmation. Run the search again to find a property.`
        : `A placement that is “${STATE_LABEL[p.state].toLowerCase()}” cannot move to “${STATE_LABEL[TARGET[a]].toLowerCase()}”.`,
    )
    return issues
  }
  const blocked = approvalBlock(p, a)
  if (blocked) {
    error('pl-action', blocked)
    return issues
  }
  const today = ukDate(now)
  switch (a) {
    case 'confirm_provider':
      if (t(input.contactName).length < 2) error('pl-contactName', 'Enter the name of the person at the provider who confirmed.')
      if (t(input.providerReference).length < 3) error('pl-providerReference', 'Enter the provider’s booking reference.')
      break
    case 'offer':
      if (!input.method || !(input.method in OFFER_METHOD_LABEL)) error('pl-method', 'Choose how the offer was made.')
      break
    case 'refuse':
      if (t(input.householdReason).length < MIN_REASON_CHARS)
        error('pl-householdReason', `Record the household’s reason in their words (at least ${MIN_REASON_CHARS} characters).`)
      break
    case 'check_in': {
      const d = t(input.checkedInOn)
      if (!isRealDate(d)) error('pl-checkedInOn', 'Enter the date the household moved in.')
      else if (d > today) error('pl-checkedInOn', 'The move-in date cannot be in the future.')
      else if (d < ukDate(p.decidedAt)) error('pl-checkedInOn', 'The move-in date cannot be before the decision.')
      break
    }
    case 'move_out': {
      const d = t(input.movedOutOn)
      if (!isRealDate(d)) error('pl-movedOutOn', 'Enter the date the household moved out.')
      else if (d > today) error('pl-movedOutOn', 'The move-out date cannot be in the future.')
      else if (p.checkedInOn && d < p.checkedInOn) error('pl-movedOutOn', 'The move-out date cannot be before the move-in date.')
      if (t(input.reason).length < 5) error('pl-moveReason', 'Say why the household moved out.')
      if (!input.destination || !(input.destination in DESTINATION_LABEL)) error('pl-destination', 'Choose where the household went.')
      else if (input.destination === 'other' && t(input.destinationNote).length < 5) error('pl-destinationNote', 'Say where the household went.')
      break
    }
    case 'cancel':
      if (t(input.reason).length < MIN_REASON_CHARS) error('pl-cancelReason', `Give the reason for cancelling (at least ${MIN_REASON_CHARS} characters).`)
      break
    case 'accept':
      break
  }
  return issues
}

/** The details sealed for a valid step (trimmed; optional notes only when given). */
export function transitionDetails(input: TransitionInput): TransitionDetails {
  const note = t(input.note)
  switch (input.action) {
    case 'confirm_provider':
      return { action: 'confirm_provider', contactName: t(input.contactName), providerReference: t(input.providerReference) }
    case 'offer':
      return { action: 'offer', method: input.method as OfferMethod, ...(note ? { note } : {}) }
    case 'accept':
      return { action: 'accept', ...(note ? { note } : {}) }
    case 'refuse':
      return { action: 'refuse', householdReason: t(input.householdReason) }
    case 'check_in':
      return { action: 'check_in', checkedInOn: t(input.checkedInOn) }
    case 'move_out': {
      const dn = t(input.destinationNote)
      return {
        action: 'move_out',
        movedOutOn: t(input.movedOutOn),
        reason: t(input.reason),
        destination: input.destination as MoveOutDestination,
        ...(dn ? { destinationNote: dn } : {}),
      }
    }
    case 'cancel':
      return { action: 'cancel', reason: t(input.reason) }
  }
}

/** A stay can be extended while the placement is live. Conflicts come from the occupancy of the same property. */
export function validateExtension(p: Placement, input: { newEnd?: string; reason?: string }, conflicts: { message: string }[]): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  if (!LIVE.includes(p.state)) {
    error('ext-newEnd', `A placement that is “${STATE_LABEL[p.state].toLowerCase()}” cannot be extended.`)
    return issues
  }
  const d = t(input.newEnd)
  const start = p.checkedInOn ?? p.startDate
  if (!isRealDate(d)) error('ext-newEnd', 'Enter the new planned end date.')
  else if (d <= start) error('ext-newEnd', 'The new end date must be after the start of the stay.')
  else if (d === p.currentEnd) error('ext-newEnd', 'That is already the planned end date.')
  else if (conflicts.length) error('ext-newEnd', `The property is not free for those dates: ${conflicts.map(c => c.message).join('; ')}.`)
  if (t(input.reason).length < MIN_REASON_CHARS) error('ext-reason', `Give the reason for the change (at least ${MIN_REASON_CHARS} characters).`)
  return issues
}

/** Whether an approval still matters: a placement that is refused, cancelled or whose hold ended has nothing left to approve. */
export function approvalPending(a: ApprovalView, p: Pick<Placement, 'state'> | null): boolean {
  return (a.status === 'awaiting' || a.status === 'out_of_hours') && !(p && VOID.includes(p.state))
}

const VOID: PlacementState[] = ['refused', 'cancelled', 'hold_expired']

export function validateApproval(a: ApprovalView, input: { outcome?: string; reason?: string }, p: Pick<Placement, 'state'> | null = null): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  if (a.status !== 'awaiting' && a.status !== 'out_of_hours') {
    error('ap-outcome', a.status === 'not_required' ? 'This decision does not need approval.' : `This decision was already ${a.status}.`)
    return issues
  }
  if (!approvalPending(a, p)) {
    error('ap-outcome', `There is nothing left to approve: the placement is ${STATE_LABEL[p!.state].toLowerCase()}.`)
    return issues
  }
  if (input.outcome !== 'approved' && input.outcome !== 'rejected') error('ap-outcome', 'Choose approve or reject.')
  if (t(input.reason).length < MIN_REASON_CHARS) error('ap-reason', `Give your reasons (at least ${MIN_REASON_CHARS} characters).`)
  return issues
}

export const DEFERRAL_MIN_CHARS = 20

/** "Placed out of hours, approval to follow": the one route past a missing approval. */
export function validateDeferral(a: ApprovalView, p: Placement | null, input: { reason?: string }): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  if (a.status !== 'awaiting') {
    error('ooh-reason', a.status === 'out_of_hours' ? 'This placement is already marked as placed out of hours.' : 'This decision is not waiting for approval.')
    return issues
  }
  if (!p || !LIVE.includes(p.state)) {
    error('ooh-reason', 'Only a live placement can be marked as placed out of hours.')
    return issues
  }
  if (t(input.reason).length < DEFERRAL_MIN_CHARS)
    error('ooh-reason', `Say why the household could not wait for a manager (at least ${DEFERRAL_MIN_CHARS} characters).`)
  return issues
}

/** Days used of the stay in shared accommodation (nights since the start: 0 on arrival), or null when the six-week rule does not apply. */
export function sharedStayDay(p: Placement, now: IsoDateTime): { day: number; limit: number; ended: boolean; breached: boolean } | null {
  if (!p.sixWeekRule || ['refused', 'cancelled', 'hold_expired'].includes(p.state)) return null
  const start = p.checkedInOn ?? p.startDate
  const end = p.movedOutOn ?? ukDate(now)
  const day = Math.max(0, daysBetween(start, end))
  return { day, limit: p.limitDays, ended: !!p.movedOutOn, breached: day > p.limitDays }
}

/** The date the stay in shared accommodation reaches the limit. */
export function sharedStayLimitDate(p: Placement): IsoDate {
  return addDays(p.checkedInOn ?? p.startDate, p.limitDays)
}
