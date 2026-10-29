import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { SCENARIOS } from '../../data/households'
import { daysBetween, formatDate, formatDateTime, toIsoDate } from '../../engine/dates'
import { PageHeader, Section } from '../bits'

const STEPS = [
  ['Enter the household’s needs', 'Who is in the household, the places that matter to them, must-haves and restrictions.'],
  ['The engine checks every property', 'Availability, size, access, safety certificates and policy first; then suitability and net cost.'],
  ['The officer decides', 'Accept the recommendation or choose another option and give the reason.'],
  ['The evidence is frozen', 'Every option, every rejection, the policy version and the decision go into a sealed record.'],
]

export function Home() {
  const { data } = useApp()
  const { go } = useNav()
  const today = toIsoDate(new Date())
  const decidedSearchIds = new Set(data.chain.map(r => r.snapshot.search.id))
  const pending = data.searches.filter(s => !decidedSearchIds.has(s.id)).slice(0, 5)
  const clocks = data.chain
    .flatMap(r => r.snapshot.clocks.map(c => ({ c, r })))
    .filter(x => x.c.status === 'open' && x.c.key !== 's202')
    .sort((a, b) => a.c.due.localeCompare(b.c.due))
    .slice(0, 8)

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Housing Needs · temporary accommodation"
        title="Placements"
        actions={
          <button className="btn btn-primary" onClick={() => go({ view: 'new' })}>
            New placement
          </button>
        }
      >
        Find the most suitable available placement for a household, see why, record the decision, and keep the evidence.
      </PageHeader>

      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="flex gap-3 rounded-lg border border-rule bg-surface p-3">
            <span className="display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">{i + 1}</span>
            <div className="min-w-0">
              <div className="font-bold">{t}</div>
              <div className="text-sm text-muted">{d}</div>
            </div>
          </li>
        ))}
      </ol>

      <Section title="Start from an example household" aside={<span className="text-sm text-muted">Invented households for the demo</span>}>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SCENARIOS.map(s => (
            <li key={s.id}>
              <button
                className="flex h-full w-full flex-col gap-1 rounded-lg border border-rule p-3 text-left hover:border-accent hover:bg-accent-soft/40"
                onClick={() => go({ view: 'new', scenarioId: s.id })}
              >
                <span className="font-bold">{s.title}</span>
                <span className="text-sm text-muted">{s.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Deadlines from placements">
          {clocks.length === 0 ? (
            <p className="text-muted">
              No open deadlines. They appear here after a decision is recorded: notices to other councils, the six-week limit, school and GP notifications.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>What</th>
                    <th>Case</th>
                  </tr>
                </thead>
                <tbody>
                  {clocks.map(({ c, r }) => {
                    const days = daysBetween(today, c.due)
                    return (
                      <tr key={`${r.seq}-${c.key}`}>
                        <td className="num whitespace-nowrap">
                          {formatDate(c.due)}
                          <div className={`text-xs ${days < 0 ? 'text-bad' : days <= 3 ? 'text-warn' : 'text-muted'}`}>
                            {days < 0 ? `${-days} days overdue` : days === 0 ? 'today' : `in ${days} days`}
                          </div>
                        </td>
                        <td>{c.label}</td>
                        <td className="whitespace-nowrap">
                          <button className="link" onClick={() => go({ view: 'decision', seq: r.seq })}>
                            {r.snapshot.search.household.caseRef}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Searches waiting for a decision">
          {pending.length === 0 ? (
            <p className="text-muted">None. Start a new placement or open an example household.</p>
          ) : (
            <ul className="grid gap-2">
              {pending.map(s => {
                const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
                return (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2 last:border-0">
                    <div className="min-w-0">
                      <button className="link" onClick={() => go({ view: 'results', searchId: s.id })}>
                        {s.household.caseRef}
                      </button>{' '}
                      <span className="text-sm text-muted">· {formatDateTime(s.createdAt)}</span>
                      <div className="text-sm text-muted">{rec ? `Recommended: ${rec.label} (${rec.score})` : 'No suitable option found'}</div>
                    </div>
                    <span className="text-sm text-muted">{s.candidates.filter(c => c.eligible).length} eligible</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Recent decisions">
        {data.chain.length === 0 ? (
          <p className="text-muted">No decisions recorded yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Decided</th>
                  <th>Case</th>
                  <th>Placement</th>
                  <th>Outcome</th>
                  <th>Officer</th>
                </tr>
              </thead>
              <tbody>
                {[...data.chain]
                  .reverse()
                  .slice(0, 10)
                  .map(r => {
                    const d = r.snapshot.decision
                    const chosen = r.snapshot.search.candidates.find(c => c.propertyId === d.chosenPropertyId)
                    return (
                      <tr key={r.seq}>
                        <td>
                          <button className="link num" onClick={() => go({ view: 'decision', seq: r.seq })}>
                            #{r.seq}
                          </button>
                        </td>
                        <td className="num whitespace-nowrap">{formatDateTime(d.decidedAt)}</td>
                        <td>{r.snapshot.search.household.caseRef}</td>
                        <td>{chosen?.label ?? '—'}</td>
                        <td>
                          {d.outcome === 'accepted' ? (
                            <span className="chip chip-good">Recommendation accepted</span>
                          ) : d.outcome === 'override' ? (
                            <span className="chip chip-warn">Officer chose another option</span>
                          ) : (
                            <span className="chip chip-bad">No suitable option</span>
                          )}
                        </td>
                        <td>{d.officer}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
