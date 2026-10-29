import { useEffect, useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDate, formatDateTime } from '../../engine/dates'
import { canonicalize } from '../../audit/canonical'
import type { ChainCheck } from '../../audit/chain'
import { TIER_LABEL } from '../../engine/scoring'
import { BUDGET_LABEL, CRITERIA_ORDER, UNIT_LABEL } from '../criteria'
import { OVERRIDE_REASONS } from './Decide'
import { gbp, IS_DEMO_BUILD } from '../bits'

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function AuditReport({ seq }: { seq: number }) {
  const { data, verify } = useApp()
  const { go } = useNav()
  const [check, setCheck] = useState<ChainCheck | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    verify().then(setCheck)
  }, [verify, data.chain])
  const r = data.chain.find(x => x.seq === seq)
  if (!r) return <p>Record #{seq} not found.</p>
  const { search: s, decision: d, ruleset: rs, clocks, properties } = r.snapshot
  const eligible = s.candidates.filter(c => c.eligible).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const rejected = s.candidates.filter(c => !c.eligible)
  const chosen = s.candidates.find(c => c.propertyId === d.chosenPropertyId)
  const prop = properties.find(p => p.id === d.chosenPropertyId)
  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
  const person = (id: string) => s.household.members.find(m => m.id === id)?.label ?? id
  const intact = check ? check.ok || (check.brokenAt !== undefined && check.brokenAt > r.seq) : null
  const json = JSON.stringify({ seq: r.seq, prevHash: r.prevHash, rowHash: r.rowHash, snapshot: r.snapshot }, null, 2)

  async function pdf() {
    setPdfBusy(true)
    try {
      const { renderAuditPdf } = await import('../../pdf/AuditPdf')
      downloadBlob(`placement-decision-${r!.seq}-${s.household.caseRef}.pdf`, await renderAuditPdf(r!))
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn" onClick={() => go({ view: 'decision', seq })}>
          Back to the decision
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {!IS_DEMO_BUILD && (
            <>
              <button className="btn btn-primary" onClick={pdf} disabled={pdfBusy}>
                {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
              </button>
              <button className="btn" onClick={() => downloadBlob(`placement-decision-${r.seq}.json`, new Blob([json], { type: 'application/json' }))}>
                Download record (JSON)
              </button>
            </>
          )}
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(json)
                setCopied('Record copied as JSON')
              } catch {
                setCopied('Copy is blocked here: use the hosted app to download')
              }
            }}
          >
            Copy record (JSON)
          </button>
          {copied && <span className="text-sm text-muted">{copied}</span>}
        </div>
      </div>
      {IS_DEMO_BUILD && <p className="text-sm text-muted">PDF and file downloads work in the hosted app; this shared demo cannot save files.</p>}

      <article className="doc panel mx-auto w-full max-w-[880px] p-5 sm:p-8">
        <header className="grid gap-3 border-b-2 border-ink pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{rs.councilName} · Housing Needs</div>
              <h1 className="display text-2xl">Placement decision record</h1>
            </div>
            <div className="text-right text-sm">
              <div className="num font-bold">Record #{r.seq}</div>
              <div>Case {s.household.caseRef}</div>
              <div className="num text-muted">Sealed {formatDateTime(r.snapshot.frozenAt)}</div>
            </div>
          </div>
          <div className={`rounded-md px-3 py-2 text-sm ${intact === null ? 'bg-sunken' : intact ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
            {intact === null
              ? 'Checking the seal…'
              : intact
                ? `Seal intact: this record matches its hash and links to the records before it (${check!.checked} checked).`
                : `Seal broken: ${check!.reason}. This record cannot be relied on.`}
          </div>
          <p className="text-sm text-muted">
            SYNTHETIC DEMO DATA. Invented household and properties. Decision support only: the officer named below made the decision.
          </p>
        </header>

        <h2>1. Decision</h2>
        <table className="table mt-2">
          <tbody>
            <tr>
              <td className="w-48 text-muted">Outcome</td>
              <td>
                {d.outcome === 'accepted'
                  ? 'Recommendation accepted'
                  : d.outcome === 'override'
                    ? 'Officer chose another option'
                    : 'No suitable option available'}
              </td>
            </tr>
            <tr>
              <td className="text-muted">Placement</td>
              <td>{chosen && prop ? `${chosen.label}, ${prop.address}` : '—'}</td>
            </tr>
            <tr>
              <td className="text-muted">Starts</td>
              <td className="num">{chosen ? formatDate(d.startDate) : '—'}</td>
            </tr>
            <tr>
              <td className="text-muted">Decided by</td>
              <td>
                {d.officer}, {d.officerRole}, {formatDateTime(d.decidedAt)}
              </td>
            </tr>
            {d.outcome === 'override' && (
              <tr>
                <td className="text-muted">Recommended instead</td>
                <td>{rec?.label}</td>
              </tr>
            )}
            {d.overrideReason && (
              <tr>
                <td className="text-muted">Reason</td>
                <td>{OVERRIDE_REASONS.find(([k]) => k === d.overrideReason)?.[1]}</td>
              </tr>
            )}
            {d.reasonText && (
              <tr>
                <td className="text-muted">{d.outcome === 'no_suitable' ? 'Search steps' : 'Officer’s words'}</td>
                <td>“{d.reasonText}”</td>
              </tr>
            )}
            <tr>
              <td className="text-muted">Review before deciding</td>
              <td>
                Opened all options {formatDateTime(d.reviewed.resultsOpenedAt)}; details opened:{' '}
                {d.reviewed.propertiesOpened.length
                  ? d.reviewed.propertiesOpened.map(id => s.candidates.find(c => c.propertyId === id)?.label ?? id).join(', ')
                  : 'none'}
                ; comparison {d.reviewed.comparisonOpened ? 'opened' : 'not opened'}; officer confirmed reviewing {eligible.length} eligible and{' '}
                {rejected.length} ruled-out options: {d.reviewed.confirmedFullListReviewed ? 'yes' : 'no'}.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>2. Household needs</h2>
        <p className="mt-2 text-sm">
          Needed from {formatDate(s.household.needFrom)} for about {s.household.expectedNights} nights. Last settled area: {s.household.homeAreaLabel}. Bedroom
          need: {s.bedroomNeed}. Must-haves: {s.household.accessNeeds.length ? s.household.accessNeeds.join(', ').replaceAll('_', ' ') : 'none'}
          {s.household.petsMustBeAccommodated ? '; pet or assistance dog' : ''}. Priority flags:{' '}
          {s.household.flags.length ? s.household.flags.join(', ').replaceAll('_', ' ') : 'none'}. Safeguarding exclusion zones:{' '}
          {s.household.safeguardingZones.length} (details restricted). Affordable charges: {gbp(s.household.maxHouseholdContributionWeekly)}/week.
        </p>
        <div className="scroll-x">
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Person</th>
                <th>Age</th>
                <th>Places that matter</th>
              </tr>
            </thead>
            <tbody>
              {s.household.members.map(m => (
                <tr key={m.id}>
                  <td>
                    {m.label}
                    <div className="text-xs text-muted">
                      {[m.pregnant && 'pregnant', m.examYear && 'exam year', m.send && 'SEND', m.employed && 'in work', m.wheelchairUser && 'wheelchair user']
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  </td>
                  <td className="num">{m.age}</td>
                  <td>
                    {s.household.destinations
                      .filter(x => x.personId === m.id)
                      .map(x => `${x.name} (arrive ${x.arriveBy}, ${x.daysPerWeek} days/week)`)
                      .join('; ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.household.notes && <p className="mt-2 text-sm">Notes: {s.household.notes}</p>}

        <h2>3. Policy applied</h2>
        <p className="mt-2 text-sm">
          {rs.name}, version {rs.version}, effective {formatDate(rs.effectiveFrom)}. Signed off by {rs.signOff.by} ({rs.signOff.role}) on{' '}
          {formatDate(rs.signOff.at)}. {rs.signOff.equalityNote}
        </p>
        <p className="hash mt-1 break-all text-muted">Policy hash {rs.hash}</p>
        <div className="scroll-x">
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Factor</th>
                <th>Legal basis</th>
                <th className="text-right">Base weight</th>
                <th className="text-right">For this household</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA_ORDER.map(k => {
                const base = rs.criteria.find(c => c.key === k.key)!
                return (
                  <tr key={k.key}>
                    <td>{base.label}</td>
                    <td className="text-sm text-muted">{base.legalFactor}</td>
                    <td className="num text-right">{base.weight}</td>
                    <td className="num text-right">{s.effectiveWeights[k.key] > 0 ? s.effectiveWeights[k.key].toFixed(1) : 'n/a'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <h2>4. Recommendation</h2>
        <p className="mt-2 font-bold">{s.explanation.headline}</p>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {[...s.explanation.reasons, ...s.explanation.cost, ...s.explanation.caveats].map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        <p className="mt-1 text-sm text-muted">
          Sensitivity:{' '}
          {s.sensitivity.status === 'robust'
            ? 'the recommendation holds when any weight moves by 20%'
            : s.sensitivity.status === 'close_call'
              ? `close call (${s.sensitivity.flips.length} weight changes alter it)`
              : 'not applicable'}
          .{s.tieBreakApplied ? ' The cost tie-break was applied.' : ''}
        </p>

        <h2>5. Options considered ({eligible.length} eligible)</h2>
        <div className="scroll-x">
          <table className="table mt-2 min-w-[600px]">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Property</th>
                <th>Location</th>
                <th className="text-right">Score</th>
                <th className="text-right">TA £/night</th>
                <th className="text-right">Public cost of stay</th>
              </tr>
            </thead>
            <tbody>
              {eligible.map(c => (
                <tr key={c.propertyId}>
                  <td className="num">{c.rank}</td>
                  <td>
                    {c.label}
                    {c.propertyId === s.recommendedId ? ' (recommended)' : ''}
                    {c.propertyId === d.chosenPropertyId ? ' (chosen)' : ''}
                    {c.lastResort ? ' (last resort)' : ''}
                  </td>
                  <td>
                    {c.district}, {TIER_LABEL[c.tier].toLowerCase()}
                  </td>
                  <td className="num text-right">{c.score.toFixed(1)}</td>
                  <td className="num text-right">{gbp(c.cost.taNetPerNight, 2)}</td>
                  <td className="num text-right">{gbp(c.cost.publicStay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>6. Options ruled out ({rejected.length})</h2>
        <div className="scroll-x">
          <table className="table mt-2 min-w-[600px]">
            <tbody>
              {rejected.map(c => (
                <tr key={c.propertyId}>
                  <td className="w-56">
                    {c.label}
                    <div className="text-xs text-muted">{c.district}</div>
                  </td>
                  <td className="text-sm">{c.blocks.map(b => b.message).join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {chosen && prop && (
          <>
            <h2>7. Evidence for the chosen property</h2>
            <p className="mt-2 text-sm">
              {UNIT_LABEL[prop.unitType]}, {prop.bedrooms} bedrooms, sleeps {prop.maxOccupants}. UPRN {prop.uprn}. Availability confirmed{' '}
              {formatDateTime(prop.availabilityConfirmedAt)} by {prop.availabilityConfirmedBy}.
            </p>
            <h3>Checks</h3>
            <ul className="mt-1 grid gap-0.5 text-sm">
              {chosen.checks.map((c, i) => (
                <li key={i}>
                  {c.severity === 'warn' ? '!' : c.passed ? '✓' : '✕'} {c.message} <span className="text-muted">({c.legalBasis})</span>
                </li>
              ))}
            </ul>
            <h3>Journeys (estimated)</h3>
            <ul className="mt-1 grid gap-0.5 text-sm">
              {chosen.journeys.map(j => (
                <li key={j.destinationId}>
                  {person(j.personId)} → {j.name}: {j.minutes ?? '—'} min, {j.distanceKm} km
                </li>
              ))}
            </ul>
            <h3>Cost</h3>
            <ul className="mt-1 grid gap-0.5 text-sm">
              {chosen.cost.lines.map(l => (
                <li key={l.key}>
                  {l.label} ({BUDGET_LABEL[l.budgetHolder]}): {gbp(l.perUnit, 2)}/{l.unit} → {gbp(l.stayTotal)} over the stay.{' '}
                  <span className="text-muted">{l.basis}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {clocks.length > 0 && (
          <>
            <h2>8. Deadlines</h2>
            <ul className="mt-2 grid gap-0.5 text-sm">
              {clocks.map(c => (
                <li key={c.key}>
                  <b className="num">{formatDate(c.due)}</b>: {c.label}. <span className="text-muted">{c.basis}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>9. Method, data and seal</h2>
        <ul className="mt-2 grid gap-1 text-sm">
          <li>
            Journeys: {s.travelProvider.label}. {s.travelProvider.assumptions}. {s.travelProvider.disclaimer}
          </li>
          <li>
            Data: {s.dataVersions.properties}; {s.dataVersions.reference}.
          </li>
          <li>Subsidy figures: {rs.subsidy.source}</li>
          <li>
            Record {r.seq}: <span className="hash break-all">{r.rowHash}</span>
          </li>
          <li>
            Previous record: <span className="hash break-all">{r.prevHash}</span>
          </li>
          <li>
            Canonical record size: <span className="num">{canonicalize(r.snapshot).length.toLocaleString('en-GB')}</span> characters
          </li>
        </ul>
      </article>
    </div>
  )
}
