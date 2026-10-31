import { useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDateTime } from '../../engine/dates'
import { shortHash } from '../../audit/hash'
import type { ChainCheck } from '../../audit/chain'
import { PageHeader, Section } from '../bits'

export function AuditLog() {
  const { data, verify, tamper, undoTamper, resetDemo } = useApp()
  const { go } = useNav()
  const [check, setCheck] = useState<ChainCheck | null>(null)
  const [resetArmed, setResetArmed] = useState(false)
  const run = async () => setCheck(await verify())

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Evidence"
        title="Audit log"
        actions={
          <button className="btn btn-primary" onClick={run} disabled={data.chain.length === 0}>
            Check every seal
          </button>
        }
      >
        Every decision is sealed with a hash that includes the record before it. Changing any past record breaks every seal after it, so edits after the fact
        show up.
      </PageHeader>

      {check && (
        <p role="status" className={`rounded-md px-3 py-2 ${check.ok ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
          {check.ok ? `All ${check.checked} records intact.` : `${check.reason}. Records from #${check.brokenAt} on cannot be relied on.`}
        </p>
      )}

      <Section title={`Sealed decisions (${data.chain.length})`}>
        {data.chain.length === 0 ? (
          <p className="text-muted">No decisions yet. Record one from a placement search and it appears here.</p>
        ) : (
          <div className="scroll-x">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Sealed</th>
                  <th>Case</th>
                  <th>Outcome</th>
                  <th>Officer</th>
                  <th>Hash</th>
                  <th>Links to</th>
                </tr>
              </thead>
              <tbody>
                {[...data.chain].reverse().map(r => (
                  <tr key={r.seq}>
                    <td>
                      <button className="link num" onClick={() => go({ view: 'report', seq: r.seq })}>
                        {r.seq}
                      </button>
                    </td>
                    <td className="num whitespace-nowrap">{formatDateTime(r.snapshot.frozenAt)}</td>
                    <td>{r.snapshot.search.household.caseRef}</td>
                    <td>
                      {r.snapshot.decision.outcome === 'accepted' ? 'Accepted' : r.snapshot.decision.outcome === 'override' ? 'Override' : 'None suitable'}
                    </td>
                    <td>{r.snapshot.decision.officer}</td>
                    <td className="hash">{shortHash(r.rowHash)}</td>
                    <td className="hash text-muted">{r.seq === 1 ? 'start' : shortHash(r.prevHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Demonstrate tamper detection">
        <p className="mb-3 max-w-3xl text-muted">
          For demos only. This edits the officer’s reason on record #1 without resealing it, the way someone might change a record after a complaint. Then check
          the seals.
        </p>
        <div className="flex flex-wrap gap-2">
          {!data.tamperBackup ? (
            <button
              className="btn"
              disabled={data.chain.length === 0}
              onClick={() => {
                tamper()
                setCheck(null)
              }}
            >
              Edit record #1 behind the system’s back
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                undoTamper()
                setCheck(null)
              }}
            >
              Put record #1 back
            </button>
          )}
          <button className="btn" onClick={run} disabled={data.chain.length === 0}>
            Check every seal
          </button>
        </div>
      </Section>

      <Section title="Reset the demo">
        <p className="mb-3 text-muted">Clears every search and decision in this browser and reloads the example data.</p>
        {!resetArmed ? (
          <button className="btn" onClick={() => setResetArmed(true)}>
            Reset demo data
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-bad">This deletes all demo decisions.</span>
            <button
              className="btn"
              style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
              onClick={async () => {
                await resetDemo()
                setResetArmed(false)
                setCheck(null)
              }}
            >
              Yes, reset
            </button>
            <button className="btn" onClick={() => setResetArmed(false)}>
              Keep the data
            </button>
          </div>
        )}
      </Section>
    </div>
  )
}
