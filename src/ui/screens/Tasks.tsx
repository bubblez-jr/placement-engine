import { useState } from 'react'
import { useApp } from '../../store/app'
import { useUser } from '../../auth/session'
import { STAFF } from '../../data/staff'
import { check } from '../../engine/permissions'
import { isMine, isMyTeam, type Task } from '../../engine/tasks'
import { PageHeader, Section } from '../bits'
import { InAppOnly, TaskList } from '../placement'

type Scope = 'mine' | 'team' | 'all'
type Filter = 'open' | 'late' | 'done' | 'all'

const SCOPES: [Scope, string][] = [
  ['mine', 'Mine'],
  ['team', 'My team'],
  ['all', 'All'],
]
const FILTERS: [Filter, string][] = [
  ['open', 'Open'],
  ['late', 'Overdue or escalated'],
  ['done', 'Done or cancelled'],
  ['all', 'Everything'],
]

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  idPrefix,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  idPrefix: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-lg border border-rule bg-sunken p-1">
      {options.map(([k, l]) => (
        <button
          key={k}
          id={`${idPrefix}-${k}`}
          type="button"
          aria-pressed={value === k}
          className={`rounded-md px-3 py-1 text-sm font-semibold ${value === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          onClick={() => onChange(k)}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export function Tasks() {
  const { tasks } = useApp()
  const user = useUser()
  const takesTasks = check(user, 'complete_task').ok
  const [scope, setScope] = useState<Scope>(takesTasks ? 'mine' : 'all')
  const [filter, setFilter] = useState<Filter>('open')
  const inScope = tasks.filter(t => (scope === 'mine' ? isMine(t, user) : scope === 'team' ? isMyTeam(t, user, STAFF) : true))
  const shown = inScope.filter((t: Task) =>
    filter === 'open'
      ? t.status === 'open'
      : filter === 'late'
        ? t.status === 'open' && (t.escalation === 'overdue' || t.escalation === 'escalated')
        : filter === 'done'
          ? t.status !== 'open'
          : true,
  )
  const open = inScope.filter(t => t.status === 'open')
  const stats = [
    { label: 'Open', value: open.length },
    { label: 'Due soon', value: open.filter(t => t.escalation === 'due_soon').length },
    { label: 'Overdue', value: open.filter(t => t.escalation === 'overdue').length },
    { label: 'Escalated', value: open.filter(t => t.escalation === 'escalated').length },
  ]
  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Follow-up" title="Tasks">
        Every warning that needs action becomes a task with an owner and a due time. Completing one needs evidence: what was done and a reference.
      </PageHeader>

      <InAppOnly />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Whose tasks" value={scope} options={SCOPES} onChange={setScope} idPrefix="tasks-scope" />
        <Segmented label="Which tasks" value={filter} options={FILTERS} onChange={setFilter} idPrefix="tasks-filter" />
      </div>

      <div className="panel grid grid-cols-2 sm:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`stat px-5 py-3 ${i > 0 ? 'sm:border-l' : ''} ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} border-rule`}
          >
            <span className="text-xs font-medium text-muted">{s.label}</span>
            <span className={`stat-value ${s.value > 0 && (s.label === 'Overdue' || s.label === 'Escalated') ? 'text-bad' : ''}`}>{s.value}</span>
          </div>
        ))}
      </div>

      <Section title={`${FILTERS.find(f => f[0] === filter)![1]} (${shown.length})`} flush>
        <TaskList tasks={shown} empty={scope === 'mine' ? 'Nothing here for you. Try “My team” or “All”.' : 'No tasks match.'} />
      </Section>
    </div>
  )
}
