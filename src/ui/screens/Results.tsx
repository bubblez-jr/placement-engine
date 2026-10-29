import { useEffect, useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDateTime } from '../../engine/dates'
import { rejectionSummary } from '../../engine/explain'
import { CRITERIA_ORDER } from '../criteria'
import { FactorLegend, gbp, PageHeader, ScatterPlot, ScoreBar, Section, TierChip } from '../bits'
import { MiniMap } from '../MiniMap'
import { shortHash } from '../../audit/hash'

export function Results({ searchId }: { searchId: string }) {
  const { getSearch, data, noteReview } = useApp()
  const { go } = useNav()
  const s = getSearch(searchId)
  const [compare, setCompare] = useState<string[]>([])
  useEffect(() => {
    noteReview(searchId, {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId])
  if (!s) return <p>Search not found. It may have been cleared when the demo was reset.</p>

  const eligible = s.candidates.filter(c => c.eligible).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const rejected = s.candidates.filter(c => !c.eligible)
  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
  const decided = data.chain.find(r => r.snapshot.search.id === s.id)
  const applicable = CRITERIA_ORDER.filter(k => s.effectiveWeights[k.key] > 0)
  const openProperty = (pid: string) => go({ view: 'property', searchId, propertyId: pid })
  const toggle = (pid: string) => setCompare(c => (c.includes(pid) ? c.filter(x => x !== pid) : c.length >= 3 ? [...c.slice(1), pid] : [...c, pid]))
  const compareIds = compare.length >= 2 ? compare : eligible.slice(0, 3).map(c => c.propertyId)

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={`Case ${s.household.caseRef} · searched ${formatDateTime(s.createdAt)}`}
        title="Placement options"
        actions={
          <>
            <button className="btn" onClick={() => go({ view: 'new', fromSearchId: s.id })}>
              Edit needs
            </button>
            {eligible.length >= 2 && (
              <button className="btn" onClick={() => go({ view: 'compare', searchId, ids: compareIds })}>
                Compare {compare.length >= 2 ? `${compare.length} selected` : 'top options'}
              </button>
            )}
          </>
        }
      >
        {s.candidates.length} properties checked · <b>{eligible.length} eligible</b> · household needs {s.bedroomNeed} bedroom{s.bedroomNeed === 1 ? '' : 's'}{' '}
        for {s.household.expectedNights} nights
      </PageHeader>

      {decided && (
        <p className="rounded-md border border-good bg-good-soft px-3 py-2 text-good">
          Decision recorded as #{decided.seq}.{' '}
          <button className="link" onClick={() => go({ view: 'decision', seq: decided.seq })}>
            Open the decision
          </button>
        </p>
      )}

      <section className="panel border-2 p-4 sm:p-5" style={{ borderColor: rec ? 'var(--accent)' : 'var(--bad)' }} aria-labelledby="rec-h">
        <div className="eyebrow mb-1">{rec ? 'Recommendation' : 'No recommendation'}</div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 max-w-3xl">
            <h2 id="rec-h" className="display text-2xl">
              {s.explanation.headline}
            </h2>
            <ul className="mt-3 grid gap-2">
              {s.explanation.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {s.explanation.cost.length > 0 && (
              <div className="mt-3 rounded-md bg-sunken p-3">
                <div className="eyebrow mb-1">Cost, by who pays</div>
                <ul className="grid gap-1">
                  {s.explanation.cost.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.explanation.caveats.length > 0 && (
              <ul className="mt-3 grid gap-1.5">
                {s.explanation.caveats.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="chip chip-warn shrink-0">Check</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {rec && (
            <div className="grid gap-3 rounded-lg bg-accent-soft p-3">
              <div>
                <div className="eyebrow">Suitability</div>
                <div className="display text-3xl text-accent">
                  {rec.score.toFixed(0)}
                  <span className="text-base text-muted">/100</span>
                </div>
              </div>
              <div>
                <div className="eyebrow">TA budget, after subsidy</div>
                <div className="num text-lg font-bold">{gbp(rec.cost.taNetPerNight, 2)} a night</div>
              </div>
              <div>
                {s.sensitivity.status === 'robust' && <span className="chip chip-good !whitespace-normal">Robust: holds if any weight moves 20%</span>}
                {s.sensitivity.status === 'close_call' && <span className="chip chip-warn !whitespace-normal">Close call: weight changes flip it</span>}
                {s.tieBreakApplied && (
                  <div className="mt-1 text-xs text-muted">
                    Cost tie-break applied (within {data.rulesets.find(r => r.hash === s.rulesetHash)?.costTieBreakBand ?? 3} points)
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {rec && !decided && (
            <button className="btn btn-primary" onClick={() => go({ view: 'decide', searchId, propertyId: rec.propertyId })}>
              Review and record decision
            </button>
          )}
          {!rec && !decided && (
            <button className="btn btn-primary" onClick={() => go({ view: 'decide', searchId })}>
              Record that nothing suitable is available
            </button>
          )}
          {rec && (
            <button className="btn" onClick={() => openProperty(rec.propertyId)}>
              Why this property
            </button>
          )}
        </div>
      </section>

      {eligible.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Where the options are">
            <MiniMap household={s.household} candidates={s.candidates} properties={data.properties} recommendedId={s.recommendedId} onPick={openProperty} />
          </Section>
          <Section title="Suitability against public cost">
            <ScatterPlot candidates={s.candidates} recommendedId={s.recommendedId} onPick={openProperty} />
          </Section>
        </div>
      )}

      {eligible.length > 0 && (
        <Section title={`Eligible options (${eligible.length})`} aside={<FactorLegend keys={applicable} />}>
          <div className="scroll-x">
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Property</th>
                  <th className="w-[30%]">Suitability, by factor</th>
                  <th className="text-right">TA budget / night</th>
                  <th className="text-right">Education / school day</th>
                  <th className="text-right">Public cost of stay</th>
                  <th>Compare</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map(c => {
                  const isRec = c.propertyId === s.recommendedId
                  const edu = c.cost.lines.filter(l => l.budgetHolder === 'education').reduce((a, l) => a + l.perUnit, 0)
                  return (
                    <tr key={c.propertyId} style={isRec ? { background: 'var(--accent-soft)' } : undefined}>
                      <td className="num font-bold">{c.rank}</td>
                      <td className="min-w-0">
                        <button className="link text-left" onClick={() => openProperty(c.propertyId)}>
                          {c.label}
                        </button>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <TierChip tier={c.tier} district={c.district} />
                          {isRec && <span className="chip chip-accent">Recommended</span>}
                          {c.lastResort && <span className="chip chip-bad">Last resort</span>}
                          {c.pareto && !isRec && (
                            <span className="chip chip-plain" title="No other option is both more suitable and cheaper">
                              Best trade-off
                            </span>
                          )}
                          {c.warnings.length > 0 && (
                            <span className="chip chip-warn" title={c.warnings.map(w => w.message).join('\n')}>
                              {c.warnings.length} to check
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <ScoreBar criteria={c.criteria} score={c.score} />
                      </td>
                      <td className="num text-right">{gbp(c.cost.taNetPerNight, 2)}</td>
                      <td className="num text-right">{edu > 0 ? gbp(edu, 2) : '—'}</td>
                      <td className="num text-right">{gbp(c.cost.publicStay)}</td>
                      <td>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input id={`cmp-${c.propertyId}`} type="checkbox" checked={compare.includes(c.propertyId)} onChange={() => toggle(c.propertyId)} />
                          <span className="sr-only">Compare {c.label}</span>
                        </label>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            TA budget is the nightly charge less the housing benefit subsidy the council can reclaim. Education is home-to-school travel the council funds under
            its policy. Public cost of stay = both, over {s.household.expectedNights} nights.
          </p>
        </Section>
      )}

      <Section
        title={`Ruled out by the checks (${rejected.length})`}
        aside={<span className="text-sm text-muted">{rejectionSummary(s.candidates).slice(0, 4).join(' · ')}</span>}
      >
        <details>
          <summary className="cursor-pointer font-bold text-accent">Show every ruled-out property and why</summary>
          <div className="scroll-x mt-3">
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Where</th>
                  <th>Why it was ruled out</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map(c => (
                  <tr key={c.propertyId}>
                    <td>
                      <button className="link text-left" onClick={() => openProperty(c.propertyId)}>
                        {c.label}
                      </button>
                    </td>
                    <td className="whitespace-nowrap">{c.district}</td>
                    <td>
                      <ul className="grid gap-0.5">
                        {c.blocks.map((b, i) => (
                          <li key={i}>
                            <span className="text-bad">✕</span> {b.message}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>

      <p className="text-xs leading-relaxed text-faint">
        {s.travelProvider.disclaimer} {s.travelProvider.assumptions}. Policy v{s.rulesetVersion} <span className="hash">{shortHash(s.rulesetHash)}</span> ·{' '}
        {s.dataVersions.properties}.
      </p>
    </div>
  )
}
