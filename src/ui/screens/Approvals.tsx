import { useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { useUser } from '../../auth/session'
import { approvalOf, decisionRecords, deciderOf } from '../../audit/records'
import { formatDateTime, formatUkTimeOn } from '../../engine/dates'
import { check } from '../../engine/permissions'
import { EXCEPTION_LABEL } from '../../engine/policy'
import { NotAllowed, PageHeader, Section } from '../bits'
import { ApprovalChip, ApprovalPanel, holdText, StateChip } from '../placement'

/** Decisions waiting for a manager, worked out from the chain. */
export function useApprovalQueue() {
  const { data, placements } = useApp()
  return decisionRecords(data.chain)
    .map(r => ({ r, a: approvalOf(data.chain, r), p: placements.find(x => x.seq === r.seq) ?? null }))
    .filter(x => x.a.status !== 'not_required')
}

export function Approvals() {
  const { now } = useApp()
  const { go } = useNav()
  const user = useUser()
  const [open, setOpen] = useState<number | null>(null)
  const queue = useApprovalQueue()
  const allowed = check(user, 'approve_exception')
  const waiting = queue
    .filter(x => x.a.status === 'awaiting' || x.a.status === 'out_of_hours')
    .sort((a, b) => (a.a.status === 'out_of_hours' ? 0 : 1) - (b.a.status === 'out_of_hours' ? 0 : 1) || a.r.seq - b.r.seq)
  const decided = queue
    .filter(x => x.a.status === 'approved' || x.a.status === 'rejected')
    .reverse()
    .slice(0, 10)
  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Exceptions" title="Approvals">
        Decisions that go outside the placement policy wait here for a team manager or the head of service. Nobody approves their own decision.
      </PageHeader>
      {!allowed.ok && <NotAllowed reason={`${allowed.reason} You can still read what is waiting.`} />}

      <Section title={`Waiting (${waiting.length})`} flush>
        {waiting.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">Nothing is waiting for approval.</p>
        ) : (
          <ul className="divide-y divide-[var(--rule)]">
            {waiting.map(({ r, a, p }) => {
              const s = r.snapshot
              const chosen = s.search.candidates.find(c => c.propertyId === s.decision.chosenPropertyId)
              return (
                <li key={r.seq} className="grid gap-3 px-4 py-3.5 sm:px-5" data-approval={r.seq}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {s.search.household.caseRef} · {chosen?.label ?? 'No suitable option'}
                        </span>
                        <ApprovalChip a={a} />
                        {p && <StateChip state={p.state} />}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">
                        Decided by {deciderOf(s).name}, {formatDateTime(s.decision.decidedAt)}.{' '}
                        {a.status === 'out_of_hours'
                          ? `Placed out of hours: approve by ${formatUkTimeOn(a.deferral.approveBy)}.`
                          : p && p.state === 'held'
                            ? `${holdText(p, now)}.`
                            : ''}
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {a.exceptions.map(x => (
                          <li key={x} className="chip chip-warn">
                            {EXCEPTION_LABEL[x]}
                          </li>
                        ))}
                      </ul>
                      {s.decision.reasonText && <p className="mt-1.5 text-sm">“{s.decision.reasonText}”</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn btn-sm" onClick={() => go({ view: 'decision', seq: r.seq })}>
                        Open the record
                      </button>
                      {open !== r.seq && (
                        <button className="btn btn-sm btn-primary" id={`review-${r.seq}`} onClick={() => setOpen(r.seq)}>
                          Approve or reject
                        </button>
                      )}
                    </div>
                  </div>
                  {open === r.seq && <ApprovalPanel rec={r} approval={a} showExceptions={false} />}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Recently decided" flush>
        {decided.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">No approvals recorded yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--rule)]">
            {decided.map(({ r, a }) =>
              a.status === 'approved' || a.status === 'rejected' ? (
                <li key={r.seq} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5">
                  <button className="link num" onClick={() => go({ view: 'decision', seq: r.seq })}>
                    #{r.seq}
                  </button>
                  <span className="font-semibold">{r.snapshot.search.household.caseRef}</span>
                  <ApprovalChip a={a} />
                  <span className="text-muted">
                    {a.decision.actor.name}, {formatDateTime(a.decision.at)}
                  </span>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </Section>
    </div>
  )
}
