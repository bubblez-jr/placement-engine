import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../store/app'
import { useNav } from '../store/nav'
import { useUser } from '../auth/session'
import { taskOwnerChoices } from '../store/commands'
import { describeEvent } from '../audit/records'
import type { ChainRecord, DecisionRecord } from '../audit/chain'
import type { PlacementEvent } from '../audit/snapshot'
import { formatDate, formatDateTime, formatUkTimeOn, ukDate } from '../engine/dates'
import { EMERGENCY_REASON_LABEL, MOVE_ON_ROUTE_LABEL } from '../engine/decision'
import { check } from '../engine/permissions'
import {
  ACTION_LABEL,
  approvalBlock,
  approvalPending,
  DEFERRAL_MIN_CHARS,
  DESTINATION_LABEL,
  LIFECYCLE,
  LIVE,
  nextActions,
  OFFER_METHOD_LABEL,
  sharedStayDay,
  sharedStayLimitDate,
  STATE_LABEL,
  validateApproval,
  validateDeferral,
  validateExtension,
  validateTransition,
  type ApprovalView,
  type Placement,
  type TransitionInput,
} from '../engine/placement'
import { EXCEPTION_LABEL } from '../engine/policy'
import { quoted } from '../engine/text'
import { conflictsFor, occupancyMessage } from '../engine/occupancy'
import { dueText, ESCALATION_LABEL, ownerLabel, TASK_KIND_LABEL, validateCancel, validateCompletion, validateReassign, type Task } from '../engine/tasks'
import { ROLE_LABEL } from '../engine/permissions'
import type { Issue, MoveOutDestination, OfferMethod, PlacementAction, PlacementState, TaskOwner } from '../engine/types'
import { ValidationError } from '../engine/validate'
import { ErrorSummary, Field, FieldError, fieldA11y, NotAllowed } from './bits'
import { Icon } from './icons'

// Pieces shared by the placement page, the Tasks and Approvals screens and the
// overview. Every rule shown here is checked again by the store; the screens
// only present it.

