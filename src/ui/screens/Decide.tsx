import { useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDateTime } from '../../engine/dates'
import type { OverrideReason } from '../../engine/types'
import { gbp, PageHeader, Section, TierChip } from '../bits'

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
  const { getSearch, decide, officer, setOfficer, review } = useApp()
  const { go } = useNav()
  const s = getSearch(searchId)
  const [choice, setChoice] = useState<string | null>(propertyId ?? s?.recommendedId ?? null)
  const [reason, setReason] = useState<OverrideReason>('household_preference')
  const [text, setText] = useState('')
  const [startDate, setStartDate] = useState(s?.household.needFrom ?? '')
  const [consent, setConsent] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [name, setName] = useState(officer.name)
  const [role, setRole] = useState(officer.role)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!s) return <p>Search not found.</p>

  const eligible = s.candidates
    .filter(c => c.eligible)
    .sort((a, b) => (a.propertyId === s.recommendedId ? -1 : b.propertyId === s.recommendedId ? 1 : (a.rank ?? 0) - (b.rank ?? 0)))
  const rejectedCount = s.candidates.length - eligible.length
  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
  const noneSuitable = eligible.length === 0
  const isOverride = !noneSuitable && choice !== s.recommendedId
  const hasChildren = s.household.members.some(m => m.role === 'child')
  const r = review(searchId)
  const minText = noneSuitable ? 30 : isOverride ? 20 : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Enter your name: the record shows who made the decision.')
    if (text.trim().length < minText)
      return setError(
        noneSuitable
          ? 'Describe the search steps taken (at least 30 characters).'
          : `Give the reason for choosing this option over ${rec?.label} (at least 20 characters).`,
      )
    if (!confirmed) return setError('Confirm that you reviewed the options before recording the decision.')
    setBusy(true)
    try {
      setOfficer({ name, role })
      const rec2 = await decide(searchId, {
        outcome: noneSuitable ? 'no_suitable' : isOverride ? 'override' : 'accepted',
        chosenPropertyId: noneSuitable ? null : choice,
        overrideReason: isOverride ? reason : undefined,
        reasonText: text.trim(),
        officer: name.trim(),
        officerRole: role.trim(),
        startDate,
        consentToNotifyServices: hasChildren && consent,
        confirmedFullListReviewed: confirmed,
      })
      go({ view: 'decision', seq: rec2.seq })
    } catch (err) {
      setError(`The decision could not be saved: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <PageHeader eyebrow={`Case ${s.household.caseRef} · decision`} title="Record the placement decision">
        The engine recommends; you decide. What you reviewed and your reasons are sealed into the record with the evidence.
      </PageHeader>

      {noneSuitable ? (
        <Section title="No suitable option">
          <p className="mb-3">No property passed every check. Record the search steps you took: the council has to be able to show what it did.</p>
          <label className="field">
            <span>Search steps taken</span>
            <textarea
              id="steps"
              className="input min-h-24"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="e.g. Rang four approved suppliers at 23:10–23:40; checked the DPS for same-night availability; escalated to the duty manager."
            />
          </label>
        </Section>
      ) : (
        <Section title="Placement">
          <fieldset className="grid gap-2">
            <legend className="sr-only">Choose the placement</legend>
            {eligible.map(c => (
              <label
                key={c.propertyId}
                className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border p-3 ${choice === c.propertyId ? 'border-accent bg-accent-soft' : 'border-rule'}`}
              >
                <input id={`choice-${c.propertyId}`} type="radio" name="choice" checked={choice === c.propertyId} onChange={() => setChoice(c.propertyId)} />
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{c.label}</span> {c.propertyId === s.recommendedId && <span className="chip chip-accent">Recommended</span>}
                  <span className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                    <TierChip tier={c.tier} district={c.district} /> Suitability {c.score} · TA budget {gbp(c.cost.taNetPerNight, 2)}/night
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {isOverride ? (
            <div className="mt-4 grid gap-3 rounded-lg border border-warn bg-warn-soft p-3">
              <div className="font-bold text-warn">You are choosing a different option from the recommendation ({rec?.label}).</div>
              <label className="field max-w-sm">
                <span>Reason</span>
                <select id="reason" className="input" value={reason} onChange={e => setReason(e.target.value as OverrideReason)}>
                  {OVERRIDE_REASONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Explain in your own words</span>
                <textarea
                  id="reasonText"
                  className="input min-h-20"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Reviews look at reasons, not scores. Say what you knew and why it outweighed the recommendation."
                />
              </label>
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
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="field max-w-xs">
              <span>Placement starts</span>
              <input id="startDate" type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            {hasChildren && (
              <label className="flex items-start gap-2 self-end">
                <input id="consent" className="mt-1" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                <span>The parent consents to the council notifying the children’s school, GP and health visitor</span>
              </label>
            )}
          </div>
        </Section>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Your name</span>
            <input id="officer" className="input" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Role</span>
            <input id="role" className="input" value={role} onChange={e => setRole(e.target.value)} />
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2">
          <input id="confirm" className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          <span>
            I have reviewed the {eligible.length} eligible option{eligible.length === 1 ? '' : 's'} and the {rejectedCount} ruled out, and this decision is
            mine.
          </span>
        </label>
      </Section>

      {error && (
        <p role="alert" className="rounded-md border border-bad bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sealing the record…' : 'Record decision'}
        </button>
        <button type="button" className="btn" onClick={() => go({ view: 'results', searchId })}>
          Back to options
        </button>
      </div>
    </form>
  )
}
