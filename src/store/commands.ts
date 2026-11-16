import { appendRecord, type ChainRecord, type DecisionRecord } from '../audit/chain'
import { approvalOf, currentConsent, decisionRecords, placementOf, placementsFrom, SEEDED_NOTE, tasksFrom } from '../audit/records'
import { hashRuleset } from '../audit/ruleset'
import { isDecisionSnapshot, type ChainPayload, type DecisionSnapshotV2, type PlacementEvent, type PlacementEventBody } from '../audit/snapshot'
import { statutoryClocks } from '../engine/clocks'
import { addDays, addHours, inWorkingHours, nextWorkingDayAt } from '../engine/dates'
import {
  buildConsentRecord,
  exceptionsFor,
  hasChildren,
  sixWeekRuleApplies,
  validateConsent,
  validateDecision,
  type ConsentInput,
  type DecisionInput,
} from '../engine/decision'
import { conflictsFor, occupancyMessage, occupancyOf, OccupancyConflictError } from '../engine/occupancy'
import {
  LIVE,
  placementId,
  TARGET,
  transitionDetails,
  validateApproval,
  validateDeferral,
  validateExtension,
  validateTransition,
  type Placement,
  type TransitionInput,
} from '../engine/placement'
import { actorRef, assertCan, can } from '../engine/permissions'
import { bnbLimitDays, placementPolicyOf } from '../engine/policy'
import { runSearch } from '../engine/search'
import { validateCancel, validateCompletion, validateReassign, type Task } from '../engine/tasks'
import type {
  DecisionTerms,
  DecisionV2,
  EmergencyReason,
  Household,
  MoveOnRoute,
  IsoDateTime,
  Property,
  Ruleset,
  SearchResult,
  StaffUser,
  TaskOwner,
} from '../engine/types'
import { ValidationError, type OpenCase } from '../engine/validate'
import { STAFF } from '../data/staff'
import type { TravelProvider } from '../travel/provider'
import { activeRulesetOf, type AppData, type HashedRuleset, type ReviewLog } from './data'

// Every change to app data goes through one of these. Each takes the actor
// from the signed-in session (never from a form field), checks the
// permission matrix first, and returns new data; nothing is changed in place.
// The React store (app.tsx) only wires them to state and storage.

export interface CommandCtx {
  user: StaffUser | null
  /** Full ISO timestamp */
  now: string
  /** The officer's calendar date, YYYY-MM-DD */
  today: string
  /** Set only by the demo seed: every record it seals says so */
  seeded?: boolean
}

const SYNTHETIC = 'SYNTHETIC DEMO DATA. Not a real household.'
function notesFor(ctx: CommandCtx, notes: string[]): string[] {
  return ctx.seeded ? [...notes, `${SEEDED_NOTE}: synthetic, sealed when the demo data was loaded, through the same commands as live use.`] : notes
}

/** People a move-on plan or a task can be given to: everyone who acts on placements. */
export function placementOwners(): StaffUser[] {
  return STAFF.filter(u => can(u, 'act_on_placement'))
}

export const EQUALITY_NOTE_MIN_CHARS = 30

/** Open work per case reference, so the form can point out a duplicate: open searches and live placements. */
export function openCases(d: AppData, now: IsoDateTime): OpenCase[] {
  const decided = new Set(decisionRecords(d.chain).map(r => r.snapshot.search.id))
  const out: OpenCase[] = d.searches
    .filter(s => !decided.has(s.id))
    .map(s => ({ caseRef: s.household.caseRef, kind: 'search' as const, at: s.createdAt, searchId: s.id }))
  for (const p of placementsFrom(d.chain, now)) {
    if (LIVE.includes(p.state)) out.push({ caseRef: p.caseRef, kind: 'placement', at: p.decidedAt, seq: p.seq })
  }
  return out
}

/** Holds, bookings and households in residence at `now`. */
export function occupancyNow(d: AppData, now: IsoDateTime) {
  return occupancyOf(placementsFrom(d.chain, now), now)
}

function decisionAt(d: AppData, seq: number): DecisionRecord {
  const rec = decisionRecords(d.chain).find(r => r.seq === seq)
  if (!rec) throw new Error(`Decision #${seq} not found.`)
  return rec
}

function livePlacement(d: AppData, seq: number, now: IsoDateTime): { rec: DecisionRecord; p: Placement } {
  const rec = decisionAt(d, seq)
  const p = placementOf(d.chain, rec, now)
  if (!p) throw new Error(`Decision #${seq} placed nobody, so there is no placement to act on.`)
  return { rec, p }
}

