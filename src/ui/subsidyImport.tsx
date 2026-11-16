import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/app'
import { useUser } from '../auth/session'
import { subsidyProvenance } from '../engine/cost'
import { formatDate, ukDate } from '../engine/dates'
import { check } from '../engine/permissions'
import { brmaCounts, diffLhaTables, LHA_COLUMNS, validateSubsidyImport, type LhaParse } from '../engine/subsidyTable'
import type { Issue, Ruleset } from '../engine/types'
import { ValidationError } from '../engine/validate'
import { ErrorSummary, Field, fieldA11y, gbp, NotAllowed, Section } from './bits'
import { SubsidyChip } from './provenance'

const SIZES = ['1', '2', '3', '4'] as const

function RatesTable({ table, id }: { table: Ruleset['subsidy']['lhaJan2011Weekly']; id?: string }) {
  return (
    <div className="scroll-x">
      <table className="table min-w-[460px]" id={id}>
        <thead>
          <tr>
            <th>Broad rental market area</th>
            {SIZES.map(s => (
              <th key={s} className="text-right">
                {s} bed
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(table).map(([brma, r]) => (
            <tr key={brma}>
              <td>{brma}</td>
              {SIZES.map(s => (
                <td key={s} className="num text-right">
                  {gbp(r[s], 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The housing benefit subsidy table on the policy screen: what is in use and
 * whether it is official, and for the head of service, loading the official
 * January 2011 LHA table from a CSV file with a check, a preview and a
 * comparison before it is published as a new signed version.
 */
export function SubsidyTableSection() {
  const { data, activeRuleset, publishSubsidyTable } = useApp()
  const user = useUser()
  const allowed = check(user, 'publish_policy')
  const sub = subsidyProvenance(activeRuleset)
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [citation, setCitation] = useState('')
  const [sourceDate, setSourceDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [equality, setEquality] = useState('')
  const [checked, setChecked] = useState<{ issues: Issue[]; parsed: LhaParse | null } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) summaryRef.current?.focus()
  }, [focus])
  const today = ukDate(new Date().toISOString())
  const inventory = useMemo(() => brmaCounts(data.properties), [data.properties])
  const input = { csv, citation, sourceDate, confirmedOfficial: confirmed }
  const issues = checked?.issues ?? []
  const ok = !!checked && !issues.some(i => i.severity === 'error') && !!checked.parsed?.table
  const diff = ok ? diffLhaTables(activeRuleset.subsidy.lhaJan2011Weekly, checked!.parsed!.table!) : null
  const nextVersion = (() => {
    const [a, b] = data.rulesets[data.rulesets.length - 1].version.split('.').map(Number)
    return `${a}.${(b ?? 0) + 1}`
  })()

  function runCheck() {
    const r = validateSubsidyImport(input, today, inventory)
    setChecked(r)
    setMsg(null)
    if (r.issues.some(i => i.severity === 'error')) setFocus(n => n + 1)
  }
  // Any change after a check needs a new check before publishing.
  const edit =
    <T,>(f: (v: T) => void) =>
    (v: T) => (f(v), setChecked(null))

  async function publish() {
    setBusy(true)
    setMsg(null)
    try {
      const rs = await publishSubsidyTable({ ...input, equalityNote: equality })
      setMsg({
        ok: true,
        text: `Published version ${rs.version} with the official table. New searches use it and say so; past decisions keep the figures they used.`,
      })
      setOpen(false)
      setCsv('')
      setCitation('')
      setSourceDate('')
      setConfirmed(false)
      setEquality('')
      setChecked(null)
    } catch (err) {
      if (err instanceof ValidationError) {
        // The store names the equality note 'equality'; on this form it is 'lha-equality'.
        setChecked({ issues: err.issues.map(i => (i.path === 'equality' ? { ...i, path: 'lha-equality' } : i)), parsed: checked?.parsed ?? null })
        setFocus(n => n + 1)
      } else setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Housing benefit subsidy table"
      id="subsidy-table"
      aside={<SubsidyChip sub={sub} id="subsidy-status-policy" />}
      description="January 2011 Local Housing Allowance weekly rates by broad rental market area. Subsidy is the lowest of the charge, the policy’s share of this rate, and the weekly cap."
    >
      <div className="grid gap-4">
        <p className={`rounded-md px-3 py-2 text-sm ${sub.status === 'official' ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'}`}>{sub.detail}</p>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-accent">
            Show the table in use ({Object.keys(activeRuleset.subsidy.lhaJan2011Weekly).length} areas)
          </summary>
          <div className="mt-2">
            <RatesTable table={activeRuleset.subsidy.lhaJan2011Weekly} />
          </div>
        </details>
        {msg && <p className={`rounded-md px-3 py-2 ${msg.ok ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
        {!allowed.ok ? (
          <NotAllowed reason={`${allowed.reason} Only the head of service or an administrator loads the subsidy table.`} />
        ) : !open ? (
          <div>
            <button id="lha-open" type="button" className="btn" onClick={() => setOpen(true)}>
              Load the official table from a file
            </button>
          </div>
        ) : (
          <div id="lha-import" className="grid gap-4 rounded-lg border border-rule p-3 sm:p-4">
            <p className="text-sm text-muted">
              A CSV file with the columns <span className="hash">{LHA_COLUMNS.join(',')}</span>, one row per area, weekly rates in pounds. Shared-room and
              5-bedroom columns may be included and are ignored. The file is checked, shown to you and compared with the table in use before anything is
              published.
            </p>
            <ErrorSummary ref={summaryRef} issues={issues} id="lha-errors" title="The table cannot be loaded yet" />
            <Field id="lha-file" label="The CSV file" issues={issues}>
              <textarea
                {...fieldA11y('lha-file', issues)}
                className="input hash min-h-28 !text-[0.8rem]"
                value={csv}
                placeholder={`${LHA_COLUMNS.join(',')}\n…`}
                onChange={e => edit(setCsv)(e.target.value)}
              />
            </Field>
            <label className="btn w-fit cursor-pointer">
              Choose a CSV file
              <input
                id="lha-file-input"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async e => {
                  const f = e.target.files?.[0]
                  if (f && f.size < 1_000_000) edit(setCsv)(await f.text())
                }}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field id="lha-citation" label="Source (title of the DWP document and where it was published)" issues={issues}>
                <input {...fieldA11y('lha-citation', issues)} className="input" value={citation} onChange={e => edit(setCitation)(e.target.value)} />
              </Field>
              <Field id="lha-sourceDate" label="Date of the source document" issues={issues}>
                <input
                  {...fieldA11y('lha-sourceDate', issues)}
                  type="date"
                  className="input"
                  value={sourceDate}
                  onChange={e => edit(setSourceDate)(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-1">
              <label className="flex items-start gap-2">
                <input
                  {...fieldA11y('lha-confirm', issues)}
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  onChange={e => edit(setConfirmed)(e.target.checked)}
                />
                <span>This is the official DWP January 2011 LHA table, taken unchanged from the source above.</span>
              </label>
              {issues.some(i => i.path === 'lha-confirm' && i.severity === 'error') && (
                <span id="lha-confirm-error" className="text-sm font-medium text-bad">
                  Confirm that this is the official table.
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button id="lha-check" type="button" className="btn" onClick={runCheck}>
                Check the table
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => (setOpen(false), setChecked(null))}>
                Cancel
              </button>
            </div>

            {checked?.parsed && issues.some(i => i.severity === 'warning') && (
              <div className="callout border-warn bg-warn-soft text-sm" role="status" id="lha-warnings">
                <b className="text-warn">Check these before you publish</b>
                <ul className="mt-1 grid gap-0.5 pl-5" style={{ listStyle: 'disc' }}>
                  {issues
                    .filter(i => i.severity === 'warning')
                    .map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                </ul>
              </div>
            )}

            {ok && diff && (
              <div className="grid gap-3" id="lha-preview">
                <h3 className="font-semibold">
                  Preview: {checked!.parsed!.rows} areas
                  {checked!.parsed!.ignoredColumns.length ? ` (ignored: ${checked!.parsed!.ignoredColumns.join(', ')})` : ''}
                </h3>
                <p className="text-sm" id="lha-diff">
                  Against the table in use: {diff.changed.length} area{diff.changed.length === 1 ? '' : 's'} changed, {diff.added.length} added,{' '}
                  {diff.removed.length} removed, {diff.unchanged} unchanged.
                  {diff.removed.length > 0 && ` Removed: ${diff.removed.join(', ')}.`}
                  {diff.added.length > 0 && ` Added: ${diff.added.join(', ')}.`}
                </p>
                {diff.changed.length > 0 && (
                  <div className="scroll-x">
                    <table className="table min-w-[520px]">
                      <thead>
                        <tr>
                          <th>Area</th>
                          {SIZES.map(s => (
                            <th key={s} className="text-right">
                              {s} bed: now → new
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {diff.changed.map(c => (
                          <tr key={c.brma}>
                            <td>{c.brma}</td>
                            {SIZES.map(s => (
                              <td key={s} className={`num text-right ${c.from[s] !== c.to[s] ? 'font-semibold' : 'text-muted'}`}>
                                {gbp(c.from[s], 2)} → {gbp(c.to[s], 2)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-accent">Show the whole new table</summary>
                  <div className="mt-2">
                    <RatesTable table={checked!.parsed!.table!} id="lha-new-table" />
                  </div>
                </details>
                <Field id="lha-equality" label="Equality assessment of this change" issues={issues}>
                  <textarea
                    {...fieldA11y('lha-equality', issues)}
                    className="input min-h-20"
                    value={equality}
                    onChange={e => setEquality(e.target.value)}
                    placeholder="Net costs can change which of two close options is recommended. Who could that disadvantage?"
                  />
                </Field>
                <p className="text-sm">
                  Publishing makes version {nextVersion}, signed off by <b>{user.name}</b>, with the source “{citation.trim()}” dated{' '}
                  {sourceDate ? formatDate(sourceDate) : ''}, loaded today. Every new search will say “Official subsidy table”.
                </p>
                <div>
                  <button id="lha-publish" type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                    {busy ? 'Publishing…' : `Publish version ${nextVersion} with this table`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
