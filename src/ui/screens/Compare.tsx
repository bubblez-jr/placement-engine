import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { biggestDifferences, costComparison } from '../../engine/explain'
import { TIER_LABEL } from '../../engine/scoring'
import { UNIT_LABEL } from '../criteria'
import { gbp, PageHeader, ScoreBar, Section } from '../bits'

export function Compare({ searchId, ids: initialIds }: { searchId: string; ids: string[] }) {
  const { getSearch, data, noteReview } = useApp()
  const { go } = useNav()
  const [ids, setIds] = useState(initialIds)
  useEffect(() => {
    noteReview(searchId, { comparisonOpened: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId])
  const s = getSearch(searchId)
  if (!s) return <p>Search not found.</p>
  const eligible = s.candidates.filter(c => c.eligible).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const cols = ids.map(id => s.candidates.find(c => c.propertyId === id)!).filter(Boolean)
  const props = cols.map(c => data.properties.find(p => p.id === c.propertyId)!)
  const person = (id: string) => s.household.members.find(m => m.id === id)?.label ?? id
  const edu = (i: number) => cols[i].cost.lines.filter(l => l.budgetHolder === 'education').reduce((a, l) => a + l.perUnit, 0)
  const [a, b] = cols

  const row = (label: string, cells: ReactNode[], strong = false) => (
    <tr>
      <th scope="row" className="!normal-case !tracking-normal text-left !text-sm !font-normal text-muted">
        {label}
      </th>
      {cells.map((x, i) => (
        <td key={i} className={`num ${strong ? 'font-bold' : ''}`}>
          {x}
        </td>
      ))}
    </tr>
  )

  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ label: 'Back to options', onClick: () => go({ view: 'results', searchId }) }}
        eyebrow={`Case ${s.household.caseRef} · comparison`}
        title="Compare options"
      >
        Pick two or three eligible options. Costs are split by who pays; journeys are per person.
      </PageHeader>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Options to compare">
        {eligible.map(c => {
          const on = ids.includes(c.propertyId)
          return (
            <button
              key={c.propertyId}
              className={`chip ${on ? 'chip-accent' : 'chip-plain'} cursor-pointer py-1`}
              aria-pressed={on}
              onClick={() => setIds(x => (on ? x.filter(i => i !== c.propertyId) : x.length >= 3 ? [...x.slice(1), c.propertyId] : [...x, c.propertyId]))}
            >
              {c.rank}. {c.label}
            </button>
          )
        })}
      </div>

      {cols.length < 2 ? (
        <p className="text-muted">Choose at least two options.</p>
      ) : (
        <>
          <Section title="Side by side">
            <div className="scroll-x">
              <table className="table min-w-[640px]">
                <thead>
                  <tr>
                    <th />
                    {cols.map(c => (
                      <th key={c.propertyId} className="!text-sm !normal-case !tracking-normal text-ink">
                        {c.label}
                        {c.propertyId === s.recommendedId && <div className="chip chip-accent mt-1">Recommended</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row(
                    'Where',
                    cols.map(c => `${c.district} · ${TIER_LABEL[c.tier]}`),
                  )}
                  {row(
                    'Type',
                    props.map(p => `${UNIT_LABEL[p.unitType]}, ${p.bedrooms} bed`),
                  )}
                  {row(
                    'Nightly charge',
                    cols.map(c => gbp(c.cost.nightlyCharge, 2)),
                  )}
                  {row(
                    'Housing benefit subsidy reclaimed',
                    cols.map(c => `−${gbp(c.cost.subsidyPerNight, 2)}`),
                  )}
                  {row(
                    'TA budget, net per night',
                    cols.map(c => gbp(c.cost.taNetPerNight, 2)),
                    true,
                  )}
                  {row(
                    'Education transport per school day',
                    cols.map((_, i) => (edu(i) > 0 ? gbp(edu(i), 2) : '£0')),
                  )}
                  {row(
                    'Family travel and charges, whole stay',
                    cols.map(c => gbp(c.cost.householdStay)),
                  )}
                  {row(
                    `Public cost, ${s.household.expectedNights} nights`,
                    cols.map(c => gbp(c.cost.publicStay)),
                    true,
                  )}
                  {s.household.destinations.map(d =>
                    row(
                      `${person(d.personId)} → ${d.name}`,
                      cols.map(c => {
                        const j = c.journeys.find(x => x.destinationId === d.id)
                        return j?.minutes != null ? `${j.minutes} min` : '—'
                      }),
                    ),
                  )}
                  {row(
                    'Compliance',
                    cols.map(c =>
                      c.warnings.some(w => w.code === 'COMPLIANCE_EXPIRES_DURING_STAY') ? 'PASS · a certificate expires during the stay' : 'PASS',
                    ),
                  )}
                  {row(
                    'Suitability',
                    cols.map(c => <ScoreBar key={c.propertyId} criteria={c.criteria} score={c.score} />),
                  )}
                  {row(
                    'Engine',
                    cols.map(c => (c.propertyId === s.recommendedId ? 'RECOMMENDED' : `Rank ${c.rank}`)),
                    true,
                  )}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={`What the difference means: ${a.label} against ${b.label}`}>
            <ul className="grid max-w-3xl gap-2">
              {biggestDifferences(a, b).length > 0 && (
                <li>
                  {a.label} is better on {biggestDifferences(a, b).join(' and ')}.
                </li>
              )}
              {biggestDifferences(b, a).length > 0 && (
                <li>
                  {b.label} is better on {biggestDifferences(b, a).join(' and ')}.
                </li>
              )}
              {costComparison(a, b).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">Cost can choose between suitable options; it cannot make an unsuitable option suitable.</p>
          </Section>
        </>
      )}
    </div>
  )
}
