import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { SCENARIOS } from '../../data/households'
import { daysBetween, formatDate, formatDateTime, parseDate, toIsoDate } from '../../engine/dates'
import { requiredCompliance } from '../../engine/gates'
import { PageHeader, Section } from '../bits'
import { Icon } from '../icons'

const OUTCOME = {
  accepted: <span className="chip chip-good">Accepted</span>,
  override: <span className="chip chip-warn">Override</span>,
  no_suitable: <span className="chip chip-bad">None suitable</span>,
} as const

function Composition({ adults, children }: { adults: number; children: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Icon name="users" size={14} />
      {adults} adult{adults === 1 ? '' : 's'}
      {children > 0 && ` · ${children} child${children === 1 ? '' : 'ren'}`}
    </span>
  )
}

export function Home() {
  const { data, activeRuleset } = useApp()
  const { go } = useNav()
  const today = toIsoDate(new Date())
  const todayDate = parseDate(today)
  const decidedSearchIds = new Set(data.chain.map(r => r.snapshot.search.id))
  const pending = data.searches.filter(s => !decidedSearchIds.has(s.id)).slice(0, 5)
  const clocks = data.chain
    .flatMap(r => r.snapshot.clocks.map(c => ({ c, r })))
    .filter(x => x.c.status === 'open' && x.c.key !== 's202')
    .sort((a, b) => a.c.due.localeCompare(b.c.due))
  const decisions = data.chain.length
  const accepted = data.chain.filter(r => r.snapshot.decision.outcome === 'accepted').length
  const bookable = data.properties.filter(p => {
    if (parseDate(p.availableFrom) > todayDate) return false
    const sup = data.suppliers.find(s => s.id === p.supplierId)
    if (!sup?.approved) return false
    return requiredCompliance(p, activeRuleset).every(t => {
      const c = p.compliance.find(x => x.type === t)
      return c && (!c.expires || parseDate(c.expires) >= todayDate)
    })
  }).length

  const stats = [
    { label: 'Available and compliant today', value: `${bookable}`, sub: `of ${data.properties.length} properties held` },
    {
      label: 'Decisions recorded',
      value: `${decisions}`,
      sub: decisions ? `${data.chain.filter(r => r.snapshot.decision.outcome === 'override').length} overrides` : 'none yet',
    },
    { label: 'Recommendation accepted', value: decisions ? `${Math.round((accepted / decisions) * 100)}%` : '—', sub: 'healthy range 30–90%' },
    { label: 'Open deadlines', value: `${clocks.length}`, sub: clocks[0] ? `next ${formatDate(clocks[0].c.due)}` : 'nothing due' },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Housing Needs · temporary accommodation"
        title="Overview"
        actions={
          <button className="btn btn-primary" onClick={() => go({ view: 'new' })}>
            <Icon name="plus" size={16} />
            New placement
          </button>
        }
      >
        Find the most suitable placement for a household, see why, record the decision and keep the evidence.
      </PageHeader>

      <div className="panel grid grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`stat px-5 py-4 ${i > 0 ? 'border-rule lg:border-l' : ''} ${i % 2 === 1 ? 'border-l border-rule' : ''} ${i >= 2 ? 'border-t border-rule lg:border-t-0' : ''}`}
          >
            <span className="text-xs font-medium text-muted">{s.label}</span>
            <span className="stat-value">{s.value}</span>
            <span className="text-xs text-faint">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Section title="Start from an example household" description="Invented households that show how the engine handles different situations." flush>
          <ul className="divide-y divide-[var(--rule)]">
            {SCENARIOS.map(s => {
              const h = s.household(today)
              const adults = h.members.filter(m => m.role === 'adult').length
              return (
                <li key={s.id}>
                  <button
                    className="group flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-[var(--hover)] sm:px-5"
                    onClick={() => go({ view: 'new', scenarioId: s.id })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold">{s.title}</span>
                        <Composition adults={adults} children={h.members.length - adults} />
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{s.summary}</span>
                    </span>
                    <Icon
                      name="arrow-right"
                      size={17}
                      className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>

        <div className="grid content-start gap-6">
          <Section title="Upcoming deadlines" aside={clocks.length > 0 && <span className="num">{clocks.length} open</span>} flush>
            {clocks.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted sm:px-5">
                Deadlines appear here once a decision is recorded: notices to other councils, the six-week limit for families, school and GP notifications.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--rule)]">
                {clocks.slice(0, 6).map(({ c, r }) => {
                  const days = daysBetween(today, c.due)
                  return (
                    <li key={`${r.seq}-${c.key}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                      <span
                        className="num mt-0.5 flex w-12 shrink-0 flex-col items-center rounded-md border border-rule py-1 text-center leading-tight"
                        style={days <= 3 ? { borderColor: days < 0 ? 'var(--bad)' : 'var(--warn)' } : undefined}
                      >
                        <span className="text-[0.95rem] font-semibold">{parseDate(c.due).getUTCDate()}</span>
                        <span className="text-[0.65rem] tracking-wide text-faint uppercase">{formatDate(c.due).split(' ')[1]}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{c.label}</span>
                        <span className="text-xs text-muted">
                          <button className="link text-xs" onClick={() => go({ view: 'decision', seq: r.seq })}>
                            {r.snapshot.search.household.caseRef}
                          </button>{' '}
                          · {days < 0 ? `${-days} days overdue` : days === 0 ? 'due today' : `in ${days} days`}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <Section title="Waiting for a decision" flush>
            {pending.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted sm:px-5">No open searches.</p>
            ) : (
              <ul className="divide-y divide-[var(--rule)]">
                {pending.map(s => {
                  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
                  return (
                    <li key={s.id}>
                      <button
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--hover)] sm:px-5"
                        onClick={() => go({ view: 'results', searchId: s.id })}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{s.household.caseRef}</span>
                          <span className="block truncate text-xs text-muted">
                            {rec ? `Recommended ${rec.label} · ${rec.score.toFixed(0)}/100` : 'No suitable option found'} · {formatDateTime(s.createdAt)}
                          </span>
                        </span>
                        <Icon name="arrow-right" size={16} className="shrink-0 text-faint" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <Section
        title="Recent decisions"
        aside={
          data.chain.length > 0 && (
            <button className="link text-sm" onClick={() => go({ view: 'audit' })}>
              Open audit log
            </button>
          )
        }
        flush
      >
        {data.chain.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">No decisions recorded yet. Try an example household above.</p>
        ) : (
          <div className="scroll-x">
            <table className="table min-w-[680px]">
              <thead>
                <tr>
                  <th className="pl-5">Record</th>
                  <th>Case</th>
                  <th>Placement</th>
                  <th>Outcome</th>
                  <th>Officer</th>
                  <th>Decided</th>
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
                      <tr key={r.seq} className="cursor-pointer" onClick={() => go({ view: 'decision', seq: r.seq })}>
                        <td className="num pl-5 font-semibold text-accent">#{r.seq}</td>
                        <td>{r.snapshot.search.household.caseRef}</td>
                        <td>{chosen?.label ?? '—'}</td>
                        <td>{OUTCOME[d.outcome]}</td>
                        <td>{d.officer}</td>
                        <td className="num whitespace-nowrap text-muted">{formatDateTime(d.decidedAt)}</td>
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
