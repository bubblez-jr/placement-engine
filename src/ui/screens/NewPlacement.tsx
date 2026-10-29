import { useMemo, useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { SCENARIOS } from '../../data/households'
import { AREAS, PLACES, PLACE_KIND_LABEL } from '../../data/places'
import { bedroomNeed } from '../../engine/bedrooms'
import { toIsoDate } from '../../engine/dates'
import type { AccessNeed, Household, Person, PriorityFlag } from '../../engine/types'
import { PageHeader, Section } from '../bits'

const ACCESS: [AccessNeed, string][] = [
  ['step_free', 'Step-free access'],
  ['wheelchair_accessible', 'Wheelchair accessible'],
  ['ground_floor_or_lift', 'Ground floor or lift'],
  ['adapted_bathroom', 'Adapted bathroom'],
]

const FLAGS: [PriorityFlag, string, string][] = [
  ['child_protection_plan', 'Child protection plan', 'raises location and support'],
  ['ongoing_treatment', 'Ongoing medical treatment', 'raises the treatment journey'],
  ['caring_duties', 'Caring duties', 'raises the care journey'],
  ['domestic_abuse', 'Domestic abuse', 'raises support; add an exclusion zone below'],
  ['disability', 'Disability', 'raises the treatment journey'],
]

function blankHousehold(): Household {
  return {
    caseRef: `HN-26-${String(Math.floor(500 + Math.random() * 400)).padStart(4, '0')}`,
    members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 30, sex: 'F' }],
    destinations: [],
    homeArea: AREAS[0].location,
    homeAreaLabel: AREAS[0].label,
    needFrom: toIsoDate(new Date()),
    expectedNights: 120,
    accessNeeds: [],
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

export function NewPlacement({ scenarioId, fromSearchId }: { scenarioId?: string; fromSearchId?: string }) {
  const { search, getSearch } = useApp()
  const { go } = useNav()
  const initial = useMemo(() => {
    if (fromSearchId) {
      const s = getSearch(fromSearchId)
      if (s) return structuredClone(s.household)
    }
    const sc = SCENARIOS.find(s => s.id === scenarioId)
    return sc ? sc.household(toIsoDate(new Date())) : blankHousehold()
  }, [scenarioId, fromSearchId, getSearch])
  const [h, setH] = useState<Household>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const need = bedroomNeed(h.members)
  const scenario = SCENARIOS.find(s => s.id === scenarioId)

  const set = (patch: Partial<Household>) => setH(x => ({ ...x, ...patch }))
  const setMember = (id: string, patch: Partial<Person>) => set({ members: h.members.map(m => (m.id === id ? { ...m, ...patch } : m)) })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (h.members.length === 0) return setError('Add at least one person to the household.')
    if (h.expectedNights < 1) return setError('Expected stay must be at least one night.')
    setBusy(true)
    try {
      const r = await search(h)
      go({ view: 'results', searchId: r.id })
    } catch (err) {
      setError(`The search could not run: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <PageHeader eyebrow="New placement" title={scenario ? scenario.title : 'Household needs'}>
        {scenario
          ? `${scenario.summary} Change anything below, then find placements.`
          : 'Record what the placement has to work for. Only pseudonymous details: the case system holds names and contact details.'}
      </PageHeader>

      <Section title="Case">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field">
            <span>Case reference</span>
            <input id="caseRef" className="input" value={h.caseRef} onChange={e => set({ caseRef: e.target.value })} />
          </label>
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
          <label className="field">
            <span>Needed from</span>
            <input id="needFrom" type="date" className="input" value={h.needFrom} onChange={e => set({ needFrom: e.target.value })} />
          </label>
          <label className="field">
            <span>Expected stay (nights)</span>
            <input
              id="expectedNights"
              type="number"
              min={1}
              className="input num"
              value={h.expectedNights}
              onChange={e => set({ expectedNights: Number(e.target.value) })}
            />
          </label>
        </div>
      </Section>

      <Section
        title="Household"
        aside={
          <span className="chip chip-accent">
            Needs {need} bedroom{need === 1 ? '' : 's'}
          </span>
        }
      >
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
                    <input
                      aria-label={`${m.label} age`}
                      id={`age-${m.id}`}
                      type="number"
                      min={0}
                      max={110}
                      className="input num w-20"
                      value={m.age}
                      onChange={e => setMember(m.id, { age: Number(e.target.value) })}
                    />
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
                      <select
                        aria-label={`${m.label} partner`}
                        id={`partner-${m.id}`}
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
                    ) : (
                      <span className="text-faint">—</span>
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
                          destinations: h.destinations.filter(d => d.personId !== m.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => set({ members: relabel([...h.members, { id: nextId('a'), label: '', role: 'adult', age: 30, sex: 'F' }]) })}
          >
            Add adult
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => set({ members: relabel([...h.members, { id: nextId('c'), label: '', role: 'child', age: 6, sex: 'F' }]) })}
          >
            Add child
          </button>
        </div>
      </Section>

      <Section title="Places that matter" aside={<span className="text-sm text-muted">Journey times are measured to each of these</span>}>
        {h.destinations.length === 0 && (
          <p className="mb-3 text-muted">
            Add schools, work, treatment, care and support the household relies on. Each one is weighed under the 2012 Suitability Order, art.2.
          </p>
        )}
        <ul className="grid gap-2">
          {h.destinations.map(d => (
            <li key={d.id} className="grid items-end gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_7rem_6rem_auto]">
              <label className="field">
                <span>Who</span>
                <select
                  id={`who-${d.id}`}
                  className="input"
                  value={d.personId}
                  onChange={e => set({ destinations: h.destinations.map(x => (x.id === d.id ? { ...x, personId: e.target.value } : x)) })}
                >
                  {h.members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
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
              <label className="field">
                <span>Arrive by</span>
                <input
                  id={`arrive-${d.id}`}
                  type="time"
                  className="input num"
                  value={d.arriveBy}
                  onChange={e => set({ destinations: h.destinations.map(x => (x.id === d.id ? { ...x, arriveBy: e.target.value } : x)) })}
                />
              </label>
              <label className="field">
                <span>Days/week</span>
                <input
                  id={`days-${d.id}`}
                  type="number"
                  min={1}
                  max={7}
                  className="input num"
                  value={d.daysPerWeek}
                  onChange={e => set({ destinations: h.destinations.map(x => (x.id === d.id ? { ...x, daysPerWeek: Number(e.target.value) } : x)) })}
                />
              </label>
              <button type="button" className="btn btn-quiet mb-1 text-sm" onClick={() => set({ destinations: h.destinations.filter(x => x.id !== d.id) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn mt-3"
          onClick={() => {
            const p = PLACES[0]
            const child = h.members.find(m => m.role === 'child') ?? h.members[0]
            set({
              destinations: [
                ...h.destinations,
                { id: nextId('d'), personId: child.id, kind: p.kind, name: p.name, refId: p.refId, location: p.location, arriveBy: '08:45', daysPerWeek: 5 },
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
            {ACCESS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  id={`access-${k}`}
                  type="checkbox"
                  checked={h.accessNeeds.includes(k)}
                  onChange={e => set({ accessNeeds: e.target.checked ? [...h.accessNeeds, k] : h.accessNeeds.filter(x => x !== k) })}
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input id="pets" type="checkbox" checked={h.petsMustBeAccommodated} onChange={e => set({ petsMustBeAccommodated: e.target.checked })} />
              Pet or assistance dog must be accommodated
            </label>
            <label className="field mt-2 max-w-xs">
              <span>Most the household can pay towards charges (£/week)</span>
              <input
                id="afford"
                type="number"
                min={0}
                className="input num"
                value={h.maxHouseholdContributionWeekly}
                onChange={e => set({ maxHouseholdContributionWeekly: Number(e.target.value) })}
              />
            </label>
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
            <li key={z.id} className="flex flex-wrap items-end gap-2">
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
              <label className="field w-28">
                <span>Radius (km)</span>
                <input
                  id={`radius-${z.id}`}
                  type="number"
                  min={0.5}
                  step={0.5}
                  className="input num"
                  value={z.radiusKm}
                  onChange={e => set({ safeguardingZones: h.safeguardingZones.map(x => (x.id === z.id ? { ...x, radiusKm: Number(e.target.value) } : x)) })}
                />
              </label>
              <button
                type="button"
                className="btn btn-quiet mb-1 text-sm"
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
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking every property…' : 'Find placements'}
        </button>
        <button type="button" className="btn" onClick={() => go({ view: 'home' })}>
          Cancel
        </button>
      </div>
    </form>
  )
}
