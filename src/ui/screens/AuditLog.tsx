import { useState } from 'react'
import { useApp } from '../../store/app'
import { useNav } from '../../store/nav'
import { formatDateTime } from '../../engine/dates'
import { shortHash } from '../../audit/hash'
import { actorNameOf, caseRefOf, decisionSeqOf, recordKind, sealedAt } from '../../audit/records'
import { isDecisionSnapshot } from '../../audit/snapshot'
import type { ChainCheck } from '../../audit/chain'
import { IS_DEMO_BUILD, NotAllowed, PageHeader, Section } from '../bits'
import { ExportStatus, useExporter } from '../exports'
import { useUser } from '../../auth/session'
import { check as permission } from '../../engine/permissions'

export function AuditLog() {
  const { data, verify, tamper, undoTamper, resetDemo } = useApp()
  const user = useUser()
  const { go } = useNav()
  const canTamper = permission(user, 'run_tamper_demo')
  const canReset = permission(user, 'reset_demo')
  const [check, setCheck] = useState<ChainCheck | null>(null)
  const [resetArmed, setResetArmed] = useState(false)
  const run = async () => setCheck(await verify())
  const ex = useExporter()
  const canExport = ex.allowed.ok && !ex.busy

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

      <Section
        title={`Sealed records (${data.chain.length})`}
        description="Decisions, and later facts about them: placement steps, approvals, consent changes, tasks and exports."
      >
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
                  <th>Record</th>
                  <th>By</th>
                  <th>Hash</th>
                  <th>Links to</th>
                </tr>
              </thead>
              <tbody>
                {[...data.chain].reverse().map(r => (
                  <tr key={r.seq}>
                    <td>
                      {decisionSeqOf(r) !== null ? (
                        <button className="link num" onClick={() => go({ view: 'report', seq: decisionSeqOf(r)! })}>
                          {r.seq}
                        </button>
                      ) : (
                        <span className="num">{r.seq}</span>
                      )}
                    </td>
                    <td className="num whitespace-nowrap">{formatDateTime(sealedAt(r))}</td>
                    <td>{caseRefOf(r)}</td>
                    <td>
                      {isDecisionSnapshot(r.snapshot)
                        ? r.snapshot.decision.outcome === 'accepted'
                          ? 'Accepted'
                          : r.snapshot.decision.outcome === 'override'
                            ? 'Override'
                            : 'None suitable'
                        : '—'}
                      <div className="text-xs text-muted">{recordKind(r)}</div>
                    </td>
                    <td>{actorNameOf(r)}</td>
                    <td className="hash">{shortHash(r.rowHash)}</td>
                    <td className="hash text-muted">{r.seq === 1 ? 'start' : shortHash(r.prevHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Export for the case system"
        id="export-placements"
        description="Every placement, one row each, with where it stands now, its journey and subsidy sources, and whether it is synthetic. A single decision's case note, record or PDF is exported from its audit pack. Every export is itself recorded here."
      >
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            {!IS_DEMO_BUILD && (
              <button id="export-csv-download" className="btn" disabled={!canExport} onClick={() => ex.run('placements_csv', 'download')}>
                Download placements (CSV)
              </button>
            )}
            <button id="export-csv-copy" className="btn" disabled={!canExport} onClick={() => ex.run('placements_csv', 'clipboard')}>
              Copy placements (CSV)
            </button>
          </div>
          <ExportStatus ex={ex} id="export-csv-status" />
        </div>
      </Section>

      <Section title="Demonstrate tamper detection">
        <p className="mb-3 max-w-3xl text-muted">
          For demos only. This edits the officer’s reason on record #1 without resealing it, the way someone might change a record after a complaint. Then check
          the seals.
        </p>
        {!canTamper.ok && <NotAllowed reason={canTamper.reason} className="mb-3" />}
        <div className="flex flex-wrap gap-2">
          {!data.tamperBackup ? (
            <button
              id="tamper"
              className="btn"
              disabled={data.chain.length === 0 || !canTamper.ok}
              onClick={() => {
                tamper()
                setCheck(null)
              }}
            >
              Edit record #1 behind the system’s back
            </button>
          ) : (
            <button
              id="untamper"
              className="btn"
              disabled={!canTamper.ok}
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
        {!canReset.ok && <NotAllowed reason={`${canReset.reason} In the demo, sign in as the administrator to reset.`} className="mb-3" />}
        {!resetArmed ? (
          <button id="reset" className="btn" disabled={!canReset.ok} onClick={() => setResetArmed(true)}>
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
