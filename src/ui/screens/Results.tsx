import { useEffect, useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDate, formatDateTime } from '../../engine/dates'
import { rejectionSummary } from '../../engine/explain'
import { CRITERIA_ORDER } from '../criteria'
import { FactorLegend, gbp, PageHeader, ScatterPlot, ScoreBar, ScoreRing, Section, TierTag } from '../bits'
import { Icon } from '../icons'
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

  const hh = s.household
  const adults = hh.members.filter(m => m.role === 'adult').length
  const kids = hh.members.length - adults
  const facts = [
    `${adults} adult${adults === 1 ? '' : 's'}${kids ? `, ${kids} child${kids === 1 ? '' : 'ren'}` : ''}`,
    `${s.bedroomNeed} bedroom${s.bedroomNeed === 1 ? '' : 's'}`,
    `${hh.expectedNights} nights from ${formatDate(hh.needFrom)}`,
    hh.homeAreaLabel,
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={`Case ${hh.caseRef} · searched ${formatDateTime(s.createdAt)}`}
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
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {facts.map(f => (
            <span key={f}>{f}</span>
          ))}
        </span>
      </PageHeader>

      {decided && (
        <div
          className="callout flex flex-wrap items-center gap-2 text-sm"
          style={{ background: 'var(--good-soft)', borderColor: 'transparent', color: 'var(--good)' }}
        >
          <Icon name="check" size={16} />
          Decision recorded as #{decided.seq}.
          <button className="link" onClick={() => go({ view: 'decision', seq: decided.seq })}>
            Open the decision
          </button>
        </div>
      )}

      <section className="panel overflow-hidden" aria-labelledby="rec-h">
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3"
          style={{ background: rec ? 'var(--accent-soft)' : 'var(--bad-soft)' }}
        >
          <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: rec ? 'var(--accent)' : 'var(--bad)' }}>
            <Icon name={rec ? 'check' : 'alert'} size={16} />
            {rec ? 'Recommendation' : 'No suitable option'}
          </span>
          <span className="num text-sm text-muted">
            {s.candidates.length} checked · <b className="text-ink">{eligible.length} eligible</b> · {rejected.length} ruled out
          </span>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div className="max-w-3xl min-w-0">
            <h2 id="rec-h" className="display text-[1.45rem] leading-snug">
              {s.explanation.headline}
            </h2>
            <ul className="mt-3 grid gap-2.5">
              {s.explanation.reasons.map((r, i) => (
                <li key={i} className="flex gap-2.5">
                  <Icon name="check" size={16} className="mt-1 shrink-0 text-accent" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            {s.explanation.cost.length > 0 && (
              <div className="callout mt-4">
                <div className="eyebrow mb-1.5">Cost, by who pays</div>
                <ul className="grid gap-1 text-[0.92rem]">
                  {s.explanation.cost.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.explanation.caveats.length > 0 && (
              <ul className="mt-4 grid gap-2">
                {s.explanation.caveats.map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warn" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              {rec && !decided && (
                <button className="btn btn-primary" onClick={() => go({ view: 'decide', searchId, propertyId: rec.propertyId })}>
                  Review and record decision
                  <Icon name="arrow-right" size={16} />
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
          </div>
          {rec && (
            <div className="grid content-start gap-4 rounded-xl border border-rule p-4">
              <div className="flex items-center gap-4">
                <ScoreRing score={rec.score} />
                <div>
                  <div className="text-xs font-medium text-muted">Suitability</div>
                  <div className="text-sm text-muted">out of 100</div>
                </div>
              </div>
              <div className="border-t border-rule pt-3">
                <div className="text-xs font-medium text-muted">TA budget after subsidy</div>
                <div className="num text-lg font-semibold">
                  {gbp(rec.cost.taNetPerNight, 2)} <span className="text-sm font-normal text-muted">a night</span>
                </div>
              </div>
              <div className="border-t border-rule pt-3">
                <TierTag tier={rec.tier} district={rec.district} />
              </div>
              <div className="grid gap-1 border-t border-rule pt-3">
                {s.sensitivity.status === 'robust' && (
                  <span className="flex items-start gap-1.5 text-sm text-good">
                    <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
                    Robust: holds if any weight moves 20%
                  </span>
                )}
                {s.sensitivity.status === 'close_call' && (
                  <span className="flex items-start gap-1.5 text-sm text-warn">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                    Close call: some weight changes flip it
                  </span>
                )}
                {s.tieBreakApplied && (
                  <span className="text-xs text-muted">
                    Cost tie-break applied (within {data.rulesets.find(r => r.hash === s.rulesetHash)?.costTieBreakBand ?? 3} points)
                  </span>
                )}
              </div>
            </div>
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
        <Section
          title={`Eligible options (${eligible.length})`}
          description="Ranked by suitability. Hover a bar to see each factor's points."
          aside={<FactorLegend keys={applicable} />}
          flush
        >
          <div className="scroll-x">
            <table className="table min-w-[840px]">
              <thead>
                <tr>
                  <th className="pl-5">Rank</th>
                  <th>Property</th>
                  <th className="w-[26%]">Suitability, by factor</th>
                  <th className="text-right">TA / night</th>
                  <th className="text-right">Education / day</th>
                  <th className="text-right">Public, whole stay</th>
                  <th className="pr-5">Compare</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map(c => {
                  const isRec = c.propertyId === s.recommendedId
                  const edu = c.cost.lines.filter(l => l.budgetHolder === 'education').reduce((a, l) => a + l.perUnit, 0)
                  return (
                    <tr key={c.propertyId} style={isRec ? { background: 'color-mix(in oklab, var(--accent-soft) 60%, transparent)' } : undefined}>
                      <td className="pl-5">
                        <span
                          className="num flex h-7 w-7 items-center justify-center rounded-full text-[0.8rem] font-semibold"
                          style={isRec ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--sunken)', color: 'var(--muted)' }}
                        >
                          {c.rank}
                        </span>
                      </td>
                      <td className="min-w-[230px]">
                        <button className="link text-left text-ink" onClick={() => openProperty(c.propertyId)}>
                          {c.label}
                        </button>
                        <div className="mt-0.5">
                          <TierTag tier={c.tier} district={c.district} compact />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1 empty:hidden">
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
          <p className="border-t border-rule px-5 py-3 text-xs text-muted">
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
          <summary className="cursor-pointer text-sm font-semibold text-accent">Show every ruled-out property and why</summary>
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
                            <span className="inline-flex gap-1.5">
                              <Icon name="x" size={14} className="mt-1 shrink-0 text-bad" />
                              {b.message}
                            </span>
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
