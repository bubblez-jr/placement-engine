import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { useUser } from '../../auth/session'
import { SCENARIOS } from '../../data/households'
import { AREAS, PLACES, PLACE_KIND_LABEL } from '../../data/places'
import { ACCESS_NEED_LABEL, ACCESS_QUESTIONS, HOUSEHOLD_SUBJECT, requiredAccessSubjects, subjectLabel } from '../../engine/access'
import { bedroomNeed } from '../../engine/bedrooms'
import { formatDateTime, toIsoDate } from '../../engine/dates'
import { actorRef, check } from '../../engine/permissions'
import { CASE_REF_MAX, MAX_STAY_NIGHTS, validateHousehold, ValidationError } from '../../engine/validate'
import type { AccessAssessment, AccessQuestion, Household, Issue, Person, PriorityFlag, YesNo } from '../../engine/types'
import { ErrorSummary, Field, FieldError, fieldA11y, NotAllowed, NumberInput, PageHeader, Section, WarningList } from '../bits'

const FLAGS: [PriorityFlag, string, string][] = [
  ['child_protection_plan', 'Child protection plan', 'raises location and support'],
  ['ongoing_treatment', 'Ongoing medical treatment', 'raises the treatment journey'],
  ['caring_duties', 'Caring duties', 'raises the care journey'],
  ['domestic_abuse', 'Domestic abuse', 'raises support; add an exclusion zone below'],
  ['disability', 'Disability', 'raises the treatment journey and asks the access questions above'],
]

function blankHousehold(today: string): Household {
  return {
    caseRef: '',
    members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: NaN, sex: 'F' }],
    destinations: [],
    homeArea: AREAS[0].location,
    homeAreaLabel: AREAS[0].label,
    needFrom: today,
    expectedNights: 120,
    accessNeeds: [],
    accessAssessments: [],
    petsMustBeAccommodated: false,
    flags: [],
    safeguardingZones: [],
    maxHouseholdContributionWeekly: 15,
    notes: '',
  }
}

function relabel(members: Person[]): Person[] {
  let a = 0
  let c = 0
  return members.map(m => ({ ...m, label: m.role === 'adult' ? `Adult ${++a}` : `Child ${++c}` }))
}

let uid = 100
const nextId = (p: string) => `${p}${++uid}`

/** Keep only the access answers for people still in the household, or still needed by the household flag. */
function pruneAssessments(h: Household): Household {
  const ids = new Set(h.members.map(m => m.id))
  const required = new Set(requiredAccessSubjects(h))
  return {
    ...h,
    accessAssessments: (h.accessAssessments ?? []).filter(a => (a.subject === HOUSEHOLD_SUBJECT ? required.has(HOUSEHOLD_SUBJECT) : ids.has(a.subject))),
  }
}

