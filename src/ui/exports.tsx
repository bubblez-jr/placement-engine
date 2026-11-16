import { useState } from 'react'
import { useApp } from '../store/app'
import { useUser } from '../auth/session'
import { check } from '../engine/permissions'
import { sha256BytesHex } from '../audit/hash'
import type { ExportFormat } from '../engine/types'
import { IS_DEMO_BUILD, NotAllowed } from './bits'
import { Icon } from './icons'

// Export buttons. Every export goes through the store's export command,
// which seals a record of who exported what before anything is handed over.
// The single-file demo cannot save files, so it offers copy only.

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const TYPE: Record<Exclude<ExportFormat, 'audit_pdf'>, string> = {
  decision_json: 'application/json',
  case_note: 'text/plain;charset=utf-8',
  placements_csv: 'text/csv;charset=utf-8',
}

const DONE: Record<ExportFormat, string> = {
  decision_json: 'Record (JSON)',
  case_note: 'Case note',
  audit_pdf: 'PDF',
  placements_csv: 'Placements list',
}

export function useExporter() {
  const { exportRecords } = useApp()
  const user = useUser()
  const allowed = check(user, 'export_records')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [manual, setManual] = useState<string | null>(null)

  async function run(format: Exclude<ExportFormat, 'audit_pdf'>, delivery: 'download' | 'clipboard', seq?: number) {
    setBusy(`${format}-${delivery}`)
    setMessage(null)
    setManual(null)
    try {
      const r = await exportRecords(format === 'placements_csv' ? { format, delivery } : { format, seq: seq!, delivery })
      const content = r.content ?? ''
      if (delivery === 'download') {
        downloadBlob(r.fileName, new Blob([content], { type: TYPE[format] }))
        setMessage({ ok: true, text: `${DONE[format]} downloaded. The export is recorded as #${r.seq}.` })
      } else {
        try {
          await navigator.clipboard.writeText(content)
          setMessage({ ok: true, text: `${DONE[format]} copied. The export is recorded as #${r.seq}.` })
        } catch {
          setManual(content)
          setMessage({ ok: true, text: `Copying is blocked here: select the text below and copy it. The export is recorded as #${r.seq}.` })
        }
      }
    } catch (err) {
      setMessage({ ok: false, text: `Nothing was exported: ${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }

  /** The PDF is drawn in the browser; its fingerprint goes into the export record before it is saved. */
  async function pdf(seq: number, render: () => Promise<Blob>, fileName: string) {
    setBusy('audit_pdf')
    setMessage(null)
    try {
      const blob = await render()
      const hash = await sha256BytesHex(new Uint8Array(await blob.arrayBuffer()))
      const r = await exportRecords({ format: 'audit_pdf', seq, delivery: 'download', contentSha256: hash })
      downloadBlob(fileName, blob)
      setMessage({ ok: true, text: `PDF downloaded. The export is recorded as #${r.seq}.` })
    } catch (err) {
      setMessage({ ok: false, text: `Nothing was exported: ${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }

  return { allowed, busy, message, manual, run, pdf }
}

export function ExportStatus({ ex, id }: { ex: ReturnType<typeof useExporter>; id: string }) {
  return (
    <>
      {!ex.allowed.ok && <NotAllowed reason={ex.allowed.reason} />}
      {ex.message && (
        <p id={id} role="status" className={`flex items-start gap-1.5 text-sm ${ex.message.ok ? 'text-good' : 'text-bad'}`}>
          <Icon name={ex.message.ok ? 'check' : 'alert'} size={15} className="mt-0.5 shrink-0" />
          {ex.message.text}
        </p>
      )}
      {ex.manual !== null && (
        <textarea
          readOnly
          aria-label="Exported text"
          className="input hash min-h-40 !text-[0.8rem]"
          value={ex.manual}
          onFocus={e => e.currentTarget.select()}
        />
      )}
      {IS_DEMO_BUILD && <p className="text-sm text-muted">File downloads work in the hosted app; this shared demo file can copy only.</p>}
    </>
  )
}