/** A form that shows its issues on submit, then live; the summary takes focus; store refusals are shown in the same way. */
export function ActionForm({
  id,
  validate,
  onSubmit,
  submitLabel,
  onCancel,
  children,
  intro,
}: {
  id: string
  validate: () => Issue[]
  onSubmit: () => Promise<unknown>
  submitLabel: string
  onCancel?: () => void
  children: (issues: Issue[]) => ReactNode
  intro?: ReactNode
}) {
  const [shown, setShown] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus()
  }, [focus])
  const issues = shown ? (serverIssues.length ? serverIssues : validate()) : []
  return (
    <form
      id={id}
      noValidate
      className="grid gap-3 rounded-lg border border-rule bg-surface p-3 sm:p-4"
      onSubmit={async e => {
        e.preventDefault()
        setError(null)
        setServerIssues([])
        const found = validate()
        setShown(true)
        if (found.some(i => i.severity === 'error')) return setFocus(n => n + 1)
        setBusy(true)
        try {
          await onSubmit()
        } catch (err) {
          if (err instanceof ValidationError) {
            setServerIssues(err.issues)
            setFocus(n => n + 1)
          } else setError((err as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      {intro && <div className="text-sm text-muted">{intro}</div>}
      <ErrorSummary ref={ref} id={`${id}-errors`} issues={issues} />
      {children(issues)}
      {error && (
        <p role="alert" className="rounded-md border border-bad bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sealing…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function TextArea({
  id,
  label,
  value,
  onChange,
  issues,
  hint,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  issues: Issue[]
  hint?: string
  placeholder?: string
}) {
  return (
    <Field id={id} label={label} issues={issues} hint={hint}>
      <textarea
        {...fieldA11y(id, issues, hint ? `${id}-hint` : undefined)}
        className="input min-h-16"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  )
}

function TextInput({
  id,
  label,
  value,
  onChange,
  issues,
  type = 'text',
  className = '',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  issues: Issue[]
  type?: string
  className?: string
}) {
  return (
    <Field id={id} label={label} issues={issues} className={className}>
      <input {...fieldA11y(id, issues)} type={type} className="input" value={value} onChange={e => onChange(e.target.value)} />
    </Field>
  )
}

// ---------- Status ----------

const STATE_CHIP: Record<PlacementState, string> = {
  held: 'chip-accent',
  provider_confirmed: 'chip-accent',
  offered: 'chip-accent',
  accepted: 'chip-accent',
  checked_in: 'chip-good',
  moved_out: 'chip-plain',
  refused: 'chip-warn',
  cancelled: 'chip-plain',
  hold_expired: 'chip-bad',
}

export function StateChip({ state }: { state: PlacementState }) {
  return <span className={`chip ${STATE_CHIP[state]}`}>{STATE_LABEL[state]}</span>
}

export function ApprovalChip({ a }: { a: ApprovalView }) {
  if (a.status === 'not_required') return null
  if (a.status === 'awaiting') return <span className="chip chip-warn">Awaiting approval</span>
  if (a.status === 'out_of_hours') return <span className="chip chip-bad">Placed out of hours: approval to follow</span>
  return (
    <span className={`chip ${a.status === 'approved' ? 'chip-good' : 'chip-bad'}`}>
      {a.status === 'approved' ? 'Exception approved' : 'Exception rejected'}
    </span>
  )
}

/** "Held until 10:00 on 3 Nov (5 h left)" */
export function holdText(p: Placement, now: string): string {
  const hours = (new Date(p.holdUntil).getTime() - new Date(now).getTime()) / 3_600_000
  if (hours <= 0) return `The hold ended at ${formatUkTimeOn(p.holdUntil)}`
  return `Held until ${formatUkTimeOn(p.holdUntil)} (${hours < 1 ? 'under an hour' : `${Math.floor(hours)} h`} left)`
}

/** The six steps of a placement, with when each was reached. */
export function Stepper({ p }: { p: Placement }) {
  const reached = new Map<PlacementState, { at: string; by: string }>([['held', { at: p.decidedAt, by: p.decidedByName }]])
  for (const s of p.steps) reached.set(s.to, { at: s.at, by: s.actor.name })
  const onPath = LIFECYCLE.includes(p.state)
  const current = onPath ? p.state : null
  return (
    <div className="grid gap-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Placement steps">
        {LIFECYCLE.map((st, i) => {
          const r = reached.get(st)
          const isCurrent = st === current
          const done = !!r && !isCurrent
          return (
            <li
              key={st}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-start gap-2 rounded-lg border p-2 ${isCurrent ? 'border-accent bg-accent-soft' : 'border-rule'}`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold ${done ? 'bg-good-soft text-good' : isCurrent ? 'bg-accent text-accent-ink' : 'bg-sunken text-faint'}`}
                aria-hidden="true"
              >
                {done ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${r ? '' : 'text-faint'}`}>{STATE_LABEL[st]}</span>
                <span className="block text-xs text-muted">{r ? formatDateTime(r.at) : 'Not yet'}</span>
                {done && <span className="sr-only">Done</span>}
                {isCurrent && <span className="sr-only">Current step</span>}
              </span>
            </li>
          )
        })}
      </ol>
      {!onPath && (
        <p className={`callout ${p.state === 'hold_expired' ? 'border-bad bg-bad-soft' : 'border-warn bg-warn-soft'}`}>
          <b>{STATE_LABEL[p.state]}.</b>{' '}
          {p.state === 'refused' &&
            p.refusal &&
            `The household said: ${quoted(p.refusal.reason)} Recorded by ${p.refusal.actor.name}, ${formatDateTime(p.refusal.at)}.`}
          {p.state === 'cancelled' && p.cancellation && `${p.cancellation.reason} (${p.cancellation.actor.name}, ${formatDateTime(p.cancellation.at)}).`}
          {p.state === 'hold_expired' &&
            `Nobody recorded the provider’s confirmation before the hold ended at ${formatUkTimeOn(p.holdUntil)}, so the property is free for other cases.`}
        </p>
      )}
    </div>
  )
}

/** The day counter for a family in shared accommodation. */
export function SharedStayCounter({ p, now }: { p: Placement; now: string }) {
  const s = sharedStayDay(p, now)
  if (!s) return null
  const pct = Math.min(100, (s.day / s.limit) * 100)
  const tone = s.breached ? 'var(--bad)' : s.day >= 35 ? 'var(--warn)' : 'var(--accent)'
  return (
    <div className="grid gap-2" id="shared-stay-counter">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">
          {s.breached ? (
            <span className="text-bad">
              Over the limit: {s.day} days used of {s.limit}
            </span>
          ) : (
            <>
              {s.day} of {s.limit} days used in shared accommodation
            </>
          )}
          {s.ended && <span className="font-normal text-muted"> (moved out {formatDate(p.movedOutOn!)})</span>}
        </span>
        <span className="text-xs text-muted">Limit reached {formatDate(sharedStayLimitDate(p))}</span>
      </div>
      <div className="h-2.5 rounded-full bg-sunken" role="img" aria-label={`${s.day} of ${s.limit} days used`}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  )
}

/** Emergency reason and move-on plan, as sealed. */
export function MoveOnPlanView({ p }: { p: Placement }) {
  if (!p.sixWeekRule) return null
  if (!p.moveOnPlan || !p.emergency)
    return (
      <p className="text-sm text-muted">This decision was recorded under the earlier version, before an emergency reason and move-on plan were required.</p>
    )
  const m = p.moveOnPlan
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="eyebrow">Emergency reason</dt>
        <dd className="mt-0.5">
          {EMERGENCY_REASON_LABEL[p.emergency.reasonCode]}. “{p.emergency.reasonText}”
        </dd>
      </div>
      <div>
        <dt className="eyebrow">Move-on plan</dt>
        <dd className="mt-0.5">
          Move by <b>{formatDate(m.targetDate)}</b> to {MOVE_ON_ROUTE_LABEL[m.route].toLowerCase()}
          {m.routeNote ? ` (${m.routeNote})` : ''}. Owner: <b>{m.owner.name}</b>.
        </dd>
      </div>
    </dl>
  )
}

// ---------- Next action ----------

const empty: Omit<TransitionInput, 'action'> = {}

export function PlacementActions({ p }: { p: Placement }) {
  const { transition, now } = useApp()
  const user = useUser()
  const [open, setOpen] = useState<PlacementAction | null>(null)
  const [v, setV] = useState<Omit<TransitionInput, 'action'>>(empty)
  const [done, setDone] = useState<string | null>(null)
  const allowed = check(user, 'act_on_placement')
  const actions = nextActions(p)
  const set = (patch: Partial<TransitionInput>) => setV(x => ({ ...x, ...patch }))
  const today = ukDate(now)

  if (actions.length === 0)
    return (
      <div className="grid gap-1">
        {done && (
          <p role="status" className="text-sm text-good">
            {done}
          </p>
        )}
        <p className="text-sm text-muted">
          {p.state === 'moved_out'
            ? 'The household has moved out. Nothing more to do on this placement.'
            : 'This placement is closed. Nothing more can be recorded on it.'}
        </p>
      </div>
    )
  if (!allowed.ok) return <NotAllowed reason={allowed.reason} />

  const start = (a: PlacementAction) => {
    setOpen(a)
    setDone(null)
    setV(a === 'check_in' ? { checkedInOn: today } : a === 'move_out' ? { movedOutOn: today } : empty)
  }
  const input: TransitionInput = { action: open ?? 'accept', ...v }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {actions.map(a => {
          const blocked = approvalBlock(p, a)
          return (
            <button
              key={a}
              id={`act-${a}`}
              type="button"
              className={`btn ${a === actions[0] && !blocked ? 'btn-primary' : ''}`}
              disabled={!!blocked}
              aria-describedby={blocked ? 'approval-block' : undefined}
              onClick={() => start(a)}
            >
              {ACTION_LABEL[a]}
            </button>
          )
        })}
      </div>
      {actions.some(a => approvalBlock(p, a)) && (
        <p id="approval-block" className="flex items-start gap-2 text-sm text-warn">
          <Icon name="lock" size={15} className="mt-[3px] shrink-0" />
          {approvalBlock(p, actions.find(a => approvalBlock(p, a))!)}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-good">
          {done}
        </p>
      )}
      {open && (
        <ActionForm
          key={open}
          id="placement-step"
          submitLabel={ACTION_LABEL[open]}
          onCancel={() => setOpen(null)}
          validate={() => validateTransition(p, input, now)}
          onSubmit={async () => {
            const r = await transition(p.seq, input)
            setOpen(null)
            setDone(`Saved as record #${r.seq}.`)
          }}
          intro="This adds a sealed record with your name and the time. The decision record is not changed."
        >
          {issues => (
            <>
              <FieldError id="pl-action" issues={issues} />
              {open === 'confirm_provider' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    id="pl-contactName"
                    label="Who confirmed at the provider"
                    value={v.contactName ?? ''}
                    onChange={x => set({ contactName: x })}
                    issues={issues}
                  />
                  <TextInput
                    id="pl-providerReference"
                    label="Provider’s booking reference"
                    value={v.providerReference ?? ''}
                    onChange={x => set({ providerReference: x })}
                    issues={issues}
                  />
                </div>
              )}
              {open === 'offer' && (
                <>
                  <fieldset className="grid gap-1.5" aria-describedby={issues.some(i => i.path === 'pl-method') ? 'pl-method-error' : undefined}>
                    <legend className="mb-1 text-[0.8rem] font-semibold text-muted">How the offer was made</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {(Object.keys(OFFER_METHOD_LABEL) as OfferMethod[]).map((m, i) => (
                        <label key={m} className="flex items-center gap-1.5">
                          <input
                            id={i === 0 ? 'pl-method' : `pl-method-${m}`}
                            type="radio"
                            name="pl-method"
                            checked={v.method === m}
                            onChange={() => set({ method: m })}
                          />
                          {OFFER_METHOD_LABEL[m]}
                        </label>
                      ))}
                    </div>
                    <FieldError id="pl-method" issues={issues} />
                  </fieldset>
                  <TextArea id="pl-note" label="Note (optional)" value={v.note ?? ''} onChange={x => set({ note: x })} issues={issues} />
                </>
              )}
              {open === 'accept' && <TextArea id="pl-note" label="Note (optional)" value={v.note ?? ''} onChange={x => set({ note: x })} issues={issues} />}
              {open === 'refuse' && (
                <TextArea
                  id="pl-householdReason"
                  label="The household’s reason, in their words"
                  hint="Recorded as said. A manager reviews every refusal; this product draws no conclusion from it."
                  value={v.householdReason ?? ''}
                  onChange={x => set({ householdReason: x })}
                  issues={issues}
                />
              )}
              {open === 'check_in' && (
                <TextInput
                  id="pl-checkedInOn"
                  type="date"
                  className="max-w-xs"
                  label="Date they moved in"
                  value={v.checkedInOn ?? ''}
                  onChange={x => set({ checkedInOn: x })}
                  issues={issues}
                />
              )}
              {open === 'move_out' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    id="pl-movedOutOn"
                    type="date"
                    label="Date they moved out"
                    value={v.movedOutOn ?? ''}
                    onChange={x => set({ movedOutOn: x })}
                    issues={issues}
                  />
                  <Field id="pl-destination" label="Where they went" issues={issues}>
                    <select
                      {...fieldA11y('pl-destination', issues)}
                      className="input"
                      value={v.destination ?? ''}
                      onChange={e => set({ destination: e.target.value as MoveOutDestination })}
                    >
                      <option value="">Choose…</option>
                      {(Object.keys(DESTINATION_LABEL) as MoveOutDestination[]).map(k => (
                        <option key={k} value={k}>
                          {DESTINATION_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <TextInput id="pl-moveReason" label="Why they moved out" value={v.reason ?? ''} onChange={x => set({ reason: x })} issues={issues} />
                  {v.destination === 'other' && (
                    <TextInput
                      id="pl-destinationNote"
                      label="Where, in a few words"
                      value={v.destinationNote ?? ''}
                      onChange={x => set({ destinationNote: x })}
                      issues={issues}
                    />
                  )}
                </div>
              )}
              {open === 'cancel' && (
                <TextArea
                  id="pl-cancelReason"
                  label="Why the placement is cancelled"
                  value={v.reason ?? ''}
                  onChange={x => set({ reason: x })}
                  issues={issues}
                />
              )}
            </>
          )}
        </ActionForm>
      )}
    </div>
  )
}

/** "Placed out of hours, approval to follow". */
export function OutOfHours({ p }: { p: Placement }) {
  const { placeOutOfHours } = useApp()
  const user = useUser()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (p.approval.status !== 'awaiting' || !LIVE.includes(p.state)) return null
  const allowed = check(user, 'act_on_placement')
  if (!allowed.ok) return null
  if (!open)
    return (
      <div className="grid gap-1">
        <div>
          <button id="out-of-hours" type="button" className="btn" onClick={() => setOpen(true)}>
            Placed out of hours, approval to follow
          </button>
        </div>
        <p className="text-xs text-muted">
          Only for a household that cannot wait for a manager. It is shown prominently on this record and a manager must approve by 10:00 the next working day.
        </p>
      </div>
    )
  return (
    <ActionForm
      id="ooh-form"
      submitLabel="Go ahead, approval to follow"
      onCancel={() => setOpen(false)}
      validate={() => validateDeferral(p.approval, p, { reason })}
      onSubmit={async () => {
        await placeOutOfHours(p.seq, { reason })
        setOpen(false)
      }}
      intro="The provider confirmation, offer and move-in are unblocked now. An urgent task goes to the managers’ queue, due 10:00 the next working day."
    >
      {issues => (
        <TextArea
          id="ooh-reason"
          label="Why the household could not wait for a manager"
          hint={`At least ${DEFERRAL_MIN_CHARS} characters.`}
          value={reason}
          onChange={setReason}
          issues={issues}
        />
      )}
    </ActionForm>
  )
}

/** Change the planned end of a live stay. */
export function ExtendStay({ p }: { p: Placement }) {
  const { extendStay, occupancy } = useApp()
  const user = useUser()
  const [open, setOpen] = useState(false)
  const [newEnd, setNewEnd] = useState('')
  const [reason, setReason] = useState('')
  if (!LIVE.includes(p.state) || !check(user, 'act_on_placement').ok) return null
  if (!open)
    return (
      <button id="extend-stay" type="button" className="btn" onClick={() => (setOpen(true), setNewEnd(p.currentEnd))}>
        Change the planned end
      </button>
    )
  const clashes = /^\d{4}-\d{2}-\d{2}$/.test(newEnd) ? conflictsFor(occupancy, p.propertyId, p.checkedInOn ?? p.startDate, newEnd, p.seq) : []
  return (
    <ActionForm
      id="extend-form"
      submitLabel="Save the new end date"
      onCancel={() => setOpen(false)}
      validate={() =>
        validateExtension(
          p,
          { newEnd, reason },
          clashes.map(c => ({ message: occupancyMessage(c, p.caseRef) })),
        )
      }
      onSubmit={async () => {
        await extendStay(p.seq, { newEnd, reason })
        setOpen(false)
      }}
      intro="The store checks that nobody else holds the property for the new dates."
    >
      {issues => (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id="ext-newEnd" type="date" label="New planned end" value={newEnd} onChange={setNewEnd} issues={issues} />
          <TextInput id="ext-reason" label="Reason" value={reason} onChange={setReason} issues={issues} />
        </div>
      )}
    </ActionForm>
  )
}

// ---------- Approval ----------

export function ApprovalPanel({
  rec,
  approval,
  placement,
  showExceptions = true,
}: {
  rec: DecisionRecord
  approval: ApprovalView
  placement: Placement | null
  showExceptions?: boolean
}) {
  const { decideApproval } = useApp()
  const user = useUser()
  const [outcome, setOutcome] = useState<'approved' | 'rejected' | ''>('')
  const [reason, setReason] = useState('')
  const d = rec.snapshot.decision
  const decidedBy = 'decidedBy' in d ? d.decidedBy.userId : undefined
  const allowed = check(user, 'approve_exception', { decidedByUserId: decidedBy })
  if (approval.status === 'not_required') return null
  return (
    <div className="grid gap-3">
      {showExceptions && (
        <ul className="grid gap-1 text-sm">
          {approval.exceptions.map(x => (
            <li key={x} className="flex items-start gap-2">
              <Icon name="alert" size={15} className="mt-[3px] shrink-0 text-warn" />
              {EXCEPTION_LABEL[x]}
            </li>
          ))}
        </ul>
      )}
      {approval.status !== 'awaiting' && approval.status !== 'out_of_hours' && (
        <p className="text-sm">
          <b>{approval.status === 'approved' ? 'Approved' : 'Rejected'}</b> by {approval.decision.actor.name} ({approval.decision.actor.roleLabel.toLowerCase()}
          ), {formatDateTime(approval.decision.at)}: “{approval.decision.reason}”
        </p>
      )}
      {(approval.status === 'awaiting' || approval.status === 'out_of_hours') && !approvalPending(approval, placement) && (
        <p className="text-sm text-muted">Nothing left to approve: the placement is {STATE_LABEL[placement!.state].toLowerCase()}.</p>
      )}
      {approvalPending(approval, placement) &&
        (allowed.ok ? (
          <ActionForm
            id="approval-form"
            submitLabel="Record the approval decision"
            validate={() => validateApproval(approval, { outcome, reason }, placement)}
            onSubmit={() => decideApproval(rec.seq, { outcome: outcome || undefined, reason })}
          >
            {issues => (
              <>
                <fieldset className="grid gap-1.5" aria-describedby={issues.some(i => i.path === 'ap-outcome') ? 'ap-outcome-error' : undefined}>
                  <legend className="mb-1 text-[0.8rem] font-semibold text-muted">Your decision</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5">
                      <input id="ap-outcome" type="radio" name="ap-outcome" checked={outcome === 'approved'} onChange={() => setOutcome('approved')} />
                      Approve
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input id="ap-reject" type="radio" name="ap-outcome" checked={outcome === 'rejected'} onChange={() => setOutcome('rejected')} />
                      Reject{rec.snapshot.decision.chosenPropertyId ? ' (releases the hold)' : ''}
                    </label>
                  </div>
                  <FieldError id="ap-outcome" issues={issues} />
                </fieldset>
                <TextArea id="ap-reason" label="Your reasons" value={reason} onChange={setReason} issues={issues} />
              </>
            )}
          </ActionForm>
        ) : (
          <NotAllowed
            reason={
              allowed.reason === 'Nobody can approve their own decision.'
                ? 'You recorded this decision, so another manager must approve it.'
                : `${allowed.reason} A team manager or the head of service approves exceptions.`
            }
          />
        ))}
    </div>
  )
}

// ---------- Tasks ----------

const ESC_CHIP: Record<Task['escalation'], string> = { none: 'chip-plain', due_soon: 'chip-warn', overdue: 'chip-bad', escalated: 'chip-bad' }

export function TaskStatusChip({ t }: { t: Task }) {
  if (t.status === 'done') return <span className="chip chip-good">Done</span>
  if (t.status === 'cancelled') return <span className="chip chip-plain">Cancelled</span>
  return (
    <span className={`chip ${ESC_CHIP[t.escalation]}`}>
      {t.escalation === 'escalated' && t.escalatedTo
        ? `Escalated to ${ROLE_LABEL[t.escalatedTo].toLowerCase().replace(' (policy owner)', '')}`
        : ESCALATION_LABEL[t.escalation]}
    </span>
  )
}

const ownerKey = (o: TaskOwner) => (o.kind === 'user' ? `user:${o.userId}` : `role:${o.role}`)

/** A list of tasks with their actions. One form is open at a time, so field ids stay unique. */
export function TaskList({ tasks, showCase = true, empty: emptyText }: { tasks: Task[]; showCase?: boolean; empty: string }) {
  const { completeTask, reassignTask, cancelTask, now, data } = useApp()
  const { go } = useNav()
  const user = useUser()
  const [open, setOpen] = useState<{ id: string; mode: 'complete' | 'reassign' | 'cancel' } | null>(null)
  const [evidence, setEvidence] = useState('')
  const [reference, setReference] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const choices = taskOwnerChoices()
  if (tasks.length === 0) return <p className="px-4 py-4 text-sm text-muted sm:px-5">{emptyText}</p>
  const begin = (id: string, mode: 'complete' | 'reassign' | 'cancel') => {
    setOpen({ id, mode })
    setEvidence('')
    setReference('')
    setTo('')
    setNote('')
    setFlash(null)
  }
  const propLabel = (id?: string) => data.properties.find(p => p.id === id)?.label
  return (
    <ul className="divide-y divide-[var(--rule)]">
      {flash && (
        <li role="status" className="px-4 py-2 text-sm text-good sm:px-5">
          {flash}
        </li>
      )}
      {tasks.map(t => {
        const ownerCtx = t.owner.kind === 'user' ? { taskOwnerUserId: t.owner.userId } : { taskOwnerRole: t.owner.role }
        const canComplete = t.status === 'open' && t.closesBy !== 'approval' && check(user, 'complete_task', ownerCtx).ok
        const canReassign = t.status === 'open' && check(user, 'reassign_task').ok
        const canCancel = t.status === 'open' && t.closesBy !== 'approval' && check(user, 'cancel_task').ok
        const isOpen = open?.id === t.id
        return (
          <li key={t.id} className="grid gap-2 px-4 py-3 sm:px-5" data-task={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${t.status !== 'open' ? 'text-muted' : ''}`}>{t.title}</span>
                  {t.urgent && t.status === 'open' && <span className="chip chip-bad">Urgent</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>{TASK_KIND_LABEL[t.kind]}</span>
                  {showCase && t.seq !== undefined && (
                    <button className="link text-xs" onClick={() => go({ view: 'decision', seq: t.seq! })}>
                      Case {t.caseRef}
                    </button>
                  )}
                  {showCase && t.seq === undefined && t.propertyId && <span>{propLabel(t.propertyId)}</span>}
                  <span>Owner: {ownerLabel(t.owner)}</span>
                  <span className="num">
                    Due {formatDateTime(t.due)}
                    {t.status === 'open' ? ` · ${dueText(t, now)}` : ''}
                  </span>
                </div>
                {t.detail && <p className="mt-1 text-sm text-muted">{t.detail}</p>}
                {t.completion && (
                  <p className="mt-1 text-sm">
                    Done by {t.completion.actor.name}, {formatDateTime(t.completion.at)}: “{t.completion.evidence}” Reference {t.completion.reference}.
                  </p>
                )}
                {t.closedBy && <p className="mt-1 text-sm text-muted">{t.closedBy}.</p>}
                {t.cancellation && (
                  <p className="mt-1 text-sm text-muted">
                    Cancelled by {t.cancellation.actor.name}, {formatDateTime(t.cancellation.at)}: “{t.cancellation.reason}”
                  </p>
                )}
                {t.reassignments.length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Reassigned by {t.reassignments[t.reassignments.length - 1].actor.name}: “{t.reassignments[t.reassignments.length - 1].note}”
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <TaskStatusChip t={t} />
              </div>
            </div>
            {t.status === 'open' && (
              <div className="flex flex-wrap gap-2">
                {t.closesBy === 'approval' && t.seq !== undefined && showCase && (
                  <button className="btn btn-sm" onClick={() => go({ view: 'decision', seq: t.seq! })}>
                    Open the decision to approve or reject
                  </button>
                )}
                {canComplete && (
                  <button className="btn btn-sm" data-action="complete" onClick={() => begin(t.id, 'complete')}>
                    Mark done
                  </button>
                )}
                {canReassign && (
                  <button className="btn btn-sm" data-action="reassign" onClick={() => begin(t.id, 'reassign')}>
                    Reassign
                  </button>
                )}
                {canCancel && (
                  <button className="btn btn-sm btn-quiet" data-action="cancel" onClick={() => begin(t.id, 'cancel')}>
                    Cancel task
                  </button>
                )}
              </div>
            )}
            {isOpen && open.mode === 'complete' && (
              <ActionForm
                id="task-form"
                submitLabel="Mark done"
                onCancel={() => setOpen(null)}
                intro="Say what was done and where the evidence is. It is sealed with your name and the time."
                validate={() => validateCompletion({ evidence, reference })}
                onSubmit={async () => {
                  const r = await completeTask(t.id, { evidence, reference })
                  setOpen(null)
                  setFlash(`Task done. Sealed as record #${r.seq}.`)
                }}
              >
                {issues => (
                  <>
                    <TextArea id="task-evidence" label="What was done" value={evidence} onChange={setEvidence} issues={issues} />
                    <TextInput
                      id="task-reference"
                      label="Reference (document, email or call)"
                      value={reference}
                      onChange={setReference}
                      issues={issues}
                      className="max-w-sm"
                    />
                  </>
                )}
              </ActionForm>
            )}
            {isOpen && open.mode === 'reassign' && (
              <ActionForm
                id="task-form"
                submitLabel="Reassign"
                onCancel={() => setOpen(null)}
                validate={() => validateReassign(t, choices.find(c => ownerKey(c) === to) ?? null, note)}
                onSubmit={async () => {
                  await reassignTask(t.id, { to: choices.find(c => ownerKey(c) === to) ?? null, note })
                  setOpen(null)
                  setFlash('Task reassigned.')
                }}
              >
                {issues => (
                  <>
                    <Field id="task-to" label="Give it to" issues={issues} className="max-w-sm">
                      <select {...fieldA11y('task-to', issues)} className="input" value={to} onChange={e => setTo(e.target.value)}>
                        <option value="">Choose…</option>
                        {choices.map(c => (
                          <option key={ownerKey(c)} value={ownerKey(c)}>
                            {c.kind === 'user' ? `${c.name} (${ROLE_LABEL[c.role].toLowerCase()})` : ownerLabel(c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <TextArea id="task-note" label="Note for the new owner" value={note} onChange={setNote} issues={issues} />
                  </>
                )}
              </ActionForm>
            )}
            {isOpen && open.mode === 'cancel' && (
              <ActionForm
                id="task-form"
                submitLabel="Cancel the task"
                onCancel={() => setOpen(null)}
                validate={() => validateCancel(note)}
                onSubmit={async () => {
                  await cancelTask(t.id, { reason: note })
                  setOpen(null)
                  setFlash('Task cancelled.')
                }}
              >
                {issues => <TextArea id="task-cancelReason" label="Why it is no longer needed" value={note} onChange={setNote} issues={issues} />}
              </ActionForm>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** The plain statement every task screen carries: there is no email yet. */
export function InAppOnly() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <Icon name="alert" size={15} className="mt-[3px] shrink-0" />
      <span>
        Reminders are in this app only: the counts in the menu, and tasks turning “due soon”, “overdue” and “escalated”. Nobody is emailed yet; that needs the
        hosted service.
      </span>
    </p>
  )
}

// ---------- History ----------

/** The decision, then every later record about it, in order. */
export function PlacementHistory({ rec, events }: { rec: DecisionRecord; events: ChainRecord<PlacementEvent>[] }) {
  const d = rec.snapshot.decision
  const decider = 'decidedBy' in d ? d.decidedBy.name : d.officer
  return (
    <ol className="grid gap-3">
      <li className="grid grid-cols-[3.2rem_1fr] gap-2 text-sm">
        <span className="num font-semibold text-accent">#{rec.seq}</span>
        <span>
          <span className="text-muted">
            {formatDateTime(d.decidedAt)} · {decider}
          </span>
          <span className="block">Decision recorded{d.chosenPropertyId ? '; the property is held' : ''}.</span>
        </span>
      </li>
      {events.map(e => (
        <li key={e.seq} className="grid grid-cols-[3.2rem_1fr] gap-2 text-sm">
          <span className="num font-semibold text-accent">#{e.seq}</span>
          <span>
            <span className="text-muted">
              {formatDateTime(e.snapshot.at)} · {e.snapshot.actor.name}
            </span>
            <span className="block">{describeEvent(e.snapshot)}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