export function NewPlacement({ scenarioId, fromSearchId }: { scenarioId?: string; fromSearchId?: string }) {
  const { search, getSearch, openCases } = useApp()
  const user = useUser()
  const { go } = useNav()
  const today = toIsoDate(new Date())
  const initial = useMemo(() => {
    if (fromSearchId) {
      const s = getSearch(fromSearchId)
      if (s) return { ...structuredClone(s.household), accessAssessments: s.household.accessAssessments ?? [] }
    }
    const sc = SCENARIOS.find(s => s.id === scenarioId)
    return sc ? sc.household(today) : blankHousehold(today)
  }, [scenarioId, fromSearchId, getSearch, today])
  const [h, setH] = useState<Household>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Errors show after the first submit, then update live as fields are corrected. */
  const [showErrors, setShowErrors] = useState(false)
  const [focusSummary, setFocusSummary] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const agesKnown = h.members.length > 0 && h.members.every(m => Number.isInteger(m.age) && m.age >= 0)
  const need = agesKnown ? bedroomNeed(h.members) : null
  const scenario = SCENARIOS.find(s => s.id === scenarioId)
  const allowed = check(user, 'run_search')

  const allIssues = useMemo(() => validateHousehold(h, today, { openCases }), [h, today, openCases])
  const issues: Issue[] = showErrors ? allIssues : allIssues.filter(i => i.severity === 'warning')
  const errorCount = allIssues.filter(i => i.severity === 'error').length

  useEffect(() => {
    if (focusSummary) summaryRef.current?.focus()
  }, [focusSummary])

  const set = (patch: Partial<Household>) => setH(x => pruneAssessments({ ...x, ...patch }))
  const setMember = (id: string, patch: Partial<Person>) => set({ members: h.members.map(m => (m.id === id ? { ...m, ...patch } : m)) })

  function answer(subject: string, q: AccessQuestion, v: YesNo) {
    const now = new Date().toISOString()
    const list = h.accessAssessments ?? []
    const existing = list.find(a => a.subject === subject)
    const next: AccessAssessment = {
      ...(existing ?? { subject, answers: {} }),
      answers: { ...existing?.answers, [q]: v },
      answeredBy: actorRef(user),
      answeredAt: now,
    }
    set({ accessAssessments: existing ? list.map(a => (a.subject === subject ? next : a)) : [...list, next] })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (errorCount > 0) {
      // A failed submit never runs a search: show every error and move focus to the summary.
      setShowErrors(true)
      setFocusSummary(n => n + 1)
      return
    }
    setBusy(true)
    try {
      const r = await search(h)
      go({ view: 'results', searchId: r.id })
    } catch (err) {
      if (err instanceof ValidationError) {
        setShowErrors(true)
        setFocusSummary(n => n + 1)
      } else setError(`The search could not run: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const subjects = [...new Set([...requiredAccessSubjects(h), ...(h.accessAssessments ?? []).map(a => a.subject)])]
  const placeName = (id: string) => h.destinations.find(d => d.id === id)?.name ?? 'this place'

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate aria-describedby={scenario ? 'scenario-summary' : undefined}>
      <PageHeader eyebrow="New placement" title={scenario ? scenario.title : 'Household needs'}>
        <span id="scenario-summary">
          {scenario
            ? `${scenario.summary} This is an invented example household. Change anything below, then find placements.`
            : 'Record what the placement has to work for. Only pseudonymous details: the case system holds names and contact details.'}
        </span>
      </PageHeader>

      {!allowed.ok && <NotAllowed reason={allowed.reason} className="callout" />}
      {showErrors && <ErrorSummary ref={summaryRef} issues={issues} />}
      <WarningList
        issues={issues}
        onLink={l => (l.seq ? go({ view: 'decision', seq: l.seq }) : l.searchId ? go({ view: 'results', searchId: l.searchId }) : undefined)}
      />

      <Section title="Case">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="caseRef" label="Case reference" hint={`From the case system, up to ${CASE_REF_MAX} characters`} issues={issues}>
            <input
              {...fieldA11y('caseRef', issues, 'caseRef-hint')}
              className="input"
              value={h.caseRef}
              autoComplete="off"
              onChange={e => set({ caseRef: e.target.value })}
            />
          </Field>
          <label className="field">
            <span>Last settled area</span>
            <select
              id="homeArea"
              className="input"
              value={AREAS.find(a => a.label === h.homeAreaLabel)?.id ?? ''}
              onChange={e => {
                const a = AREAS.find(x => x.id === e.target.value)
                if (a) set({ homeArea: a.location, homeAreaLabel: a.label })
              }}
            >
              {!AREAS.some(a => a.label === h.homeAreaLabel) && <option value="">{h.homeAreaLabel}</option>}
              {AREAS.map(a => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <Field id="needFrom" label="Needed from" issues={issues}>
            <input {...fieldA11y('needFrom', issues)} type="date" className="input" value={h.needFrom} onChange={e => set({ needFrom: e.target.value })} />
          </Field>
          <Field id="expectedNights" label="Expected stay (nights)" issues={issues}>
            <NumberInput
              {...fieldA11y('expectedNights', issues)}
              min={1}
              max={MAX_STAY_NIGHTS}
              className="input num"
              value={h.expectedNights}
              onValue={n => set({ expectedNights: n })}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Household"
        aside={
          need === null ? (
            <span className="chip chip-plain">Bedroom need: enter every age</span>
          ) : (
            <span className="chip chip-accent">
              Needs {need} bedroom{need === 1 ? '' : 's'}
            </span>
          )
        }
      >
        <div id="members" tabIndex={-1} className="grid gap-1">
          <FieldError id="members" issues={issues} />
        </div>
        <div className="scroll-x">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>Person</th>
                <th>Age</th>
                <th>Sex</th>
                <th>Partner</th>
                <th>Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {h.members.map(m => (
                <tr key={m.id}>
                  <td className="font-bold">{m.label}</td>
                  <td>
                    <NumberInput
                      {...fieldA11y(`age-${m.id}`, issues)}
                      aria-label={`${m.label} age`}
                      min={0}
                      max={120}
                      className="input num w-20"
                      value={m.age}
                      onValue={n => setMember(m.id, { age: n })}
                    />
                    <div className="mt-1 max-w-56">
                      <FieldError id={`age-${m.id}`} issues={issues} />
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={`${m.label} sex`}
                      id={`sex-${m.id}`}
                      className="input w-24"
                      value={m.sex}
                      onChange={e => setMember(m.id, { sex: e.target.value as Person['sex'] })}
                    >
                      <option value="F">Female</option>
                      <option value="M">Male</option>
                      <option value="X">Other</option>
                    </select>
                  </td>
                  <td>
                    {m.role === 'adult' ? (
                      <>
                        <select
                          {...fieldA11y(`partner-${m.id}`, issues)}
                          aria-label={`${m.label} partner`}
                          className="input w-28"
                          value={m.partnerOf ?? ''}
                          onChange={e => {
                            const pid = e.target.value || undefined
                            set({
                              members: h.members.map(x =>
                                x.id === m.id
                                  ? { ...x, partnerOf: pid }
                                  : x.id === pid
                                    ? { ...x, partnerOf: m.id }
                                    : x.partnerOf === m.id
                                      ? { ...x, partnerOf: undefined }
                                      : x,
                              ),
                            })
                          }}
                        >
                          <option value="">None</option>
                          {h.members
                            .filter(x => x.role === 'adult' && x.id !== m.id)
                            .map(x => (
                              <option key={x.id} value={x.id}>
                                {x.label}
                              </option>
                            ))}
                        </select>
                        <div className="mt-1 max-w-56">
                          <FieldError id={`partner-${m.id}`} issues={issues} />
                        </div>
                      </>
                    ) : (
                      <span className="text-faint">None</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      {(m.role === 'adult'
                        ? ([
                            ['pregnant', 'Pregnant'],
                            ['employed', 'In work'],
                            ['wheelchairUser', 'Wheelchair user'],
                          ] as const)
                        : ([
                            ['examYear', 'Exam year'],
                            ['send', 'SEND'],
                            ['wheelchairUser', 'Wheelchair user'],
                          ] as const)
                      ).map(([k, label]) => (
                        <label key={k} className="flex items-center gap-1.5">
                          <input id={`${k}-${m.id}`} type="checkbox" checked={!!m[k]} onChange={e => setMember(m.id, { [k]: e.target.checked })} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-quiet btn text-sm"
                      onClick={() =>
                        set({
                          members: relabel(h.members.filter(x => x.id !== m.id).map(x => (x.partnerOf === m.id ? { ...x, partnerOf: undefined } : x))),
                          destinations: h.destinations.map(d => (d.personId === m.id ? { ...d, personId: '' } : d)),
                        })
                      }
                    >
                      Remove <span className="sr-only">{m.label}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            id="add-adult"
            type="button"
            className="btn"
            onClick={() => set({ members: relabel([...h.members, { id: nextId('a'), label: '', role: 'adult', age: NaN, sex: 'F' }]) })}
          >
            Add adult
          </button>
          <button
            id="add-child"
            type="button"
            className="btn"
            onClick={() => set({ members: relabel([...h.members, { id: nextId('c'), label: '', role: 'child', age: NaN, sex: 'F' }]) })}
          >
            Add child
          </button>
        </div>
      </Section>

      {subjects.length > 0 && (
        <Section
          id="access-needs"
          title="Access needs"
          description="Answer every question. Nothing is filled in for you. Each yes becomes a check every property must pass, and the result names whose need it is."
        >
          <div className={`grid gap-4 ${subjects.length > 1 ? 'xl:grid-cols-2' : 'max-w-3xl'}`}>
            {subjects.map(subject => {
              const a = (h.accessAssessments ?? []).find(x => x.subject === subject)
              const label = subjectLabel(h, subject)
              const person = h.members.find(m => m.id === subject)
              const why =
                subject === HOUSEHOLD_SUBJECT ? 'The household has the disability flag.' : person?.wheelchairUser ? `${label} uses a wheelchair.` : null
              return (
                <div key={subject} className="rounded-lg border border-rule p-3 sm:p-4" id={`access-panel-${subject}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{label}</h3>
                    {why ? (
                      <span className="text-sm text-muted">{why}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-quiet btn text-sm"
                        onClick={() => set({ accessAssessments: (h.accessAssessments ?? []).filter(x => x.subject !== subject) })}
                      >
                        Remove these answers
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid gap-2.5">
                    {ACCESS_QUESTIONS.map(q => {
                      const id = `access-${subject}-${q.key}`
                      const v = a?.answers[q.key]
                      const invalid = issues.some(i => i.path === id && i.severity === 'error')
                      return (
                        <fieldset key={q.key} className="grid gap-1" aria-describedby={invalid ? `${id}-error` : undefined}>
                          <legend className="sr-only">
                            {label}: {q.question}
                          </legend>
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <span className="text-[0.92rem]" aria-hidden="true">
                              {q.question}
                            </span>
                            <span className="flex gap-1.5">
                              {(['yes', 'no'] as const).map(opt => (
                                <label
                                  key={opt}
                                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium ${v === opt ? 'border-accent bg-accent-soft text-accent' : invalid ? 'border-bad' : 'border-rule'}`}
                                >
                                  <input
                                    id={opt === 'yes' ? id : `${id}-no`}
                                    type="radio"
                                    name={id}
                                    checked={v === opt}
                                    aria-invalid={invalid || undefined}
                                    onChange={() => answer(subject, q.key, opt)}
                                  />
                                  {opt === 'yes' ? 'Yes' : 'No'}
                                </label>
                              ))}
                            </span>
                          </div>
                          {invalid && (
                            <span id={`${id}-error`} className="text-sm font-medium text-bad">
                              Answer yes or no.
                            </span>
                          )}
                        </fieldset>
                      )
                    })}
                    {a?.answers.equipment_or_carer === 'yes' && (
                      <label className="field">
                        <span>What equipment or care (optional, kept with the record)</span>
                        <input
                          id={`access-${subject}-note`}
                          className="input"
                          value={a.note ?? ''}
                          onChange={e =>
                            set({ accessAssessments: (h.accessAssessments ?? []).map(x => (x.subject === subject ? { ...x, note: e.target.value } : x)) })
                          }
                        />
                      </label>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    {a?.answeredBy && a.answeredAt
                      ? `Last answered by ${a.answeredBy.name}, ${formatDateTime(a.answeredAt)}`
                      : 'Example answers are confirmed by whoever runs the search.'}
                  </p>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Places that matter" aside={<span className="text-sm text-muted">Journey times are measured to each of these</span>}>
        {h.destinations.length === 0 && (
          <p className="mb-3 text-muted">
            Add schools, work, treatment, care and support the household relies on. Each one is weighed under the 2012 Suitability Order, art.2.
          </p>
        )}
        <ul className="grid gap-3">
          {h.destinations.map(d => (
            <li key={d.id} className="grid items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_7rem_6rem_auto]">
              <Field id={`who-${d.id}`} label="Who" issues={issues}>
                <select
                  {...fieldA11y(`who-${d.id}`, issues)}
                  className="input"
                  value={d.personId}
                  onChange={e => set({ destinations: h.destinations.map(x => (x.id === d.id ? { ...x, personId: e.target.value } : x)) })}
                >
                  {!h.members.some(m => m.id === d.personId) && <option value="">Choose…</option>}
                  {h.members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="field">
                <span>Place</span>
                <select
                  id={`place-${d.id}`}
                  className="input"
                  value={PLACES.find(p => p.name === d.name)?.id ?? ''}
                  onChange={e => {
                    const p = PLACES.find(x => x.id === e.target.value)!
                    set({
                      destinations: h.destinations.map(x => (x.id === d.id ? { ...x, kind: p.kind, name: p.name, refId: p.refId, location: p.location } : x)),
                    })
                  }}
                >
                  {(['school', 'work', 'medical', 'care', 'support'] as const).map(kind => (
                    <optgroup key={kind} label={PLACE_KIND_LABEL[kind]}>
                      {PLACES.filter(p => p.kind === kind).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <Field id={`arrive-${d.id}`} label="Arrive by" issues={issues}>
                <input
                  {...fieldA11y(`arrive-${d.id}`, issues)}
                  type="time"
                  className="input num"
                  value={d.arriveBy}
                  onChange={e => set({ destinations: h.destinations.map(x => (x.id === d.id ? { ...x, arriveBy: e.target.value } : x)) })}
                />
              </Field>
              <Field id={`days-${d.id}`} label="Days/week" issues={issues}>
                <NumberInput
                  {...fieldA11y(`days-${d.id}`, issues)}
                  min={1}
                  max={7}
                  className="input num"
                  value={d.daysPerWeek}
                  onValue={n => set({ destinations: h.destinations.map(x => (x.id === d.id ? { ...x, daysPerWeek: n } : x)) })}
                />
              </Field>
              <button type="button" className="btn btn-quiet text-sm sm:mt-6" onClick={() => set({ destinations: h.destinations.filter(x => x.id !== d.id) })}>
                Remove <span className="sr-only">{placeName(d.id)}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn mt-3"
          onClick={() => {
            const p = PLACES[0]
            const who = h.members.find(m => m.role === 'child') ?? h.members[0]
            set({
              destinations: [
                ...h.destinations,
                {
                  id: nextId('d'),
                  personId: who?.id ?? '',
                  kind: p.kind,
                  name: p.name,
                  refId: p.refId,
                  location: p.location,
                  arriveBy: '08:45',
                  daysPerWeek: 5,
                },
              ],
            })
          }}
        >
          Add a place
        </button>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Must-haves">
          <div className="grid gap-2">
            {(h.accessNeeds ?? []).length > 0 && (
              <div className="callout text-sm">
                Recorded under the earlier version, for the whole household: {(h.accessNeeds ?? []).map(n => ACCESS_NEED_LABEL[n].toLowerCase()).join(', ')}.
                These still apply.{' '}
                <button type="button" className="link text-sm" onClick={() => set({ accessNeeds: [] })}>
                  Remove them
                </button>
              </div>
            )}
            <p className="text-sm text-muted">Access needs are asked per person: tick “Wheelchair user” above, or the disability flag.</p>
            <label className="flex items-center gap-2">
              <input id="pets" type="checkbox" checked={h.petsMustBeAccommodated} onChange={e => set({ petsMustBeAccommodated: e.target.checked })} />A pet must
              be accommodated
            </label>
            <Field id="afford" label="Most the household can pay towards charges (£/week)" issues={issues} className="mt-2 max-w-xs">
              <NumberInput
                {...fieldA11y('afford', issues)}
                min={0}
                step="0.01"
                className="input num"
                value={h.maxHouseholdContributionWeekly}
                onValue={n => set({ maxHouseholdContributionWeekly: n })}
              />
            </Field>
          </div>
        </Section>
        <Section title="Priority flags">
          <p className="mb-2 text-sm text-muted">
            Flags change the weights as the placement policy sets out. Exam years and employment are picked up from the people above.
          </p>
          <div className="grid gap-2">
            {FLAGS.map(([k, label, effect]) => (
              <label key={k} className="flex items-start gap-2">
                <input
                  id={`flag-${k}`}
                  className="mt-1"
                  type="checkbox"
                  checked={h.flags.includes(k)}
                  onChange={e => set({ flags: e.target.checked ? [...h.flags, k] : h.flags.filter(x => x !== k) })}
                />
                <span>
                  {label} <span className="text-sm text-muted">· {effect}</span>
                </span>
              </label>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Safeguarding exclusion zones" aside={<span className="text-sm text-muted">Reasons stay in the case system</span>}>
        {h.safeguardingZones.length === 0 && (
          <p className="mb-3 text-muted">None. Add a zone to rule out every property inside it. Officers see only “inside a safeguarding exclusion zone”.</p>
        )}
        <ul className="grid gap-2">
          {h.safeguardingZones.map(z => (
            <li key={z.id} className="flex flex-wrap items-start gap-2">
              <label className="field">
                <span>Centre</span>
                <select
                  id={`zone-${z.id}`}
                  className="input"
                  value={AREAS.find(a => a.location.lat === z.center.lat && a.location.lng === z.center.lng)?.id ?? ''}
                  onChange={e => {
                    const a = AREAS.find(x => x.id === e.target.value)!
                    set({ safeguardingZones: h.safeguardingZones.map(x => (x.id === z.id ? { ...x, center: a.location } : x)) })
                  }}
                >
                  {!AREAS.some(a => a.location.lat === z.center.lat && a.location.lng === z.center.lng) && <option value="">Restricted location</option>}
                  {AREAS.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field id={`radius-${z.id}`} label="Radius (km)" issues={issues} className="w-36">
                <NumberInput
                  {...fieldA11y(`radius-${z.id}`, issues)}
                  min={0.1}
                  max={50}
                  step={0.5}
                  className="input num"
                  value={z.radiusKm}
                  onValue={n => set({ safeguardingZones: h.safeguardingZones.map(x => (x.id === z.id ? { ...x, radiusKm: n } : x)) })}
                />
              </Field>
              <button
                type="button"
                className="btn btn-quiet mt-6 text-sm"
                onClick={() => set({ safeguardingZones: h.safeguardingZones.filter(x => x.id !== z.id) })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn mt-3"
          onClick={() => set({ safeguardingZones: [...h.safeguardingZones, { id: nextId('z'), center: AREAS[4].location, radiusKm: 2 }] })}
        >
          Add an exclusion zone
        </button>
      </Section>

      <Section title="Notes for the record">
        <textarea
          id="notes"
          className="input min-h-20"
          value={h.notes ?? ''}
          onChange={e => set({ notes: e.target.value })}
          placeholder="Anything the decision should take into account that is not captured above."
        />
      </Section>

      {error && (
        <p role="alert" className="rounded-md border border-bad bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || !allowed.ok} aria-describedby={!allowed.ok ? 'search-not-allowed' : undefined}>
          {busy ? 'Checking every property…' : 'Find placements'}
        </button>
        <button type="button" className="btn" onClick={() => go({ view: 'home' })}>
          Cancel
        </button>
        {!allowed.ok && (
          <span id="search-not-allowed" className="text-sm text-muted">
            {allowed.reason}
          </span>
        )}
        {showErrors && errorCount > 0 && (
          <span className="text-sm font-medium text-bad">
            {errorCount} problem{errorCount === 1 ? '' : 's'} to fix before the search can run
          </span>
        )}
      </div>
    </form>
  )
}
