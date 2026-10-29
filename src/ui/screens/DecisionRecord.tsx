import { useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { daysBetween, formatDate, formatDateTime, toIsoDate } from '../../engine/dates'
import { shortHash } from '../../audit/hash'
import { OVERRIDE_REASONS } from './Decide'
import { PageHeader, Section } from '../bits'

function CopyBox({ id, text }: { id: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')
  return (
    <div className="grid gap-2">
      <textarea id={id} readOnly className="input hash min-h-48 !text-[0.82rem] leading-relaxed" value={text} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn"
          onClick={async e => {
            const ta = (e.currentTarget.parentElement?.previousElementSibling as HTMLTextAreaElement) ?? null
            try {
              await navigator.clipboard.writeText(text)
              setState('copied')
            } catch {
              ta?.select()
              setState('select')
            }
          }}
        >
          Copy text
        </button>
        {state === 'copied' && <span className="text-sm text-good">Copied</span>}
        {state === 'select' && <span className="text-sm text-muted">Text selected: press Ctrl+C or ⌘C to copy</span>}
      </div>
    </div>
  )
}

export function DecisionRecord({ seq }: { seq: number }) {
  const { data } = useApp()
  const { go } = useNav()
  const r = data.chain.find(x => x.seq === seq)
  if (!r) return <p>Decision #{seq} not found.</p>
  const { search, decision: d, clocks, ruleset, properties } = r.snapshot
  const chosen = search.candidates.find(c => c.propertyId === d.chosenPropertyId)
  const prop = properties.find(p => p.id === d.chosenPropertyId)
  const rec = search.candidates.find(c => c.propertyId === search.recommendedId)
  const today = toIsoDate(new Date())
  const adults = search.household.members.filter(m => m.role === 'adult')
  const children = search.household.members.filter(m => m.role === 'child')

  const s208 =
    prop && clocks.some(c => c.key === 's208')
      ? `To: Housing Department, ${prop.district} Council
Notice under section 208 of the Housing Act 1996

${ruleset.councilName} has secured accommodation under Part 7 of the Housing Act 1996 for the household below, in your district.

Applicant: [name from the case system]
Household: ${adults.length} adult${adults.length === 1 ? '' : 's'}${children.length ? ` and ${children.length} child${children.length === 1 ? '' : 'ren'} (ages ${children.map(c => c.age).join(', ')})` : ''}
Address: ${prop.address}
Accommodation made available from: ${formatDate(d.startDate)}
Function: interim / main housing duty (confirm from the case)
Our reference: ${search.household.caseRef}

Contact: ${d.officer}, ${d.officerRole}, ${ruleset.councilName}`
      : null

  const s213 =
    prop && children.length > 0 && d.consentToNotifyServices
      ? `To: the children's school(s), GP practice and health visitor
Notification of a temporary accommodation placement (Housing Act 1996 s213AA)

With the parent's consent, ${ruleset.councilName} tells you that the family has been placed in temporary accommodation from ${formatDate(d.startDate)}.
Schools: ${[...new Set(search.household.destinations.filter(x => x.kind === 'school').map(x => x.name))].join('; ') || 'none recorded'}
New address: ${prop.address}
Our reference: ${search.household.caseRef}
Contact: ${d.officer}, ${ruleset.councilName}`
      : null

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={`Decision record #${r.seq} · sealed ${formatDateTime(r.snapshot.frozenAt)}`}
        title={chosen ? `Placement recorded: ${chosen.label}` : 'No suitable option recorded'}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => go({ view: 'report', seq })}>
              Open the audit pack
            </button>
            <button className="btn" onClick={() => go({ view: 'home' })}>
              All placements
            </button>
          </>
        }
      >
        Case {search.household.caseRef}
        {prop ? ` · ${prop.address}` : ''}
      </PageHeader>

      <Section title="Decision">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="eyebrow">Outcome</dt>
            <dd className="mt-1">
              {d.outcome === 'accepted' ? (
                <span className="chip chip-good">Recommendation accepted</span>
              ) : d.outcome === 'override' ? (
                <span className="chip chip-warn">Officer chose another option</span>
              ) : (
                <span className="chip chip-bad">No suitable option</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Decided by</dt>
            <dd className="mt-1">
              {d.officer}, {d.officerRole}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">When</dt>
            <dd className="num mt-1">{formatDateTime(d.decidedAt)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Starts</dt>
            <dd className="num mt-1">{chosen ? formatDate(d.startDate) : '—'}</dd>
          </div>
        </dl>
        {d.outcome === 'override' && (
          <p className="mt-4 rounded-md bg-warn-soft p-3">
            <b>Recommended was {rec?.label}.</b> Reason: {OVERRIDE_REASONS.find(([k]) => k === d.overrideReason)?.[1]}. “{d.reasonText}”
          </p>
        )}
        {d.outcome !== 'override' && d.reasonText && <p className="mt-4 rounded-md bg-sunken p-3">“{d.reasonText}”</p>}
      </Section>

      {clocks.length > 0 && (
        <Section title="Deadlines this placement starts">
          <div className="scroll-x">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Action</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {clocks.map(c => {
                  const days = daysBetween(today, c.due)
                  return (
                    <tr key={c.key}>
                      <td className="num whitespace-nowrap">
                        {formatDate(c.due)}
                        <div className={`text-xs ${days < 0 ? 'text-bad' : days <= 3 ? 'text-warn' : 'text-muted'}`}>
                          {days < 0 ? `${-days} days overdue` : days === 0 ? 'today' : `in ${days} days`}
                        </div>
                      </td>
                      <td>{c.label}</td>
                      <td className="text-sm text-muted">{c.basis}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {(s208 || s213) && (
        <div className="grid gap-5 xl:grid-cols-2">
          {s208 && (
            <Section title={`Draft notice to ${prop!.district}`}>
              <CopyBox id="s208" text={s208} />
            </Section>
          )}
          {s213 && (
            <Section title="Draft notification to school, GP and health visitor">
              <CopyBox id="s213" text={s213} />
            </Section>
          )}
        </div>
      )}

      <Section title="Seal">
        <dl className="grid gap-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 text-muted">Record hash</dt>
            <dd className="hash break-all">{r.rowHash}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 text-muted">Links to previous</dt>
            <dd className="hash break-all">{r.prevHash}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 text-muted">Policy</dt>
            <dd>
              v{ruleset.version} <span className="hash">{shortHash(ruleset.hash!)}</span>
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  )
}
