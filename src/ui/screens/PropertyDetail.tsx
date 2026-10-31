import { useEffect } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDate, formatDateTime } from '../../engine/dates'
import { whyHere } from '../../engine/explain'
import { complianceLabel } from '../../engine/gates'
import { BUDGET_LABEL, UNIT_LABEL } from '../criteria'
import { gbp, GateList, PageHeader, SERIES, Section, TierTag } from '../bits'

export function PropertyDetail({ searchId, propertyId }: { searchId: string; propertyId: string }) {
  const { getSearch, data, noteReview } = useApp()
  const { go } = useNav()
  useEffect(() => {
    noteReview(searchId, { propertyOpened: propertyId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId, propertyId])
  const s = getSearch(searchId)
  const c = s?.candidates.find(x => x.propertyId === propertyId)
  const p = data.properties.find(x => x.id === propertyId)
  if (!s || !c || !p) return <p>Property not found in this search.</p>
  const rec = s.candidates.find(x => x.propertyId === s.recommendedId)
  const supplier = data.suppliers.find(x => x.id === p.supplierId)
  const person = (id: string) => s.household.members.find(m => m.id === id)?.label ?? id
  const decided = data.chain.some(r => r.snapshot.search.id === s.id)

  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ label: 'Back to options', onClick: () => go({ view: 'results', searchId }) }}
        eyebrow={`Case ${s.household.caseRef} · option detail`}
        title={p.label}
        actions={
          <>
            {c.eligible && rec && rec.propertyId !== c.propertyId && (
              <button className="btn" onClick={() => go({ view: 'compare', searchId, ids: [rec.propertyId, c.propertyId] })}>
                Compare with the recommendation
              </button>
            )}
            {c.eligible && !decided && (
              <button className="btn btn-primary" onClick={() => go({ view: 'decide', searchId, propertyId })}>
                Choose this property
              </button>
            )}
          </>
        }
      >
        {p.address} · {UNIT_LABEL[p.unitType]} · {p.bedrooms} bedroom{p.bedrooms === 1 ? '' : 's'} · {supplier?.name ?? p.supplierId} · UPRN{' '}
        <span className="num">{p.uprn}</span>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <TierTag tier={c.tier} district={c.district} />
        {c.eligible ? <span className="chip chip-good">Eligible · rank {c.rank}</span> : <span className="chip chip-bad">Ruled out</span>}
        {c.propertyId === s.recommendedId && <span className="chip chip-accent">Recommended</span>}
        {c.lastResort && <span className="chip chip-bad">Last resort</span>}
        <span className="text-muted">{whyHere(c, rec)}</span>
      </div>

      {c.eligible && (
        <Section title={`Suitability: ${c.score}/100`} aside={<span className="text-sm text-muted">Points = weight × value</span>}>
          <div className="scroll-x">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Legal basis</th>
                  <th>Measure</th>
                  <th>Value</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {c.criteria
                  .filter(k => k.applicable)
                  .map(k => (
                    <tr key={k.key}>
                      <td className="whitespace-nowrap font-bold">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-middle" style={{ background: SERIES[k.key] }} />
                        {k.label}
                      </td>
                      <td className="text-sm text-muted">{k.legalFactor}</td>
                      <td>{k.rawLabel}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 rounded-[4px] bg-sunken">
                            <div className="h-2 rounded-[4px]" style={{ width: `${k.value * 100}%`, background: SERIES[k.key] }} />
                          </div>
                          <span className="num text-sm">{k.value.toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="num text-right">{k.weight.toFixed(1)}</td>
                      <td className="num text-right font-bold">{k.contribution.toFixed(1)}</td>
                    </tr>
                  ))}
                <tr>
                  <td colSpan={5} className="text-right font-bold">
                    Suitability score
                  </td>
                  <td className="num text-right text-lg font-bold">{c.score.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {c.criteria.some(k => !k.applicable) && (
            <p className="mt-2 text-xs text-muted">
              Not applicable to this household (weight shared among the others):{' '}
              {c.criteria
                .filter(k => !k.applicable)
                .map(k => k.label)
                .join(', ')}
              .
            </p>
          )}
        </Section>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Journeys" aside={<span className="text-xs text-muted">Estimated, public transport</span>}>
          {c.journeys.length === 0 ? (
            <p className="text-muted">No places recorded for this household.</p>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>To</th>
                    <th className="text-right">Minutes</th>
                    <th className="text-right">km</th>
                  </tr>
                </thead>
                <tbody>
                  {c.journeys.map(j => (
                    <tr key={j.destinationId}>
                      <td className="whitespace-nowrap">{person(j.personId)}</td>
                      <td>{j.name}</td>
                      <td className="num text-right font-bold">{j.minutes ?? '—'}</td>
                      <td className="num text-right">{j.distanceKm}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} className="text-muted">
                      Last settled area ({s.household.homeAreaLabel})
                    </td>
                    <td className="num text-right">{c.homeAreaMinutes ?? '—'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Certificates and availability">
          <ul className="grid gap-2">
            {p.compliance.map(item => (
              <li key={item.type} className="flex flex-wrap justify-between gap-2 border-b border-rule pb-2 last:border-0">
                <span>
                  {complianceLabel(item.type)}
                  {item.rating ? ` · band ${item.rating}` : ''}
                </span>
                <span className="num text-sm text-muted">
                  {item.expires ? `valid to ${formatDate(item.expires)}` : item.issued ? `checked ${formatDate(item.issued)}` : 'on file'} ·{' '}
                  <span className="hash">{item.evidenceRef}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Available from {formatDate(p.availableFrom)}
            {p.availableUntil ? ` until ${formatDate(p.availableUntil)}` : ''}. Last confirmed {formatDateTime(p.availabilityConfirmedAt)} by{' '}
            {p.availabilityConfirmedBy}. Nightly charge {gbp(p.nightlyCharge, 2)}.
          </p>
        </Section>
      </div>

      <Section
        title="Cost, by who pays"
        aside={
          <span className="text-xs text-muted">
            {c.cost.stayNights} nights · {c.cost.schoolDaysInStay} school days
          </span>
        }
      >
        <div className="scroll-x">
          <table className="table min-w-[520px]">
            <thead>
              <tr>
                <th>Line</th>
                <th>Paid by</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Over the stay</th>
              </tr>
            </thead>
            <tbody>
              {c.cost.lines.map(l => (
                <tr key={l.key}>
                  <td>
                    {l.label}
                    <div className="text-xs text-faint">{l.basis}</div>
                  </td>
                  <td>{BUDGET_LABEL[l.budgetHolder]}</td>
                  <td className="num text-right whitespace-nowrap">
                    {gbp(l.perUnit, 2)}/{l.unit === 'night' ? 'night' : 'school day'}
                  </td>
                  <td className="num text-right">{gbp(l.stayTotal)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="text-right font-bold">
                  TA budget, net
                </td>
                <td className="num text-right font-bold">{gbp(c.cost.taBudgetStay)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="text-right">
                  Education
                </td>
                <td className="num text-right">{gbp(c.cost.educationStay)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="text-right">
                  Household
                </td>
                <td className="num text-right">{gbp(c.cost.householdStay)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {c.cost.risks.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm">
            {c.cost.risks.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="chip chip-bad shrink-0">Risk</span>
                {r}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Every check run">
        <GateList checks={c.checks} columns />
      </Section>
    </div>
  )
}
