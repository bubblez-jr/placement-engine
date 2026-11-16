import { CONSENT_FOLLOW_UP_DAYS } from '../engine/clocks'
import { CONSENT_METHOD_LABEL, CONSENT_STATUS_LABEL, type ConsentInput } from '../engine/decision'
import { formatDateTime } from '../engine/dates'
import type { ConsentMethod, ConsentStatus, Household, Issue } from '../engine/types'
import type { ConsentView } from '../audit/records'
import { Field, FieldError, fieldA11y } from './bits'

const STATUS_HELP: Record<ConsentStatus, string> = {
  given: 'A parent agreed. The notice is drafted for you to send.',
  refused: 'A parent said no. No notice is drafted, and the record says so.',
  not_asked: `You could not ask yet. Say why: you get a task to ask within ${CONSENT_FOLLOW_UP_DAYS} days.`,
}

/** Consent questions with no answer filled in. Field ids match the engine's issue paths. */
export function ConsentFields({
  household,
  value,
  onChange,
  issues,
}: {
  household: Household
  value: ConsentInput
  onChange: (c: ConsentInput) => void
  issues: Issue[]
}) {
  const adults = household.members.filter(m => m.role === 'adult')
  const set = (patch: Partial<ConsentInput>) => onChange({ ...value, ...patch })
  const statusInvalid = issues.some(i => i.path === 'consent-status')
  const methodInvalid = issues.some(i => i.path === 'consent-method')
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2" aria-describedby={statusInvalid ? 'consent-status-error' : undefined}>
        <legend className="mb-1 text-[0.8rem] font-semibold text-muted">What did the parent say?</legend>
        {(['given', 'refused', 'not_asked'] as const).map((st, i) => (
          <label
            key={st}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${value.status === st ? 'border-accent bg-accent-soft' : statusInvalid ? 'border-bad' : 'border-rule'}`}
          >
            <input
              id={i === 0 ? 'consent-status' : `consent-status-${st}`}
              className="mt-1"
              type="radio"
              name="consent-status"
              checked={value.status === st}
              aria-invalid={statusInvalid || undefined}
              onChange={() => set({ status: st })}
            />
            <span>
              <span className="font-semibold">{CONSENT_STATUS_LABEL[st]}</span>
              <span className="block text-sm text-muted">{STATUS_HELP[st]}</span>
            </span>
          </label>
        ))}
        <FieldError id="consent-status" issues={issues} />
      </fieldset>

      {(value.status === 'given' || value.status === 'refused') && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="consent-givenBy" label={value.status === 'given' ? 'Which adult gave consent' : 'Which adult refused'} issues={issues}>
            <select
              {...fieldA11y('consent-givenBy', issues)}
              className="input"
              value={value.givenBy ?? ''}
              onChange={e => set({ givenBy: e.target.value || undefined })}
            >
              <option value="">Choose…</option>
              {adults.map(a => (
                <option key={a.id} value={a.label}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="grid gap-1.5" aria-describedby={methodInvalid ? 'consent-method-error' : undefined}>
            <legend className="mb-1 text-[0.8rem] font-semibold text-muted">How you asked</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(Object.keys(CONSENT_METHOD_LABEL) as ConsentMethod[]).map((m, i) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input
                    id={i === 0 ? 'consent-method' : `consent-method-${m}`}
                    type="radio"
                    name="consent-method"
                    checked={value.method === m}
                    aria-invalid={methodInvalid || undefined}
                    onChange={() => set({ method: m })}
                  />
                  {CONSENT_METHOD_LABEL[m]}
                </label>
              ))}
            </div>
            <FieldError id="consent-method" issues={issues} />
          </fieldset>
        </div>
      )}

      {value.status === 'not_asked' && (
        <Field id="consent-reason" label="Why consent has not been asked yet" issues={issues}>
          <textarea
            {...fieldA11y('consent-reason', issues)}
            className="input min-h-16"
            value={value.reason ?? ''}
            onChange={e => set({ reason: e.target.value })}
            placeholder="For example: placed at 02:00 and the parent was asleep; will ask at the morning visit."
          />
        </Field>
      )}

      {value.status && (
        <label className="field">
          <span>Note (optional)</span>
          <input id="consent-note" className="input" value={value.note ?? ''} onChange={e => set({ note: e.target.value })} />
        </label>
      )}
    </div>
  )
}

/** Consent as it stands, in plain words, for the record and the audit pack. */
export function ConsentText({ view }: { view: ConsentView }) {
  if (view.kind === 'not_applicable') return <span className="text-muted">Not applicable</span>
  if (view.kind === 'legacy')
    return (
      <span>
        Consent recorded as <b>{view.consented ? 'yes' : 'no'}</b> under the earlier version. That version used a tick-box, so who gave it, and how, were not
        recorded.
      </span>
    )
  const c = view.consent
  return (
    <span>
      <b>{CONSENT_STATUS_LABEL[c.status]}</b>
      {c.status === 'not_asked'
        ? `: ${(c.reason ?? '').replace(/[.\s]+$/, '')}`
        : ` by ${c.givenBy}, ${c.method ? CONSENT_METHOD_LABEL[c.method].toLowerCase() : ''}`}
      .{' '}
      <span className="text-muted">
        Recorded by {c.recordedBy.name} ({c.recordedBy.roleLabel.toLowerCase()}), {formatDateTime(c.recordedAt)}.
      </span>
      {c.note && <span className="block text-sm text-muted">Note: {c.note}</span>}
    </span>
  )
}
