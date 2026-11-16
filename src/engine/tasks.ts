import { addDays, addHours, endOfDay, formatDate, formatUkTimeOn, nextWorkingDayAt, ukDate } from './dates'
import { complianceLabel, requiredCompliance } from './gates'
import { quoted } from './text'
import { approvalClears, approvalPending, LIVE, sharedStayDay, type ApprovalView, type Placement } from './placement'
import { ROLE_LABEL } from './permissions'
import type { ActorRef, EventFact, IsoDateTime, Issue, PlacementPolicy, Property, Ruleset, StaffRole, StaffUser, StatutoryClock, TaskOwner } from './types'

// Warnings become tasks. Tasks are derived, not stored: one pure function
// turns the placements, the inventory and the sealed task events into the task
// list at `now`. Ids are keyed on what the task is about, so running it twice
// gives the same tasks, and a completion sealed against an id always finds it.
// Only new facts are stored (as chain events): completion with evidence,
// reassignment, cancellation. Reminders are in-app only: there is no server
// to send email yet.

export type TaskKind =
  | 's208'
  | 's213aa'
  | 'consent'
  | 'bnb_review'
  | 'bnb_manager'
  | 'bnb_urgent'
  | 'bnb_limit'
  | 'certificate'
  | 'stay_end'
  | 'availability_end'
  | 'hold'
  | 'approval'
  | 'refusal_review'
  | 'rejected_move'

export type TaskStatus = 'open' | 'done' | 'cancelled'
export type Escalation = 'none' | 'due_soon' | 'overdue' | 'escalated'

export interface Task {
  id: string
  kind: TaskKind
  title: string
  detail?: string
  basis: string
  /** The decision record (placement) the task is about, if any */
  seq?: number
  caseRef?: string
  /** The property the task is about, if any */
  propertyId?: string
  /** Who holds it now (after any reassignment) */
  owner: TaskOwner
  due: IsoDateTime
  urgent: boolean
  status: TaskStatus
  /** Worked out from the due time and `now`; none once a task is closed */
  escalation: Escalation
  /** Who an escalated task is raised to */
  escalatedTo?: StaffRole
  /** Approval tasks close only by approving or rejecting, never by "complete" */
  closesBy?: 'approval'
  /** Closed by a later fact rather than by hand (e.g. "Approved by …, record #12") */
  closedBy?: string
  completion?: { seq: number; at: IsoDateTime; actor: ActorRef; evidence: string; reference: string }
  cancellation?: { seq: number; at: IsoDateTime; actor: ActorRef; reason: string }
  reassignments: { seq: number; at: IsoDateTime; actor: ActorRef; from: TaskOwner; to: TaskOwner; note: string }[]
}

/** What a decision record contributes, read version-aware by audit/records.ts. */
export interface CaseFacts {
  seq: number
  caseRef: string
  decidedAt: IsoDateTime
  /** The deciding officer, or the officers' queue for a schema-1 record (free-text name) */
  decider: TaskOwner
  outcome: 'accepted' | 'override' | 'no_suitable'
  placement: Placement | null
  approval: ApprovalView
  /** The deadlines as they stand now (sealed clocks read with later consent facts) */
  clocks: StatutoryClock[]
  /** Consent as sealed at the decision, and now. */
  consent: { atDecision: 'not_applicable' | 'not_asked' | 'answered'; now: 'not_applicable' | 'given' | 'refused' | 'not_asked'; recordedSeq?: number }
  policy: PlacementPolicy
}

export interface TaskInput {
  now: IsoDateTime
  cases: CaseFacts[]
  properties: Property[]
  /** The active policy: required certificates and the parameters for property tasks */
  ruleset: Ruleset
  policy: PlacementPolicy
  /** Sealed task events (completed, reassigned, cancelled), in chain order */
  events: EventFact[]
}

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  s208: 'Notice to another council',
  s213aa: 'School and health notification',
  consent: 'Consent follow-up',
  bnb_review: 'Move-on review',
  bnb_manager: 'Shared accommodation: manager',
  bnb_urgent: 'Shared accommodation: urgent',
  bnb_limit: 'Shared accommodation: limit',
  certificate: 'Certificate',
  stay_end: 'Stay ending',
  availability_end: 'Availability ending',
  hold: 'Hold ending',
  approval: 'Approval',
  refusal_review: 'Refusal review',
  rejected_move: 'Rejected exception',
}

export const ESCALATION_LABEL: Record<Escalation, string> = { none: 'Open', due_soon: 'Due soon', overdue: 'Overdue', escalated: 'Escalated' }