async function appendEvent(
  d: AppData,
  ctx: CommandCtx,
  about: { rec: DecisionRecord } | { propertyId: string },
  body: PlacementEventBody,
): Promise<{ data: AppData; record: ChainRecord<PlacementEvent> }> {
  const event: PlacementEvent = {
    schema: 'placement-event/1',
    at: ctx.now,
    actor: actorRef(ctx.user!),
    caseRef: 'rec' in about ? about.rec.snapshot.search.household.caseRef : null,
    about: 'rec' in about ? { seq: about.rec.seq, rowHash: about.rec.rowHash } : null,
    ...('propertyId' in about ? { propertyId: about.propertyId } : {}),
    event: body,
    notes: notesFor(ctx, [SYNTHETIC]),
  }
  const record = await appendRecord(d.chain, event)
  return { data: { ...d, chain: [...d.chain, record] }, record }
}

export async function cmdSearch(
  d: AppData,
  ctx: CommandCtx,
  household: Household,
  opts: { id: string; travel: TravelProvider },
): Promise<{ data: AppData; result: SearchResult }> {
  assertCan(ctx.user, 'run_search')
  const actor = actorRef(ctx.user!)
  // The access answers in a search are the searching officer's: every answer is
  // stamped from the session here, whatever stamp it arrived with (a form, an
  // example household, an import), so no one can be named by form data.
  const stamped: Household = {
    ...household,
    accessAssessments: (household.accessAssessments ?? []).map(a => ({ ...a, answeredBy: actor, answeredAt: ctx.now })),
  }
  const rs = activeRulesetOf(d)
  const result = await runSearch({
    household: stamped,
    properties: d.properties,
    suppliers: d.suppliers,
    ruleset: rs,
    travel: opts.travel,
    now: ctx.now,
    today: ctx.today,
    dataVersions: { properties: d.propertiesVersion, reference: 'synthetic reference places v1' },
    id: opts.id,
    context: { openCases: openCases(d, ctx.now) },
    searchedBy: actor,
    occupancy: occupancyNow(d, ctx.now),
  })
  return { data: { ...d, searches: [result, ...d.searches].slice(0, 40) }, result }
}

export async function cmdDecide(
  d: AppData,
  ctx: CommandCtx,
  searchId: string,
  input: DecisionInput,
  review: ReviewLog,
): Promise<{ data: AppData; record: ChainRecord<DecisionSnapshotV2> }> {
  assertCan(ctx.user, 'record_decision')
  const search = d.searches.find(s => s.id === searchId)
  if (!search) throw new Error('This search is no longer held in this browser. Run the search again.')
  const already = decisionRecords(d.chain).find(r => r.snapshot.search.id === searchId)
  if (already) throw new Error(`A decision for this search is already sealed as record #${already.seq}. A later fact is a new record, not a second decision.`)
  const rs = d.rulesets.find(r => r.hash === search.rulesetHash) ?? d.rulesets.find(r => r.version === search.rulesetVersion)
  if (!rs) throw new Error('The policy version this search used is no longer held. Run the search again.')
  const chosen = input.chosenPropertyId ? d.properties.find(p => p.id === input.chosenPropertyId) : undefined
  const issues = validateDecision(search, input, { property: chosen, ruleset: rs, owners: placementOwners() })
  if (issues.some(i => i.severity === 'error')) throw new ValidationError(issues)
  if (input.outcome !== 'no_suitable' && !chosen) throw new Error('This property is no longer in the inventory. Run the search again.')

  // The search may be minutes old: check the property is still free right now.
  const plannedEnd = addDays(input.startDate, search.household.expectedNights)
  if (chosen && input.outcome !== 'no_suitable') {
    const clashes = conflictsFor(occupancyNow(d, ctx.now), chosen.id, input.startDate, plannedEnd)
    if (clashes.length)
      throw new OccupancyConflictError(
        `${chosen.label} was taken after this search ran (${clashes.map(c => occupancyMessage(c, search.household.caseRef)).join('; ')}). Run the search again to see what is free now.`,
        clashes,
      )
  }

  const actor = actorRef(ctx.user!)
  const placing = input.outcome !== 'no_suitable'
  const policy = placementPolicyOf(rs)
  const exceptions = exceptionsFor(search, input, chosen, rs)
  const sixWeek = placing && sixWeekRuleApplies(search.household, chosen)
  const owner = sixWeek ? placementOwners().find(u => u.id === input.moveOnPlan!.ownerUserId)! : null
  const terms: DecisionTerms = {
    exceptions,
    approvalRequired: exceptions.length > 0,
    placement: placing
      ? {
          holdHours: policy.holdHours,
          holdUntil: addHours(ctx.now, policy.holdHours),
          plannedEnd,
          sixWeekRule: sixWeek,
          limitDays: bnbLimitDays(rs),
          ...(sixWeek
            ? {
                emergency: { reasonCode: input.emergency!.reasonCode as EmergencyReason, reasonText: input.emergency!.reasonText!.trim() },
                moveOnPlan: {
                  targetDate: input.moveOnPlan!.targetDate!,
                  route: input.moveOnPlan!.route as MoveOnRoute,
                  ...(input.moveOnPlan!.routeNote?.trim() ? { routeNote: input.moveOnPlan!.routeNote.trim() } : {}),
                  owner: { userId: owner!.id, name: owner!.name, role: owner!.role },
                },
              }
            : {}),
        }
      : null,
  }
  const decision: DecisionV2 = {
    outcome: input.outcome,
    chosenPropertyId: placing ? input.chosenPropertyId : null,
    ...(input.outcome === 'override' ? { overrideReason: input.overrideReason } : {}),
    reasonText: input.reasonText.trim(),
    decidedBy: actor,
    decidedAt: ctx.now,
    reviewed: {
      resultsOpenedAt: review.resultsOpenedAt,
      propertiesOpened: [...review.propertiesOpened],
      comparisonOpened: review.comparisonOpened,
      confirmedFullListReviewed: input.confirmedFullListReviewed,
    },
    startDate: input.startDate,
    consent: placing && hasChildren(search.household) ? buildConsentRecord(input.consent!, actor, ctx.now) : null,
  }
  const snapshot: DecisionSnapshotV2 = {
    schema: 'placement-decision/2',
    frozenAt: ctx.now,
    councilName: rs.councilName,
    search,
    ruleset: rs,
    properties: d.properties.filter(p => search.candidates.some(c => c.propertyId === p.id)),
    decision,
    clocks: chosen ? statutoryClocks(search.household, chosen, rs, decision) : [],
    terms,
    notes: notesFor(ctx, ['SYNTHETIC DEMO DATA. Not a real household or property.', search.travelProvider.disclaimer, rs.subsidy.source]),
  }
  const record = await appendRecord(d.chain, snapshot)
  return { data: { ...d, chain: [...d.chain, record] }, record }
}

