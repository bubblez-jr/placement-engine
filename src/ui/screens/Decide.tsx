import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/app'
import { subsidyFor } from '../provenance'
import { useNav } from '../../store/nav'
import { useUser } from '../../auth/session'
import { addDays, formatDate, formatDateTime } from '../../engine/dates'
import {
  EMERGENCY_REASON_LABEL,
  exceptionsFor,
  hasChildren,
  MOVE_ON_ROUTE_LABEL,
  sixWeekRuleApplies,
  validateDecision,
  type ConsentInput,
  type DecisionInput,
} from '../../engine/decision'
import { conflictsFor, occupancyMessage, OccupancyConflictError } from '../../engine/occupancy'
import { bnbLimitDays, EXCEPTION_LABEL, placementPolicyOf } from '../../engine/policy'
import { placementOwners } from '../../store/commands'
import { Icon } from '../icons'
import { check, ROLE_LABEL } from '../../engine/permissions'
import { ValidationError } from '../../engine/validate'
import type { EmergencyReason, Issue, MoveOnRoute, OverrideReason } from '../../engine/types'
import { decisionRecords } from '../../audit/records'
import { ErrorSummary, Field, FieldError, fieldA11y, gbp, NotAllowed, PageHeader, Section, TierTag } from '../bits'
import { ConsentFields } from '../consent'

export const OVERRIDE_REASONS: [OverrideReason, string][] = [
  ['household_preference', 'Household’s informed preference'],
  ['information_not_in_system', 'Information not in the system'],
  ['supplier_unavailable', 'Supplier could not confirm on the phone'],
  ['safeguarding_advice', 'Safeguarding advice'],
  ['reasonable_adjustment', 'Reasonable adjustment (Equality Act)'],
  ['manager_instruction', 'Manager’s instruction'],
  ['other', 'Other'],
]

