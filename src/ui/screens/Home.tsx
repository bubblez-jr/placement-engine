import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { SCENARIOS } from '../../data/households'
import { formatDateTime, parseDate, ukDate } from '../../engine/dates'
import { requiredCompliance } from '../../engine/gates'
import { check } from '../../engine/permissions'
import { isMine } from '../../engine/tasks'
import { decisionRecords, deciderOf } from '../../audit/records'
import { useUser } from '../../auth/session'
import { PageHeader, Section } from '../bits'
import { Icon } from '../icons'
import { ApprovalChip, StateChip, TaskList } from '../placement'
import { useApprovalQueue } from './Approvals'

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
  const { data, activeRuleset, now, tasks, placements, occupancy } = useApp()
  const { go } = useNav()
  const user = useUser()
  const today = ukDate(now)
  const todayDate = parseDate(today)
  const decisions = decisionRecords(data.chain)
  const decidedSearchIds = new Set(decisions.map(r => r.snapshot.search.id))
  const pending = data.searches.filter(s => !decidedSearchIds.has(s.id)).slice(0, 5)
  const mine = tasks.filter(t => t.status === 'open' && isMine(t, user))
  const late = mine.filter(t => t.escalation === 'overdue' || t.escalation === 'escalated').length
  const canApprove = check(user, 'approve_exception').ok
  const waiting = useApprovalQueue().filter(x => x.a.status === 'awaiting' || x.a.status === 'out_of_hours')
  const occupiedToday = new Set(occupancy.filter(o => o.from <= today && (o.to === null || o.to > today)).map(o => o.propertyId))
  const decided = decisions.length
  const accepted = decisions.filter(r => r.snapshot.decision.outcome === 'accepted').length
  const bookable = data.properties.filter(p => {
    if (parseDate(p.availableFrom) > todayDate) return false
    if (occupiedToday.has(p.id)) return false
    const sup = data.suppliers.find(s => s.id === p.supplierId)
    if (!sup?.approved) return false
    return requiredCompliance(p, activeRuleset).every(t => {
      const c = p.compliance.find(x => x.type === t)
      return c && (!c.expires || parseDate(c.expires) >= todayDate)
    })
  }).length

  const stats = [
    { label: 'Free and compliant today', value: `${bookable}`, sub: `of ${data.properties.length} properties; ${occupiedToday.size} held or occupied` },
    {
      label: 'Decisions recorded',
      value: `${decided}`,
      sub: decided ? (n => `${n} override${n === 1 ? '' : 's'}`)(decisions.filter(r => r.snapshot.decision.outcome === 'override').length) : 'none yet',
    },
    { label: 'Recommendation accepted', value: decided ? `${Math.round((accepted / decided) * 100)}%` : '—', sub: 'healthy range 30–90%' },
    { label: 'My open tasks', value: `${mine.length}`, sub: late ? `${late} overdue or escalated` : 'nothing overdue' },
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
          {canApprove && (
            <Section
              title="Waiting for your approval"
              aside={
                <button className="link text-sm" onClick={() => go({ view: 'approvals' })}>
                  Open approvals
                </button>
              }
              flush
            >
              {waiting.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted sm:px-5">Nothing is waiting for approval.</p>
              ) : (
                <ul className="divide-y divide-[var(--rule)]">
                  {waiting.slice(0, 4).map(({ r, a }) => (
                    <li key={r.seq}>
                      <button
                        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-[var(--hover)] sm:px-5"
                        onClick={() => go({ view: 'decision', seq: r.seq })}
                      >
                        <span className="text-sm font-semibold">{r.snapshot.search.household.caseRef}</span>
                        <ApprovalChip a={a} />
                        <span className="w-full text-xs text-muted">
                          {deciderOf(r.snapshot).name}, {formatDateTime(r.snapshot.decision.decidedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section
            title="My tasks"
            aside={
              <button className="link text-sm" onClick={() => go({ view: 'tasks' })}>
                All tasks
              </button>
            }
            flush
          >
            <TaskList tasks={mine.slice(0, 5)} empty="Nothing for you right now. Tasks appear here when a placement needs action." />
            {mine.length > 5 && (
              <p className="border-t border-rule px-4 py-2 text-sm text-muted sm:px-5">
                {mine.length - 5} more on the{' '}
                <button className="link text-sm" onClick={() => go({ view: 'tasks' })}>
                  Tasks
                </button>{' '}
                screen.
              </p>
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
          decided > 0 && (
            <button className="link text-sm" onClick={() => go({ view: 'audit' })}>
              Open audit log
            </button>
          )
        }
        flush
      >
        {decided === 0 ? (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">No decisions recorded yet. Try an example household above.</p>
        ) : (
          <div className="scroll-x">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th className="pl-5">Record</th>
                  <th>Case</th>
                  <th>Placement</th>
                  <th>Outcome</th>
                  <th>Status</th>
                  <th>Officer</th>
                  <th>Decided</th>
                </tr>
              </thead>
              <tbody>
                {[...decisions]
                  .reverse()
                  .slice(0, 10)
                  .map(r => {
                    const d = r.snapshot.decision
                    const chosen = r.snapshot.search.candidates.find(c => c.propertyId === d.chosenPropertyId)
                    const p = placements.find(x => x.seq === r.seq)
                    return (
                      <tr key={r.seq} className="cursor-pointer" onClick={() => go({ view: 'decision', seq: r.seq })}>
                        <td className="num pl-5 font-semibold text-accent">#{r.seq}</td>
                        <td>{r.snapshot.search.household.caseRef}</td>
                        <td>{chosen?.label ?? '—'}</td>
                        <td>{OUTCOME[d.outcome]}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {p && <StateChip state={p.state} />}
                            {p && p.approval.status !== 'not_required' && p.approval.status !== 'approved' && <ApprovalChip a={p.approval} />}
                          </span>
                        </td>
                        <td>{deciderOf(r.snapshot).name}</td>
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