/** Record a later consent answer as a new chain event. The decision record is not touched. */
export async function cmdUpdateConsent(
  d: AppData,
  ctx: CommandCtx,
  seq: number,
  input: ConsentInput,
): Promise<{ data: AppData; record: ChainRecord<PlacementEvent> }> {
  assertCan(ctx.user, 'record_consent')
  const rec = decisionRecords(d.chain).find(r => r.seq === seq)
  if (!rec) throw new Error(`Decision #${seq} not found.`)
  const h = rec.snapshot.search.household
  if (!rec.snapshot.decision.chosenPropertyId || !hasChildren(h))
    throw new Error('Consent to notify school and health services applies only to a placement of a household with children.')
  const issues = validateConsent(input, h)
  if (issues.some(i => i.severity === 'error')) throw new ValidationError(issues)
  const actor = actorRef(ctx.user!)
  const { now } = currentConsent(d.chain, rec)
  return appendEvent(
    d,
    ctx,
    { rec },
    {
      type: 'consent_updated',
      consent: buildConsentRecord(input, actor, ctx.now),
      previous: now.kind === 'record' ? now.consent : now.kind === 'legacy' ? { legacyConsentToNotify: now.consented } : null,
    },
  )
}

// ---------- Placements ----------

/** One step of the placement lifecycle, sealed as a new record. */
export async function cmdTransition(d: AppData, ctx: CommandCtx, seq: number, input: TransitionInput) {
  assertCan(ctx.user, 'act_on_placement')
  const { rec, p } = livePlacement(d, seq, ctx.now)
  const issues = validateTransition(p, input, ctx.now)
  if (issues.length) throw new ValidationError(issues)
  return appendEvent(
    d,
    ctx,
    { rec },
    { type: 'placement_transition', placementId: p.id, from: p.state, to: TARGET[input.action], details: transitionDetails(input) },
  )
}

/** Change the planned end of a live stay, after checking nobody else holds the property for the new dates. */
export async function cmdExtendStay(d: AppData, ctx: CommandCtx, seq: number, input: { newEnd?: string; reason?: string }) {
  assertCan(ctx.user, 'act_on_placement')
  const { rec, p } = livePlacement(d, seq, ctx.now)
  const newEnd = (input.newEnd ?? '').trim()
  const clashes = /^\d{4}-\d{2}-\d{2}$/.test(newEnd) ? conflictsFor(occupancyNow(d, ctx.now), p.propertyId, p.checkedInOn ?? p.startDate, newEnd, p.seq) : []
  const issues = validateExtension(
    p,
    input,
    clashes.map(c => ({ message: occupancyMessage(c, p.caseRef) })),
  )
  if (issues.length) throw new ValidationError(issues)
  return appendEvent(d, ctx, { rec }, { type: 'stay_extended', placementId: placementId(seq), previousEnd: p.currentEnd, newEnd, reason: input.reason!.trim() })
}

