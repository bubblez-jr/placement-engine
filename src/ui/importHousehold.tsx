import { useState } from 'react'
import { useApp } from '../store/app'
import { useUser } from '../auth/session'
import { check } from '../engine/permissions'
import type { HouseholdImport } from '../engine/householdImport'
import type { Household } from '../engine/types'
import familyExample from '../../docs/examples/household-family-of-four.json?raw'
import wheelchairExample from '../../docs/examples/household-wheelchair-user.json?raw'
import { NotAllowed } from './bits'
import { Icon } from './icons'

const EXAMPLES = [
  { id: 'family', label: 'Family of four (complete)', file: 'household-family-of-four.json', text: familyExample },
  { id: 'wheelchair', label: 'Wheelchair user (needs answers)', file: 'household-wheelchair-user.json', text: wheelchairExample },
]

export type ImportedReport = Pick<HouseholdImport, 'read' | 'notUnderstood' | 'source'> & { fileName: string | null }

/**
 * Import a household from the case system: a `placement-household/1` file,
 * uploaded or pasted. It only fills the form; nothing is searched until the
 * officer presses "Find placements".
 */
export function ImportHousehold({ onImported }: { onImported: (h: Household, report: ImportedReport) => void }) {
  const { importHousehold } = useApp()
  const user = useUser()
  const allowed = check(user, 'import_household')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  if (!open)
    return (
      <button id="import-open" type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon name="file" size={15} />
        Import from the case system
      </button>
    )

  function run(t = text, name = fileName) {
    setProblems([])
    let r: ReturnType<typeof importHousehold>
    try {
      r = importHousehold(t)
    } catch (err) {
      return setProblems([(err as Error).message])
    }
    if (!r.household) return setProblems(r.problems)
    onImported(r.household, { read: r.read, notUnderstood: r.notUnderstood, source: r.source, fileName: name })
    setOpen(false)
    setText('')
    setFileName(null)
  }

  return (
    <section id="import-panel" className="panel grid gap-3 p-4 sm:p-5" aria-labelledby="import-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="import-h" className="text-base font-semibold">
          Import a household from the case system
        </h2>
        <button type="button" className="btn btn-quiet text-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {!allowed.ok ? (
        <NotAllowed reason={allowed.reason} />
      ) : (
        <>
          <p className="text-sm text-muted">
            A file in the <span className="hash">placement-household/1</span> format (JSON). The details fill the form below for you to check. Nothing is
            searched until you press Find placements, and anything the file holds that this system does not use is listed, not dropped.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn cursor-pointer">
              Choose a file
              <input
                id="import-file"
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={async e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 200_000) return setProblems(['The file is too large for one household.'])
                  const t = await f.text()
                  setText(t)
                  setFileName(f.name)
                  run(t, f.name)
                }}
              />
            </label>
            <span className="text-sm text-muted">or paste it below, or try an example file (synthetic):</span>
            {EXAMPLES.map(x => (
              <button
                key={x.id}
                id={`import-example-${x.id}`}
                type="button"
                className="btn btn-quiet text-sm"
                onClick={() => run(x.text, `the example file ${x.file}`)}
              >
                {x.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>File contents</span>
            <textarea
              id="import-text"
              className="input hash min-h-28 !text-[0.8rem]"
              value={text}
              onChange={e => (setText(e.target.value), setFileName(null))}
            />
          </label>
          {problems.length > 0 && (
            <div id="import-problems" role="alert" className="rounded-md border border-bad bg-bad-soft px-3 py-2 text-sm text-bad">
              <b>The file could not be imported.</b>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <button id="import-run" type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => run()}>
              Read the file
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** What the import read and what it did not, shown above the form until the officer searches. */
export function ImportReportPanel({ report, onDismiss }: { report: ImportedReport; onDismiss: () => void }) {
  return (
    <section id="import-report" className="callout grid gap-2 text-sm" aria-labelledby="import-report-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="import-report-h" className="font-semibold">
          Imported {report.fileName ? `from ${report.fileName}` : 'from pasted text'}
        </h2>
        <button type="button" className="btn btn-quiet text-sm" onClick={onDismiss}>
          Hide
        </button>
      </div>
      {report.source.system && (
        <p>
          The file says it came from {report.source.system}
          {report.source.exportedAt ? `, exported ${report.source.exportedAt}` : ''}.
        </p>
      )}
      <p>
        Read: {report.read.join('; ')}. <b>Nothing has been searched.</b> Check every detail below, fix anything marked, then press Find placements.
      </p>
      {report.notUnderstood.length > 0 && (
        <div>
          <b>Not used ({report.notUnderstood.length}):</b>
          <ul className="mt-1 grid gap-0.5 pl-5" style={{ listStyle: 'disc' }}>
            {report.notUnderstood.map((n, i) => (
              <li key={i}>
                <span className="hash">{n.path}</span>: {n.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