export function Decide({ searchId, propertyId }: { searchId: string; propertyId?: string }) {
  const { getSearch, decide, review, data, occupancy, search: runAgain } = useApp()
  const user = useUser()
  const { go } = useNav()
  const s = getSearch(searchId)
  const [choice, setChoice] = useState<string | null>(propertyId ?? s?.recommendedId ?? null)
  const [reason, setReason] = useState<OverrideReason | ''>('')
  const [text, setText] = useState('')
  const [startDate, setStartDate] = useState(s?.household.needFrom ?? '')
  const [consent, setConsent] = useState<ConsentInput>({})
  const [emergency, setEmergency] = useState<NonNullable<DecisionInput['emergency']>>({})
  const [plan, setPlan] = useState<NonNullable<DecisionInput['moveOnPlan']>>({})
  const [conflict, setConflict] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [focusSummary, setFocusSummary] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusSummary) summaryRef.current?.focus()
  }, [focusSummary])

  const eligible = s ? s.candidates.filter(c => c.eligible) : []
  const subsidy = s ? subsidyFor(s, data.rulesets) : null
  const noneSuitable = eligible.length === 0
  const isOverride = !noneSuitable && choice !== s?.recommendedId
  const input: DecisionInput = {
    outcome: noneSuitable ? 'no_suitable' : isOverride ? 'override' : 'accepted',
    chosenPropertyId: noneSuitable ? null : choice,
    overrideReason: isOverride && reason ? reason : undefined,
    reasonText: text,
    startDate,
    confirmedFullListReviewed: confirmed,
    consent,
    emergency,
    moveOnPlan: plan,
  }
  const rs = s ? (data.rulesets.find(x => x.hash === s.rulesetHash) ?? data.rulesets[data.rulesets.length - 1]) : null
  const chosenProp = data.properties.find(p => p.id === input.chosenPropertyId)
  const owners = placementOwners()
  const allIssues = s && rs ? validateDecision(s, input, { property: chosenProp, ruleset: rs, owners }) : []
  if (!s) return <p>Search not found.</p>
  const issues: Issue[] = showErrors ? allIssues : []
  const decided = decisionRecords(data.chain).find(r => r.snapshot.search.id === s.id)
  const allowed = check(user, 'record_decision')

  const sorted = [...eligible].sort((a, b) => (a.propertyId === s.recommendedId ? -1 : b.propertyId === s.recommendedId ? 1 : (a.rank ?? 0) - (b.rank ?? 0)))
  const rejectedCount = s.candidates.length - eligible.length
  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
  const children = hasChildren(s.household)
  const r = review(searchId)
  const exceptions = rs ? exceptionsFor(s, input, chosenProp, rs) : []
  const sixWeek = !noneSuitable && sixWeekRuleApplies(s.household, chosenProp)
  const limit = rs ? bnbLimitDays(rs) : 42
  const holdHours = rs ? placementPolicyOf(rs).holdHours : 24
  const takenNow =
    !noneSuitable && choice && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? conflictsFor(occupancy, choice, startDate, addDays(startDate, s.household.expectedNights))
      : []
  async function searchAgain() {
    try {
      const fresh = await runAgain(s!.household)
      go({ view: 'results', searchId: fresh.id })
    } catch {
      go({ view: 'new', fromSearchId: s!.id })
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (allIssues.some(i => i.severity === 'error')) {
      setShowErrors(true)
      setFocusSummary(n => n + 1)
      return
    }
    setBusy(true)
    try {
      const rec2 = await decide(searchId, input)
      go({ view: 'decision', seq: rec2.seq })
    } catch (err) {
      if (err instanceof ValidationError) {
        setShowErrors(true)
        setFocusSummary(n => n + 1)
      } else if (err instanceof OccupancyConflictError) setConflict(err.message)
      else setError(`The decision could not be saved: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  if (decided)
    return (
      <div className="grid gap-4">
        <PageHeader eyebrow={`Case ${s.household.caseRef} · decision`} title="Already decided">
          This search was decided in record #{decided.seq}. A sealed decision is not recorded twice; later facts are added to it as new records.
        </PageHeader>
        <div>
          <button className="btn btn-primary" onClick={() => go({ view: 'decision', seq: decided.seq })}>
            Open record #{decided.seq}
          </button>
        </div>
      </div>
    )

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <PageHeader eyebrow={`Case ${s.household.caseRef} · decision`} title="Record the placement decision">
        The engine recommends; you decide. What you reviewed and your reasons are sealed into the record with the evidence.
      </PageHeader>

      {!allowed.ok && <NotAllowed reason={allowed.reason} className="callout" />}
      {showErrors && <ErrorSummary ref={summaryRef} issues={issues} />}

      {noneSuitable ? (
        <Section title="No suitable option">
          <p className="mb-3">No property passed every check. Record the search steps you took: the council has to be able to show what it did.</p>
          <Field id="steps" label="Search steps taken" issues={issues}>
            <textarea
              {...fieldA11y('steps', issues)}
              className="input min-h-24"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="For example: rang four approved suppliers at 23:10 to 23:40; checked the DPS for same-night availability; escalated to the duty manager."
            />
          </Field>
        </Section>
      ) : (
        <Section title="Placement">
          <fieldset className="grid gap-2" id="choice" tabIndex={-1} aria-describedby={issues.some(i => i.path === 'choice') ? 'choice-error' : undefined}>
            <legend className="sr-only">Choose the placement</legend>
            {sorted.map(c => (
              <label
                key={c.propertyId}
                className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border p-3 ${choice === c.propertyId ? 'border-accent bg-accent-soft' : 'border-rule'}`}
              >
                <input id={`choice-${c.propertyId}`} type="radio" name="choice" checked={choice === c.propertyId} onChange={() => setChoice(c.propertyId)} />
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{c.label}</span> {c.propertyId === s.recommendedId && <span className="chip chip-accent">Recommended</span>}
                  <span className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                    <TierTag tier={c.tier} district={c.district} /> Suitability {c.score} · TA budget {gbp(c.cost.taNetPerNight, 2)}/night after subsidy (
                    {subsidy?.status === 'official' ? 'official table' : 'illustrative figures'})
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <FieldError id="choice" issues={issues} />
          {isOverride ? (
            <div className="mt-4 grid gap-3 rounded-lg border border-warn bg-warn-soft p-3">
              <div className="font-bold text-warn">You are choosing a different option from the recommendation ({rec?.label}).</div>
              <Field id="reason" label="Reason" issues={issues} className="max-w-sm">
                <select {...fieldA11y('reason', issues)} className="input" value={reason} onChange={e => setReason(e.target.value as OverrideReason)}>
                  <option value="">Choose a reason</option>
                  {OVERRIDE_REASONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="reasonText" label="Explain in your own words" issues={issues}>
                <textarea
                  {...fieldA11y('reasonText', issues)}
                  className="input min-h-20"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Reviews look at reasons, not scores. Say what you knew and why it outweighed the recommendation."
                />
              </Field>
            </div>
          ) : (
            <label className="field mt-4">
              <span>Note (optional)</span>
              <textarea
                id="note"
                className="input min-h-16"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Anything else the record should show."
              />
            </label>
          )}
          <Field id="startDate" label="Placement starts" issues={issues} className="mt-4 max-w-xs">
            <input {...fieldA11y('startDate', issues)} type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </Field>
        </Section>
      )}

      {!noneSuitable && children && (
        <Section
          id="consent"
          title="Consent to tell the children’s school, GP and health visitor"
          description="Ask a parent. Record what they said, or why you have not asked yet. Nothing is filled in for you."
        >
          <ConsentFields household={s.household} value={consent} onChange={setConsent} issues={issues} />
        </Section>
      )}

      {sixWeek && (
        <Section
          id="six-week"
          title="Family in B&B or shared accommodation"
          description={`The law allows a family no more than ${limit / 7} weeks here. Record why there is no alternative tonight, and who will move them on, by when.`}
        >
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="emergency-reasonCode" label="Why shared accommodation" issues={issues}>
                <select
                  {...fieldA11y('emergency-reasonCode', issues)}
                  className="input"
                  value={emergency.reasonCode ?? ''}
                  onChange={e => setEmergency(x => ({ ...x, reasonCode: e.target.value as EmergencyReason }))}
                >
                  <option value="">Choose a reason</option>
                  {(Object.keys(EMERGENCY_REASON_LABEL) as EmergencyReason[]).map(k => (
                    <option key={k} value={k}>
                      {EMERGENCY_REASON_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="moveon-owner" label="Who owns the move-on plan" issues={issues}>
                <select
                  {...fieldA11y('moveon-owner', issues)}
                  className="input"
                  value={plan.ownerUserId ?? ''}
                  onChange={e => setPlan(x => ({ ...x, ownerUserId: e.target.value }))}
                >
                  <option value="">Choose a named person</option>
                  {owners.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({ROLE_LABEL[o.role].toLowerCase()})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="emergency-reasonText" label="The emergency, in your own words" issues={issues}>
              <textarea
                {...fieldA11y('emergency-reasonText', issues)}
                className="input min-h-16"
                value={emergency.reasonText ?? ''}
                onChange={e => setEmergency(x => ({ ...x, reasonText: e.target.value }))}
                placeholder="For example: excluded by family at 23:00; rang every approved supplier; nothing self-contained free tonight."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="moveon-targetDate"
                label="Move on by"
                hint={/^\d{4}-\d{2}-\d{2}$/.test(startDate) ? `No later than ${formatDate(addDays(startDate, limit))}.` : undefined}
                issues={issues}
              >
                <input
                  {...fieldA11y('moveon-targetDate', issues, 'moveon-targetDate-hint')}
                  type="date"
                  className="input"
                  value={plan.targetDate ?? ''}
                  onChange={e => setPlan(x => ({ ...x, targetDate: e.target.value }))}
                />
              </Field>
              <Field id="moveon-route" label="Route being pursued" issues={issues}>
                <select
                  {...fieldA11y('moveon-route', issues)}
                  className="input"
                  value={plan.route ?? ''}
                  onChange={e => setPlan(x => ({ ...x, route: e.target.value as MoveOnRoute }))}
                >
                  <option value="">Choose a route</option>
                  {(Object.keys(MOVE_ON_ROUTE_LABEL) as MoveOnRoute[]).map(k => (
                    <option key={k} value={k}>
                      {MOVE_ON_ROUTE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {plan.route === 'other' && (
              <Field id="moveon-routeNote" label="Describe the route" issues={issues}>
                <input
                  {...fieldA11y('moveon-routeNote', issues)}
                  className="input"
                  value={plan.routeNote ?? ''}
                  onChange={e => setPlan(x => ({ ...x, routeNote: e.target.value }))}
                />
              </Field>
            )}
            <p className="text-sm text-muted">
              Weekly move-on reviews go to the plan’s owner; the team manager is brought in on day 28, it turns urgent on day 35, and the head of service is
              told on day {limit}. These are in-app tasks: nobody is emailed yet.
            </p>
          </div>
        </Section>
      )}

      {exceptions.length > 0 && (
        <div className="callout border-warn bg-warn-soft" id="exceptions" role="status">
          <div className="flex items-center gap-2 font-semibold text-warn">
            <Icon name="stamp" size={17} />
            This decision needs a manager’s approval
          </div>
          <ul className="mt-1.5 grid gap-0.5 pl-6 text-sm">
            {exceptions.map(x => (
              <li key={x} className="list-disc">
                {EXCEPTION_LABEL[x]}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sm">
            {noneSuitable
              ? 'It goes to the managers’ approval queue when you record it.'
              : `The property is held for ${holdHours} hours while a manager decides. Provider confirmation, the offer and move-in wait for approval, unless the household cannot wait: then use “Placed out of hours, approval to follow” on the record.`}
          </p>
        </div>
      )}

      {(takenNow.length > 0 || conflict) && (
        <div className="callout border-bad bg-bad-soft" role="alert" id="taken">
          <div className="font-semibold text-bad">This property was taken after the search ran</div>
          <p className="mt-1 text-sm">
            {conflict ??
              `${takenNow.map(c => occupancyMessage(c, s.household.caseRef)).join('; ')}. Choose another option, or run the search again to see what is free now.`}
          </p>
          <button type="button" className="btn mt-2" id="search-again" onClick={searchAgain}>
            Run the search again
          </button>
        </div>
      )}

      <Section title="Your review">
        <ul className="mb-3 grid gap-1 text-sm text-muted">
          <li>Opened the full list of options at {formatDateTime(r.resultsOpenedAt)}</li>
          <li>
            Property details opened:{' '}
            {r.propertiesOpened.length === 0 ? 'none' : r.propertiesOpened.map(id => s.candidates.find(c => c.propertyId === id)?.label ?? id).join(', ')}
          </li>
          <li>Comparison opened: {r.comparisonOpened ? 'yes' : 'no'}</li>
        </ul>
        <p className="mb-3 text-sm">
          The record will show this decision as made by <b>{user.name}</b>, {ROLE_LABEL[user.role].toLowerCase()}, the person signed in.
        </p>
        <label className="flex items-start gap-2">
          <input {...fieldA11y('confirm', issues)} className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          <span>
            I have reviewed the {eligible.length} eligible option{eligible.length === 1 ? '' : 's'} and the {rejectedCount} ruled out, and this decision is
            mine.
          </span>
        </label>
        <div className="mt-1">
          <FieldError id="confirm" issues={issues} />
        </div>
      </Section>

      {error && (
        <p role="alert" className="rounded-md border border-bad bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || !allowed.ok} aria-describedby={!allowed.ok ? 'decide-not-allowed' : undefined}>
          {busy ? 'Sealing the record…' : 'Record decision'}
        </button>
        <button type="button" className="btn" onClick={() => go({ view: 'results', searchId })}>
          Back to options
        </button>
        {!allowed.ok && (
          <span id="decide-not-allowed" className="text-sm text-muted">
            {allowed.reason}
          </span>
        )}
      </div>
    </form>
  )
}