// ---------- Approvals ----------

/** A manager or head of service approves or rejects a decision's exceptions. Never the person who decided. */
export async function cmdDecideApproval(d: AppData, ctx: CommandCtx, seq: number, input: { outcome?: 'approved' | 'rejected'; reason?: string }) {
  const rec = decisionAt(d, seq)
  const dec = rec.snapshot.decision
  assertCan(ctx.user, 'approve_exception', { decidedByUserId: 'decidedBy' in dec ? dec.decidedBy.userId : undefined })
  const approval = approvalOf(d.chain, rec)
  const issues = validateApproval(approval, input, placementOf(d.chain, rec, ctx.now))
  if (issues.length) throw new ValidationError(issues)
  return appendEvent(d, ctx, { rec }, { type: 'approval', outcome: input.outcome!, exceptions: approval.exceptions, reason: input.reason!.trim() })
}

/**
 * "Placed out of hours, approval to follow": the one route past a missing
 * approval, for a household that cannot wait. It unblocks the placement and
 * puts an urgent approval in the managers' queue for the next working day.
 */
export async function cmdPlaceOutOfHours(d: AppData, ctx: CommandCtx, seq: number, input: { reason?: string }) {
  assertCan(ctx.user, 'act_on_placement')
  const { rec, p } = livePlacement(d, seq, ctx.now)
  const issues = validateDeferral(p.approval, p, input)
  if (issues.length) throw new ValidationError(issues)
  const policy = placementPolicyOf(rec.snapshot.ruleset)
  return appendEvent(
    d,
    ctx,
    { rec },
    {
      type: 'approval_deferred',
      exceptions: p.approval.exceptions,
      reason: input.reason!.trim(),
      approveBy: nextWorkingDayAt(ctx.now, policy.outOfHoursApprovalBy),
      duringWorkingHours: inWorkingHours(ctx.now),
    },
  )
}

// ---------- Tasks ----------

function openTask(d: AppData, ctx: CommandCtx, taskId: string): Task {
  const task = tasksFrom(d.chain, d.properties, activeRulesetOf(d), ctx.now).find(t => t.id === taskId)
  if (!task) throw new Error('This task no longer exists: what triggered it has changed.')
  if (task.status !== 'open') throw new Error(`This task is already ${task.status === 'done' ? 'done' : 'cancelled'}.`)
  return task
}

function taskAbout(d: AppData, task: Task): { rec: DecisionRecord } | { propertyId: string } {
  if (task.seq !== undefined) return { rec: decisionAt(d, task.seq) }
  return { propertyId: task.propertyId! }
}

/** Complete a task with evidence of what was done. */
export async function cmdCompleteTask(d: AppData, ctx: CommandCtx, taskId: string, input: { evidence?: string; reference?: string }) {
  const task = openTask(d, ctx, taskId)
  assertCan(ctx.user, 'complete_task', task.owner.kind === 'user' ? { taskOwnerUserId: task.owner.userId } : { taskOwnerRole: task.owner.role })
  if (task.closesBy === 'approval') throw new Error('This task closes when a manager approves or rejects the exception.')
  const issues = validateCompletion(input)
  if (issues.length) throw new ValidationError(issues)
  return appendEvent(d, ctx, taskAbout(d, task), {
    type: 'task_completed',
    taskId,
    title: task.title,
    evidence: input.evidence!.trim(),
    reference: input.reference!.trim(),
  })
}

/** People and role queues a task can be given to: anyone who can complete tasks. */
export function taskOwnerChoices(): TaskOwner[] {
  const users = STAFF.filter(u => can(u, 'complete_task')).map(u => ({ kind: 'user' as const, userId: u.id, name: u.name, role: u.role }))
  const roles = [...new Set(STAFF.filter(u => can(u, 'complete_task')).map(u => u.role))].map(role => ({ kind: 'role' as const, role }))
  return [...users, ...roles]
}

