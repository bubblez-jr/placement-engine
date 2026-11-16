import type { ActorRef, StaffRole, StaffUser } from './types'

// Who may do what. Pure and tested as a full role × action matrix. The store
// calls assertCan() before every change, so hiding a button is never the only
// thing standing between a role and an action.

export const ROLE_LABEL: Record<StaffRole, string> = {
  ta_officer: 'Temporary accommodation officer',
  ooh_officer: 'Out-of-hours officer',
  team_manager: 'Team manager',
  head_of_service: 'Head of service (policy owner)',
  compliance_officer: 'Supply and compliance officer',
  auditor: 'Auditor (read only)',
  admin: 'System administrator',
}

export const ROLES = Object.keys(ROLE_LABEL) as StaffRole[]

export type Action =
  | 'run_search'
  | 'record_decision'
  | 'record_consent'
  | 'approve_exception'
  | 'publish_policy'
  | 'edit_properties'
  | 'confirm_availability'
  | 'act_on_placement'
  | 'complete_task'
  | 'reassign_task'
  | 'cancel_task'
  | 'view_audit_log'
  | 'run_tamper_demo'
  | 'reset_demo'
  | 'import_household'
  | 'export_records'

export const ACTION_LABEL: Record<Action, string> = {
  run_search: 'run a placement search',
  record_decision: 'record a placement decision',
  record_consent: 'record or update consent',
  approve_exception: 'approve an exception',
  publish_policy: 'publish a placement policy version',
  edit_properties: 'import or edit properties',
  confirm_availability: 'confirm a property’s availability',
  act_on_placement: 'act on a placement',
  complete_task: 'complete a task',
  reassign_task: 'reassign a task',
  cancel_task: 'cancel a task',
  view_audit_log: 'view the audit log',
  run_tamper_demo: 'run the tamper demonstration',
  reset_demo: 'reset the demo data',
  import_household: 'import a household',
  export_records: 'export records',
}

export const ACTIONS = Object.keys(ACTION_LABEL) as Action[]

const CASEWORK: Action[] = [
  'run_search',
  'record_decision',
  'record_consent',
  'confirm_availability',
  'act_on_placement',
  'complete_task',
  'view_audit_log',
  'run_tamper_demo',
  'import_household',
  'export_records',
]
const MANAGER: Action[] = [...CASEWORK, 'approve_exception', 'reassign_task', 'cancel_task']

/** The matrix. Anything not listed is refused. */
export const GRANTS: Record<StaffRole, ReadonlySet<Action>> = {
  ta_officer: new Set(CASEWORK),
  ooh_officer: new Set(CASEWORK),
  team_manager: new Set(MANAGER),
  head_of_service: new Set([...MANAGER, 'publish_policy']),
  compliance_officer: new Set<Action>(['edit_properties', 'confirm_availability', 'complete_task', 'view_audit_log', 'run_tamper_demo', 'export_records']),
  // Reads everything, changes nothing.
  auditor: new Set<Action>(['view_audit_log', 'export_records']),
  // Runs the system and the policy file; does not decide placements or approve them.
  admin: new Set<Action>([
    'publish_policy',
    'edit_properties',
    'confirm_availability',
    'reassign_task',
    'view_audit_log',
    'run_tamper_demo',
    'reset_demo',
    'import_household',
    'export_records',
  ]),
}

export interface PermissionContext {
  /** For approvals: who recorded the decision being approved */
  decidedByUserId?: string
  /** For tasks: the person a task is assigned to, if it is assigned to a person */
  taskOwnerUserId?: string
  /** For tasks: the role queue a task is assigned to, if it is assigned to a queue */
  taskOwnerRole?: StaffRole
}

export type PermissionCheck = { ok: true } | { ok: false; reason: string }

export function check(user: Pick<StaffUser, 'id' | 'role'> | null | undefined, action: Action, ctx: PermissionContext = {}): PermissionCheck {
  if (!user) return { ok: false, reason: 'Sign in first.' }
  if (!GRANTS[user.role]?.has(action)) return { ok: false, reason: `Your role (${ROLE_LABEL[user.role] ?? user.role}) cannot ${ACTION_LABEL[action]}.` }
  if (action === 'approve_exception' && ctx.decidedByUserId === user.id) return { ok: false, reason: 'Nobody can approve their own decision.' }
  if (action === 'complete_task' && ctx.taskOwnerUserId && ctx.taskOwnerUserId !== user.id && !GRANTS[user.role].has('reassign_task'))
    return { ok: false, reason: 'This task is assigned to someone else. A manager can reassign it.' }
  if (action === 'complete_task' && ctx.taskOwnerRole && ctx.taskOwnerRole !== user.role && !GRANTS[user.role].has('reassign_task'))
    return { ok: false, reason: `This task is for the ${ROLE_LABEL[ctx.taskOwnerRole].toLowerCase()} queue. A manager can reassign it.` }
  return { ok: true }
}

export function can(user: Pick<StaffUser, 'id' | 'role'> | null | undefined, action: Action, ctx: PermissionContext = {}): boolean {
  return check(user, action, ctx).ok
}

/** Thrown by the store when the signed-in person may not take an action. */
export class PermissionError extends Error {
  readonly action: Action
  constructor(action: Action, reason: string) {
    super(reason)
    this.name = 'PermissionError'
    this.action = action
  }
}

export function assertCan(user: Pick<StaffUser, 'id' | 'role'> | null | undefined, action: Action, ctx: PermissionContext = {}): void {
  const r = check(user, action, ctx)
  if (!r.ok) throw new PermissionError(action, r.reason)
}

export function actorRef(user: StaffUser): ActorRef {
  return { userId: user.id, name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role] }
}