export const COMPLETE_MIN_CHARS = 10
export const REFERENCE_MIN_CHARS = 3

const role = (r: StaffRole): TaskOwner => ({ kind: 'role', role: r })

const KIND_BY_PREFIX: Record<string, TaskKind> = {
  s208: 's208',
  s213aa: 's213aa',
  consent: 'consent',
  'bnb-review': 'bnb_review',
  'bnb-manager': 'bnb_manager',
  'bnb-urgent': 'bnb_urgent',
  'bnb-limit': 'bnb_limit',
  cert: 'certificate',
  'stay-end': 'stay_end',
  'availability-end': 'availability_end',
  hold: 'hold',
  approval: 'approval',
  refusal: 'refusal_review',
  'rejected-move': 'rejected_move',
}

/** The kind of task an id names (ids are `<prefix>:<what it is about>`). */
export function kindOfTaskId(id: string): TaskKind {
  return KIND_BY_PREFIX[id.split(':')[0]] ?? 'hold'
}

/** Who an overdue task is raised to: officers' and supply tasks to the team manager, the manager's to the head of service. */
export function escalationTarget(owner: TaskOwner): StaffRole | undefined {
  if (owner.role === 'head_of_service') return undefined
  if (owner.role === 'team_manager') return 'head_of_service'
  return 'team_manager'
}

/** Due soon, overdue, then escalated after the policy's number of days overdue. */
export function escalationOf(due: IsoDateTime, now: IsoDateTime, policy: Pick<PlacementPolicy, 'taskDueSoonHours' | 'taskEscalateAfterDays'>): Escalation {
  if (now >= addHours(due, policy.taskEscalateAfterDays * 24)) return 'escalated'
  if (now >= due) return 'overdue'
  if (now >= addHours(due, -policy.taskDueSoonHours)) return 'due_soon'
  return 'none'
}

type Draft = Omit<Task, 'status' | 'escalation' | 'escalatedTo' | 'reassignments'> & { status?: TaskStatus }