export async function cmdReassignTask(d: AppData, ctx: CommandCtx, taskId: string, input: { to?: TaskOwner | null; note?: string }) {
  assertCan(ctx.user, 'reassign_task')
  const task = openTask(d, ctx, taskId)
  const to = input.to ? (taskOwnerChoices().find(o => JSON.stringify(o) === JSON.stringify(input.to)) ?? null) : null
  const issues =
    input.to && !to
      ? [{ path: 'task-to', severity: 'error' as const, message: 'That person or queue cannot take tasks.' }]
      : validateReassign(task, to, input.note)
  if (issues.length) throw new ValidationError(issues)
  return appendEvent(d, ctx, taskAbout(d, task), { type: 'task_reassigned', taskId, title: task.title, from: task.owner, to: to!, note: input.note!.trim() })
}

export async function cmdCancelTask(d: AppData, ctx: CommandCtx, taskId: string, input: { reason?: string }) {
  assertCan(ctx.user, 'cancel_task')
  const task = openTask(d, ctx, taskId)
  if (task.closesBy === 'approval') throw new Error('An approval cannot be cancelled: approve or reject the exception.')
  const issues = validateCancel(input.reason)
  if (issues.length) throw new ValidationError(issues)
  return appendEvent(d, ctx, taskAbout(d, task), { type: 'task_cancelled', taskId, title: task.title, reason: input.reason!.trim() })
}

export function nextVersion(v: string): string {
  const [maj, min] = v.split('.').map(Number)
  return `${maj}.${(min ?? 0) + 1}`
}

export async function cmdPublishRuleset(d: AppData, ctx: CommandCtx, draft: Ruleset, equalityNote: string): Promise<{ data: AppData; ruleset: HashedRuleset }> {
  assertCan(ctx.user, 'publish_policy')
  if (equalityNote.trim().length < EQUALITY_NOTE_MIN_CHARS)
    throw new ValidationError([
      {
        path: 'equality',
        severity: 'error',
        message: `Record the equality assessment for this change (at least ${EQUALITY_NOTE_MIN_CHARS} characters): weights decide who gets placed where.`,
      },
    ])
  const actor = actorRef(ctx.user!)
  const latest = d.rulesets[d.rulesets.length - 1]
  const next = await hashRuleset({
    ...draft,
    version: nextVersion(latest.version),
    effectiveFrom: ctx.today,
    signOff: { by: actor.name, role: actor.roleLabel, at: ctx.now, equalityNote: equalityNote.trim(), actor },
    hash: undefined,
  })
  return { data: { ...d, rulesets: [...d.rulesets, next], activeVersion: next.version }, ruleset: next }
}

export function cmdReplaceProperties(d: AppData, ctx: CommandCtx, props: Property[], mode: 'add' | 'replace'): AppData {
  assertCan(ctx.user, 'edit_properties')
  const merged = mode === 'replace' ? props : [...d.properties.filter(p => !props.some(n => n.id === p.id)), ...props]
  return { ...d, properties: merged, propertiesVersion: `inventory ${ctx.now.slice(0, 16).replace('T', ' ')} (import by ${ctx.user!.name})` }
}

export function cmdConfirmAvailability(d: AppData, ctx: CommandCtx, propertyId: string): AppData {
  assertCan(ctx.user, 'confirm_availability')
  if (!d.properties.some(p => p.id === propertyId)) throw new Error('Property not found.')
  return {
    ...d,
    properties: d.properties.map(p => (p.id === propertyId ? { ...p, availabilityConfirmedAt: ctx.now, availabilityConfirmedBy: ctx.user!.name } : p)),
    propertiesVersion: `inventory ${ctx.now.slice(0, 16).replace('T', ' ')}`,
  }
}

/** Demo only: change record #1 without resealing it, so the seal check can show it. */
export function cmdTamper(d: AppData, ctx: CommandCtx): AppData {
  assertCan(ctx.user, 'run_tamper_demo')
  if (d.chain.length === 0 || d.tamperBackup) return d
  const target = d.chain[0]
  const altered: ChainPayload = structuredClone(target.snapshot)
  if (isDecisionSnapshot(altered)) altered.decision.reasonText = `${altered.decision.reasonText} [edited after the decision]`
  else altered.notes = [...altered.notes, '[edited after the event]']
  return {
    ...d,
    chain: d.chain.map(r => (r.seq === target.seq ? { ...r, snapshot: altered } : r)),
    tamperBackup: { seq: target.seq, snapshot: target.snapshot },
  }
}

export function cmdUndoTamper(d: AppData, ctx: CommandCtx): AppData {
  assertCan(ctx.user, 'run_tamper_demo')
  if (!d.tamperBackup) return d
  const b = d.tamperBackup
  return { ...d, chain: d.chain.map(r => (r.seq === b.seq ? { ...r, snapshot: b.snapshot } : r)), tamperBackup: undefined }
}
