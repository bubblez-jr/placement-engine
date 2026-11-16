import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { useUser } from '../../auth/session'
import { daysBetween, formatDate, formatDateTime, formatUkTimeOn, ukDate } from '../../engine/dates'
import { hasChildren, validateConsent, type ConsentInput } from '../../engine/decision'
import { check } from '../../engine/permissions'
import { ValidationError } from '../../engine/validate'
import type { Issue } from '../../engine/types'
import { shortHash } from '../../audit/hash'
import {
  approvalOf,
  clocksNow,
  consentAtDecision as consentAtDecisionOf,
  currentConsent,
  decisionRecords,
  deciderOf,
  eventsAbout,
  isSeeded,
  type ConsentView,
} from '../../audit/records'
import {
  ApprovalChip,
  ApprovalPanel,
  ExtendStay,
  holdText,
  MoveOnPlanView,
  OutOfHours,
  PlacementActions,
  PlacementHistory,
  SharedStayCounter,
  StateChip,
  Stepper,
  TaskList,
} from '../placement'
import { OVERRIDE_REASONS } from './Decide'
import { ErrorSummary, NotAllowed, PageHeader, Section } from '../bits'
import { Icon } from '../icons'
import { ConsentFields, ConsentText } from '../consent'

function CopyBox({ id, text }: { id: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')
  return (
    <div className="grid gap-2">
      <textarea id={id} readOnly className="input hash min-h-48 !text-[0.82rem] leading-relaxed" value={text} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn"
          onClick={async e => {
            const ta = (e.currentTarget.parentElement?.previousElementSibling as HTMLTextAreaElement) ?? null
            try {
              await navigator.clipboard.writeText(text)
              setState('copied')
            } catch {
              ta?.select()
              setState('select')
            }
          }}
        >
          Copy text
        </button>
        {state === 'copied' && <span className="text-sm text-good">Copied</span>}
        {state === 'select' && <span className="text-sm text-muted">Text selected: press Ctrl+C or ⌘C to copy</span>}
      </div>
    </div>
  )
}

/** Whether the s213AA notice can be drafted, from consent as it stands now. */
function noticeBlockedBy(v: ConsentView): string | null {
  if (v.kind === 'record' && v.consent.status === 'given') return null
  if (v.kind === 'legacy' && v.consented) return null
  if (v.kind === 'record' && v.consent.status === 'refused') return `Consent was refused by ${v.consent.givenBy}, so no notice is drafted.`
  if (v.kind === 'legacy') return 'No notice is drafted. Ask a parent and record what they say below: the notice is drafted if they agree.'
  return 'Consent has not been asked yet. Record it below once you have asked, and the notice is drafted if they agree.'
}

function UpdateConsent({ seq, household }: { seq: number; household: Parameters<typeof ConsentFields>[0]['household'] }) {
  const { updateConsent } = useApp()
  const user = useUser()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<ConsentInput>({})
  const [issues, setIssues] = useState<Issue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState(0)
  useEffect(() => {
    if (focus) summaryRef.current?.focus()
  }, [focus])
  const allowed = check(user, 'record_consent')
  if (!allowed.ok) return <NotAllowed reason={allowed.reason} className="mt-3" />
  if (!open)
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button id="update-consent" type="button" className="btn" onClick={() => setOpen(true)}>
          Record a change to consent
        </button>
        {done && <span className="text-sm text-good">Saved as record #{done}. The decision record is unchanged.</span>}
      </div>
    )
  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border border-rule p-3 sm:p-4"
      noValidate
      onSubmit={async e => {
        e.preventDefault()
        setError(null)
        const found = validateConsent(value, household)
        setIssues(found)
        if (found.length) return setFocus(n => n + 1)
        setBusy(true)
        try {
          const rec = await updateConsent(seq, value)
          setDone(rec.seq)
          setOpen(false)
          setValue({})
        } catch (err) {
          if (err instanceof ValidationError) {
            setIssues(err.issues)
            setFocus(n => n + 1)
          } else setError((err as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <p className="text-sm text-muted">This adds a new sealed record that points to this decision. The decision itself is never edited.</p>
      <ErrorSummary ref={summaryRef} issues={issues} />
      <ConsentFields
        household={household}
        value={value}
        onChange={v => (setValue(v), issues.length && setIssues(validateConsent(v, household)))}
        issues={issues}
      />
      {error && (
        <p role="alert" className="text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sealing…' : 'Save consent'}
        </button>
        <button type="button" className="btn" onClick={() => (setOpen(false), setIssues([]))}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function DecisionRecord({ seq }: { seq: number }) {
  const { data, now, placements, tasks } = useApp()
  const { go } = useNav()
  const r = decisionRecords(data.chain).find(x => x.seq === seq)
  if (!r) return <p>Decision #{seq} not found.</p>
  const placement = placements.find(x => x.seq === seq) ?? null
  const approval = placement?.approval ?? approvalOf(data.chain, r)
  const myTasks = tasks.filter(t => t.seq === seq)
  const later = eventsAbout(data.chain, seq)
  const { search, decision: d, ruleset, properties } = r.snapshot
  const clocks = clocksNow(data.chain, r)
  const by = deciderOf(r.snapshot)
  const consent = currentConsent(data.chain, r)
  const consentApplies = !!d.chosenPropertyId && hasChildren(search.household)
  const chosen = search.candidates.find(c => c.propertyId === d.chosenPropertyId)
  const prop = properties.find(p => p.id === d.chosenPropertyId)
  const rec = search.candidates.find(c => c.propertyId === search.recommendedId)
  const today = ukDate(now)
  const adults = search.household.members.filter(m => m.role === 'adult')
  const children = search.household.members.filter(m => m.role === 'child')

  const s208 =
    prop && clocks.some(c => c.key === 's208')
      ? `To: Housing Department, ${prop.district} Council
Notice under section 208 of the Housing Act 1996

${ruleset.councilName} has secured accommodation under Part 7 of the Housing Act 1996 for the household below, in your district.

Applicant: [name from the case system]
Household: ${adults.length} adult${adults.length === 1 ? '' : 's'}${children.length ? ` and ${children.length} child${children.length === 1 ? '' : 'ren'} (ages ${children.map(c => c.age).join(', ')})` : ''}
Address: ${prop.address}
Accommodation made available from: ${formatDate(d.startDate)}
Function: interim / main housing duty (confirm from the case)
Our reference: ${search.household.caseRef}

Contact: ${by.name}, ${by.roleLabel}, ${ruleset.councilName}`
      : null

  const blocked = noticeBlockedBy(consent.now)
  const s213 =
    prop && consentApplies && !blocked
      ? `To: the children's school(s), GP practice and health visitor
Notification of a temporary accommodation placement (Housing Act 1996 s213AA)

With the parent's consent${consent.now.kind === 'record' ? ` (${consent.now.consent.givenBy}, recorded ${formatDate(consent.now.consent.recordedAt)})` : ''}, ${ruleset.councilName} tells you that the family has been placed in temporary accommodation from ${formatDate(d.startDate)}.
Schools: ${[...new Set(search.household.destinations.filter(x => x.kind === 'school').map(x => x.name))].join('; ') || 'none recorded'}
New address: ${prop.address}
Our reference: ${search.household.caseRef}
Contact: ${by.name}, ${ruleset.councilName}`
      : null

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={`Decision record #${r.seq} · sealed ${formatDateTime(r.snapshot.frozenAt)}`}
        title={chosen ? `Placement: ${chosen.label}` : 'No suitable option recorded'}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => go({ view: 'report', seq })}>
              Open the audit pack
            </button>
            <button className="btn" onClick={() => go({ view: 'home' })}>
              All placements
            </button>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          <span>
            Case {search.household.caseRef}
            {prop ? ` · ${prop.address}` : ''}
          </span>
          {placement && <StateChip state={placement.state} />}
          <ApprovalChip a={approval} />
          {isSeeded(r) && <span className="chip chip-outline">Seeded demo history</span>}
        </span>
      </PageHeader>

      {approval.status === 'out_of_hours' && (
        <div className="callout border-bad bg-bad-soft" role="status" id="ooh-banner">
          <div className="flex items-center gap-2 font-semibold text-bad">
            <Icon name="alert" size={17} />
            Placed out of hours, approval to follow
          </div>
          <p className="mt-1 text-sm">
            {approval.deferral.actor.name} went ahead without a manager’s approval at {formatDateTime(approval.deferral.at)}: “{approval.deferral.reason}”. A
            manager must approve or reject by {formatUkTimeOn(approval.deferral.approveBy)}.
            {approval.deferral.duringWorkingHours && <b> This route was used during working hours.</b>}
          </p>
        </div>
      )}
      {approval.status !== 'out_of_hours' && approval.status !== 'not_required' && 'deferral' in approval && approval.deferral && (
        <p className="callout text-sm">
          Placed out of hours, approval to follow ({approval.deferral.actor.name}, {formatDateTime(approval.deferral.at)}: “{approval.deferral.reason}”). Then{' '}
          {approval.status} by {approval.decision.actor.name}, {formatDateTime(approval.decision.at)}.
        </p>
      )}

      {placement && (
        <Section
          title="Placement"
          id="placement"
          aside={
            <span className="num text-sm">
              {placement.state === 'held' ? holdText(placement, now) : `Planned ${formatDate(placement.startDate)} to ${formatDate(placement.currentEnd)}`}
            </span>
          }
        >
          <div className="grid gap-4">
            {placement.legacy && (
              <p className="callout text-sm">
                Recorded before placements were tracked. Its hold is read from the decision time under the default policy (
                {Math.round((new Date(placement.holdUntil).getTime() - new Date(placement.decidedAt).getTime()) / 3_600_000)} hours), with no exceptions
                recorded. The sealed record is unchanged.
              </p>
            )}
            <Stepper p={placement} />
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">Next step</h3>
              <PlacementActions p={placement} />
            </div>
            <OutOfHours p={placement} />
            {placement.extensions.length > 0 && (
              <p className="text-sm text-muted">
                Planned end changed {placement.extensions.length} time{placement.extensions.length === 1 ? '' : 's'}; first planned for{' '}
                {formatDate(placement.plannedEnd)}.
              </p>
            )}
            <div>
              <ExtendStay p={placement} />
            </div>
          </div>
        </Section>
      )}

      {approval.status !== 'not_required' && (
        <Section
          title="Manager approval"
          id="approval"
          description="This decision raised exceptions that a manager or the head of service must approve. The deciding officer cannot approve it."
        >
          <ApprovalPanel rec={r} approval={approval} />
        </Section>
      )}

      {placement?.sixWeekRule && (
        <Section title="Family in shared accommodation" id="shared" description="Families may stay in B&B or shared accommodation for no more than six weeks.">
          <div className="grid gap-4">
            <SharedStayCounter p={placement} now={now} />
            <MoveOnPlanView p={placement} />
          </div>
        </Section>
      )}

      <Section title={`Tasks (${myTasks.filter(t => t.status === 'open').length} open)`} id="tasks" flush>
        <TaskList tasks={myTasks} showCase={false} empty="No tasks for this decision." />
      </Section>

      <Section title="Decision">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="eyebrow">Outcome</dt>
            <dd className="mt-1">
              {d.outcome === 'accepted' ? (
                <span className="chip chip-good">Recommendation accepted</span>
              ) : d.outcome === 'override' ? (
                <span className="chip chip-warn">Officer chose another option</span>
              ) : (
                <span className="chip chip-bad">No suitable option</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Decided by</dt>
            <dd className="mt-1">
              {by.name}, {by.roleLabel}
              {!by.signedIn && <span className="block text-xs text-muted">Name typed on the form (earlier version, before sign-in)</span>}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">When</dt>
            <dd className="num mt-1">{formatDateTime(d.decidedAt)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Starts</dt>
            <dd className="num mt-1">{chosen ? formatDate(d.startDate) : '—'}</dd>
          </div>
        </dl>
        {d.outcome === 'override' && (
          <p className="mt-4 rounded-md bg-warn-soft p-3">
            <b>Recommended was {rec?.label}.</b> Reason: {OVERRIDE_REASONS.find(([k]) => k === d.overrideReason)?.[1]}. “{d.reasonText}”
          </p>
        )}
        {d.outcome !== 'override' && d.reasonText && <p className="mt-4 rounded-md bg-sunken p-3">“{d.reasonText}”</p>}
      </Section>

      {clocks.length > 0 && (
        <Section title="Deadlines this placement starts">
          <div className="scroll-x">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Action</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {clocks.map(c => {
                  const days = daysBetween(today, c.due)
                  return (
                    <tr key={c.key}>
                      <td className="num whitespace-nowrap">
                        {formatDate(c.due)}
                        {c.status === 'done' ? (
                          <div className="text-xs text-good">No longer needed</div>
                        ) : (
                          <div className={`text-xs ${days < 0 && c.key !== 's202' ? 'text-bad' : days <= 3 && days >= 0 ? 'text-warn' : 'text-muted'}`}>
                            {c.key === 's202' && days < 0 ? 'window closed' : days < 0 ? `${-days} days overdue` : days === 0 ? 'today' : `in ${days} days`}
                          </div>
                        )}
                      </td>
                      <td>
                        {c.status === 'done' ? <s className="text-muted">{c.label}</s> : c.label}
                        {c.status === 'done' && <span className="chip chip-good ml-2">Done</span>}
                      </td>
                      <td className="text-sm text-muted">{c.basis}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {consentApplies && (
        <Section title="Consent to notify school, GP and health visitor" id="consent">
          <ConsentText view={consent.now} />
          {consent.updates.length > 0 && (
            <ul className="mt-3 grid gap-1 border-t border-rule pt-3 text-sm text-muted">
              {consent.updates.map(u => (
                <li key={u.seq}>
                  Record #{u.seq}: changed by {u.consent.recordedBy.name}, {formatDateTime(u.consent.recordedAt)}
                </li>
              ))}
              <li>At the decision: {d.chosenPropertyId ? <ConsentText view={consentAtDecisionOf(r.snapshot)} /> : null}</li>
            </ul>
          )}
          {blocked && <p className="mt-3 rounded-md bg-sunken p-3 text-sm">{blocked}</p>}
          <UpdateConsent seq={r.seq} household={search.household} />
        </Section>
      )}

      {(s208 || s213) && (
        <div className="grid gap-5 xl:grid-cols-2">
          {s208 && (
            <Section title={`Draft notice to ${prop!.district}`}>
              <CopyBox id="s208" text={s208} />
            </Section>
          )}
          {s213 && (
            <Section title="Draft notification to school, GP and health visitor">
              <CopyBox id="s213" text={s213} />
            </Section>
          )}
        </div>
      )}

      <Section
        title="History"
        id="history"
        description="Every record about this decision, in order. Each is sealed in the chain; the decision itself is never edited."
      >
        <PlacementHistory rec={r} events={later} />
      </Section>

      <Section title="Seal">
        <dl className="grid gap-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 text-muted">Record hash</dt>
            <dd className="hash break-all">{r.rowHash}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 text-muted">Links to previous</dt>
            <dd className="hash break-all">{r.prevHash}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 text-muted">Policy</dt>
            <dd>
              v{ruleset.version} <span className="hash">{shortHash(ruleset.hash!)}</span>
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  )
}