function caseTasks(c: CaseFacts, now: IsoDateTime): Draft[] {
  const out: Draft[] = []
  const today = ukDate(now)
  const p = c.placement
  const at = { seq: c.seq, caseRef: c.caseRef }
  const pol = c.policy

  // Approval of an exception: the manager's queue. Closed by the approval itself.
  const a = c.approval
  const moot = (a.status === 'awaiting' || a.status === 'out_of_hours') && !approvalPending(a, p)
  if (a.status !== 'not_required' && !moot) {
    const deferral = a.status === 'awaiting' ? undefined : a.deferral
    const due = deferral ? deferral.approveBy : p ? p.holdUntil : nextWorkingDayAt(c.decidedAt, '17:00')
    const ooh = !!deferral
    out.push({
      ...at,
      id: `approval:${c.seq}`,
      kind: 'approval',
      title: ooh ? `Placed out of hours: approve or reject the exception for ${c.caseRef}` : `Approve or reject the exception for ${c.caseRef}`,
      detail: ooh ? 'The officer used “placed out of hours, approval to follow”. The family may already be there.' : undefined,
      basis: 'Council placement policy: exceptions need a manager’s approval',
      owner: role('team_manager'),
      due,
      urgent: ooh,
      closesBy: 'approval',
      ...(a.status === 'approved' || a.status === 'rejected'
        ? { status: 'done' as const, closedBy: `${a.status === 'approved' ? 'Approved' : 'Rejected'} by ${a.decision.actor.name}, record #${a.decision.seq}` }
        : {}),
    })
  }
  if (!p) return out
  const voided = p.state === 'refused' || p.state === 'cancelled' || p.state === 'hold_expired'
  const live = LIVE.includes(p.state)

  // A hold about to end with no provider confirmation.
  if (p.state === 'held' && now >= addHours(p.holdUntil, -pol.holdWarningHours)) {
    out.push({
      ...at,
      id: `hold:${c.seq}`,
      kind: 'hold',
      title: `Confirm ${p.propertyLabel} with the provider before the hold ends`,
      detail: `The hold ends at ${formatUkTimeOn(p.holdUntil)}. After that the property is free for other cases.${approvalClears(a) ? '' : ' A manager must approve the exception first, unless the household cannot wait.'}`,
      basis: `Council placement policy: holds last ${Math.round((new Date(p.holdUntil).getTime() - new Date(p.decidedAt).getTime()) / 3_600_000)} hours`,
      owner: c.decider,
      due: p.holdUntil,
      urgent: true,
    })
  }

  // A refusal goes to a manager. The product records it; it draws no conclusion.
  if (p.state === 'refused' && p.refusal) {
    out.push({
      ...at,
      id: `refusal:${c.seq}`,
      kind: 'refusal_review',
      title: `Review the household’s refusal of ${p.propertyLabel}`,
      detail: `The household said: ${quoted(p.refusal.reason)} Recorded by ${p.refusal.actor.name}. This product records the refusal and draws no conclusion from it.`,
      basis: 'Council placement policy: refusals are reviewed by a manager',
      owner: role('team_manager'),
      due: nextWorkingDayAt(p.refusal.at, '17:00'),
      urgent: false,
    })
  }

  // Rejected after the family had moved in under the out-of-hours route.
  if (a.status === 'rejected' && (p.state === 'checked_in' || p.state === 'moved_out') && !p.cancellation) {
    out.push({
      ...at,
      id: `rejected-move:${c.seq}`,
      kind: 'rejected_move',
      title: `Arrange a move: the exception for ${p.propertyLabel} was rejected`,
      detail: `${a.decision.actor.name} rejected the exception: ${quoted(a.decision.reason)} The family moved in under the out-of-hours route.`,
      basis: 'Council placement policy: exceptions need a manager’s approval',
      owner: c.decider,
      due: nextWorkingDayAt(a.decision.at, '17:00'),
      urgent: true,
    })
  }
  if (voided) return out

  // Statutory notices and the consent follow-up, from the deadlines as they stand.
  for (const k of c.clocks) {
    if (k.status === 'done') continue
    if (k.key === 's208')
      out.push({ ...at, id: `s208:${c.seq}`, kind: 's208', title: k.label, basis: k.basis, owner: c.decider, due: endOfDay(k.due), urgent: false })
    if (k.key === 's213aa' && c.consent.now === 'given')
      out.push({ ...at, id: `s213aa:${c.seq}`, kind: 's213aa', title: k.label, basis: k.basis, owner: c.decider, due: endOfDay(k.due), urgent: false })
  }
  if (c.consent.atDecision === 'not_asked') {
    const asked = c.consent.now !== 'not_asked'
    out.push({
      ...at,
      id: `consent:${c.seq}`,
      kind: 'consent',
      title: 'Ask a parent for consent to notify the school, GP and health visitor',
      basis: 'Council practice: ask within 7 days so the s213AA notice can still go within 14 days',
      owner: c.decider,
      due: endOfDay(addDays(p.startDate, 7)),
      urgent: false,
      ...(asked ? { status: 'done' as const, closedBy: `Consent recorded${c.consent.recordedSeq ? `, record #${c.consent.recordedSeq}` : ''}` } : {}),
    })
  }

  // The six-week ladder for a family in shared accommodation, from the start of the stay.
  const stay = sharedStayDay(p, now)
  if (stay && live) {
    const start = p.checkedInOn ?? p.startDate
    const owner: TaskOwner = p.moveOnPlan ? { kind: 'user', ...p.moveOnPlan.owner } : c.decider
    const basis = `Homelessness (Suitability of Accommodation) (England) Order 2003: no more than ${p.limitDays / 7} weeks`
    const opens = (day: number) => today >= addDays(start, day - pol.bnbReviewEveryDays)
    for (let day = pol.bnbReviewEveryDays, n = 1; day < p.limitDays; day += pol.bnbReviewEveryDays, n++) {
      if (!opens(day)) continue
      out.push({
        ...at,
        id: `bnb-review:${c.seq}:${n}`,
        kind: 'bnb_review',
        title: `Week ${n} move-on review: ${p.propertyLabel}`,
        detail: p.moveOnPlan ? `Plan: move by ${formatDate(p.moveOnPlan.targetDate)}.` : 'No move-on plan was recorded under the earlier version.',
        basis,
        owner,
        due: endOfDay(addDays(start, day)),
        urgent: false,
      })
    }
    const steps: [typeof pol.bnbManagerDay, 'bnb_manager' | 'bnb_urgent' | 'bnb_limit', string, TaskOwner, boolean][] = [
      [pol.bnbManagerDay, 'bnb_manager', `Day ${pol.bnbManagerDay} in shared accommodation: manager to review the move-on plan`, role('team_manager'), false],
      [pol.bnbUrgentDay, 'bnb_urgent', `Urgent: ${p.limitDays - pol.bnbUrgentDay} days left before the six-week limit`, role('team_manager'), true],
      [p.limitDays, 'bnb_limit', 'Six-week limit reached: head of service to act on the breach', role('head_of_service'), true],
    ]
    for (const [day, kind, title, who, urgent] of steps) {
      if (!opens(day)) continue
      out.push({
        ...at,
        id: `${kind.replace('_', '-')}:${c.seq}`,
        kind,
        title: `${title} (${p.propertyLabel})`,
        detail:
          kind === 'bnb_limit' && stay.breached
            ? `Over the limit: ${stay.day} days used of ${stay.limit}. The dates come from the sealed move-in record, so the breach cannot be lost.`
            : `${stay.day} of ${stay.limit} days used.`,
        basis,
        owner: who,
        due: endOfDay(addDays(start, day)),
        urgent,
      })
    }
  }

  // The planned stay or the supplier's availability ending.
  if (live && p.currentEnd <= addDays(today, pol.stayEndWarningDays)) {
    out.push({
      ...at,
      id: `stay-end:${c.seq}:${p.currentEnd}`,
      kind: 'stay_end',
      title: `Planned stay at ${p.propertyLabel} ends ${formatDate(p.currentEnd)}: arrange the move or extend`,
      basis: 'Council placement policy: plan each move before the stay ends',
      owner: c.decider,
      due: endOfDay(p.currentEnd),
      urgent: false,
    })
  }
  return out
}

function propertyTasks(input: TaskInput, liveOn: Map<string, Placement[]>): Draft[] {
  const out: Draft[] = []
  const today = ukDate(input.now)
  const horizon = addDays(today, input.policy.certificateWarningDays)
  for (const prop of input.properties) {
    for (const type of requiredCompliance(prop, input.ruleset)) {
      const item = prop.compliance.find(x => x.type === type)
      if (!item?.expires || item.expires > horizon) continue
      const during = (liveOn.get(prop.id) ?? []).find(p => item.expires! < p.currentEnd)
      out.push({
        id: `cert:${prop.id}:${type}:${item.expires}`,
        kind: 'certificate',
        title: `${item.expires < today ? 'Expired' : 'Renew'}: ${complianceLabel(type).toLowerCase()} for ${prop.label}`,
        detail: `${item.expires < today ? 'Expired' : 'Expires'} ${formatDate(item.expires)}.${during ? ` A household is placed there (case ${during.caseRef}) past that date.` : ''}`,
        basis: 'Homelessness (Suitability of Accommodation) (England) Order 2012, art.3',
        propertyId: prop.id,
        ...(during ? { seq: during.seq, caseRef: during.caseRef } : {}),
        owner: role('compliance_officer'),
        due: endOfDay(item.expires),
        urgent: !!during,
      })
    }
    // The supplier's availability ending during a live placement.
    for (const p of liveOn.get(prop.id) ?? []) {
      if (!prop.availableUntil || prop.availableUntil >= p.currentEnd || prop.availableUntil > addDays(today, input.policy.stayEndWarningDays)) continue
      out.push({
        id: `availability-end:${p.seq}:${prop.availableUntil}`,
        kind: 'availability_end',
        title: `${prop.label} is available only until ${formatDate(prop.availableUntil)}: arrange the next move or agree an extension`,
        basis: 'Supplier availability on file',
        seq: p.seq,
        caseRef: p.caseRef,
        propertyId: prop.id,
        owner: p.decidedBy ? { kind: 'user', ...p.decidedBy } : role('ta_officer'),
        due: endOfDay(prop.availableUntil),
        urgent: false,
      })
    }
  }
  return out
}

/** Every task at `now`. Pure and idempotent: the same inputs always give the same list, in the same order. */
export function deriveTasks(input: TaskInput): Task[] {
  const liveOn = new Map<string, Placement[]>()
  for (const c of input.cases) {
    const p = c.placement
    if (p && LIVE.includes(p.state)) liveOn.set(p.propertyId, [...(liveOn.get(p.propertyId) ?? []), p])
  }
  const drafts = [...input.cases.flatMap(c => caseTasks(c, input.now)), ...propertyTasks(input, liveOn)]
  const byId = new Map<string, Task>()
  for (const d of drafts) {
    if (byId.has(d.id)) continue
    byId.set(d.id, { ...d, status: d.status ?? 'open', escalation: 'none', reassignments: [] })
  }
  // Sealed facts about tasks. A completed task stays on the list even when its
  // trigger has gone, rebuilt from the title sealed with its completion.
  for (const e of input.events) {
    const b = e.body
    if (b.type !== 'task_completed' && b.type !== 'task_reassigned' && b.type !== 'task_cancelled') continue
    let task = byId.get(b.taskId)
    if (!task) {
      if (b.type === 'task_reassigned') continue
      task = {
        id: b.taskId,
        kind: kindOfTaskId(b.taskId),
        title: b.title,
        basis: '',
        owner: { kind: 'user', userId: e.actor.userId, name: e.actor.name, role: e.actor.role },
        due: e.at,
        urgent: false,
        status: 'open',
        escalation: 'none',
        reassignments: [],
      }
      byId.set(b.taskId, task)
    }
    if (task.status !== 'open' && b.type !== 'task_reassigned') continue
    if (b.type === 'task_completed')
      Object.assign(task, { status: 'done', completion: { seq: e.seq, at: e.at, actor: e.actor, evidence: b.evidence, reference: b.reference } })
    if (b.type === 'task_cancelled') Object.assign(task, { status: 'cancelled', cancellation: { seq: e.seq, at: e.at, actor: e.actor, reason: b.reason } })
    if (b.type === 'task_reassigned') {
      task.reassignments.push({ seq: e.seq, at: e.at, actor: e.actor, from: b.from, to: b.to, note: b.note })
      task.owner = b.to
    }
  }
  const tasks = [...byId.values()]
  for (const t of tasks) {
    if (t.status !== 'open') continue
    t.escalation = escalationOf(t.due, input.now, input.policy)
    if (t.escalation === 'escalated') t.escalatedTo = escalationTarget(t.owner)
  }
  return tasks.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
}

// ---------- Who sees what ----------

export function ownerLabel(o: TaskOwner): string {
  return o.kind === 'user' ? o.name : `${ROLE_LABEL[o.role]} queue`
}

/** Mine: assigned to me, to my role's queue, or escalated to my role. */
export function isMine(t: Task, user: Pick<StaffUser, 'id' | 'role'>): boolean {
  if (t.owner.kind === 'user' ? t.owner.userId === user.id : t.owner.role === user.role) return true
  return t.status === 'open' && t.escalation === 'escalated' && t.escalatedTo === user.role
}

/** My team: owned by anyone in my team (by person or by the role queues my team holds), or mine. */
export function isMyTeam(t: Task, user: StaffUser, staff: StaffUser[]): boolean {
  if (isMine(t, user)) return true
  const team = staff.filter(s => s.team === user.team)
  return t.owner.kind === 'user' ? team.some(s => s.id === (t.owner as { userId: string }).userId) : team.some(s => s.role === t.owner.role)
}

/** Plain words for a task's due state, from `now`. */
export function dueText(t: Task, now: IsoDateTime): string {
  const hours = (new Date(t.due).getTime() - new Date(now).getTime()) / 3_600_000
  if (t.status === 'done') return 'Done'
  if (t.status === 'cancelled') return 'Cancelled'
  if (hours < 0) {
    const days = Math.floor(-hours / 24)
    return days >= 1 ? `${days} day${days === 1 ? '' : 's'} overdue` : `${Math.max(1, Math.round(-hours))} h overdue`
  }
  if (hours < 24) return `due in ${Math.max(1, Math.round(hours))} h`
  const days = Math.round(hours / 24)
  return `due in ${days} day${days === 1 ? '' : 's'}`
}

// ---------- What closing or moving a task needs ----------

/** Completing a task needs evidence: what was done, and a reference to find it by. */
export function validateCompletion(input: { evidence?: string; reference?: string }): Issue[] {
  const issues: Issue[] = []
  if ((input.evidence ?? '').trim().length < COMPLETE_MIN_CHARS)
    issues.push({ path: 'task-evidence', severity: 'error', message: `Say what was done (at least ${COMPLETE_MIN_CHARS} characters).` })
  if ((input.reference ?? '').trim().length < REFERENCE_MIN_CHARS)
    issues.push({ path: 'task-reference', severity: 'error', message: 'Give a reference: a document, email or call reference.' })
  return issues
}

export function validateReassign(task: Task, to: TaskOwner | null, note: string | undefined): Issue[] {
  const issues: Issue[] = []
  if (!to) issues.push({ path: 'task-to', severity: 'error', message: 'Choose who the task goes to.' })
  else if (JSON.stringify(to) === JSON.stringify(task.owner)) issues.push({ path: 'task-to', severity: 'error', message: 'The task is already theirs.' })
  if ((note ?? '').trim().length < COMPLETE_MIN_CHARS)
    issues.push({ path: 'task-note', severity: 'error', message: `Add a note for the new owner (at least ${COMPLETE_MIN_CHARS} characters).` })
  return issues
}

export function validateCancel(reason: string | undefined): Issue[] {
  return (reason ?? '').trim().length < COMPLETE_MIN_CHARS
    ? [{ path: 'task-cancelReason', severity: 'error', message: `Give the reason for cancelling (at least ${COMPLETE_MIN_CHARS} characters).` }]
    : []
}
