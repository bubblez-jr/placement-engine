import { useState } from 'react'
import { useApp } from '../../store/app'
import { formatDate, hoursBetween, parseDate } from '../../engine/dates'
import { requiredCompliance } from '../../engine/gates'
import { parsePropertiesCsv, propertiesToCsv } from '../../data/csv'
import type { Property } from '../../engine/types'
import { UNIT_LABEL } from '../criteria'
import { gbp, PageHeader, Section } from '../bits'

function complianceStatus(p: Property, req: string[], today: Date): { cls: string; text: string } {
  const missing = req.filter(t => !p.compliance.some(c => c.type === t))
  if (missing.length) return { cls: 'chip-bad', text: `${missing.length} missing` }
  const expired = p.compliance.filter(c => c.expires && parseDate(c.expires) < today)
  if (expired.length) return { cls: 'chip-bad', text: `${expired.length} expired` }
  const epc = p.compliance.find(c => c.type === 'epc')
  if (epc?.rating && !'ABCDE'.includes(epc.rating)) return { cls: 'chip-bad', text: `EPC ${epc.rating}` }
  const soon = p.compliance.filter(c => c.expires && parseDate(c.expires).getTime() - today.getTime() < 60 * 86_400_000)
  if (soon.length) return { cls: 'chip-warn', text: `${soon.length} expiring` }
  return { cls: 'chip-good', text: 'All valid' }
}

export function Properties() {
  const { data, activeRuleset, confirmAvailability, replaceProperties, officer } = useApp()
  const [csv, setCsv] = useState('')
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [result, setResult] = useState<{ ok: boolean; text: string[] } | null>(null)
  const now = new Date()
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))

  function runImport() {
    const r = parsePropertiesCsv(csv, new Date().toISOString(), `${officer.name} (import)`)
    if (r.properties.length) replaceProperties(r.properties, mode)
    setResult({
      ok: r.errors.length === 0 && r.properties.length > 0,
      text: [r.properties.length ? `Imported ${r.properties.length} propert${r.properties.length === 1 ? 'y' : 'ies'}.` : 'Nothing imported.', ...r.errors],
    })
  }

  return (
    <div className="grid gap-5">
      <PageHeader eyebrow="Supply" title="Properties">
        What the engine can offer: the council’s own stock and approved suppliers’ units. The MVP takes a CSV; a pilot imports from the council’s booking
        platform.
      </PageHeader>

      <Section title={`Inventory (${data.properties.length})`} aside={<span className="text-sm text-muted">{data.propertiesVersion}</span>}>
        <div className="scroll-x">
          <table className="table min-w-[900px]">
            <thead>
              <tr>
                <th>Property</th>
                <th>Type</th>
                <th className="text-right">Beds</th>
                <th className="text-right">£/night</th>
                <th>Available</th>
                <th>Last confirmed</th>
                <th>Certificates</th>
                <th>Supplier</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map(p => {
                const age = hoursBetween(p.availabilityConfirmedAt, now.toISOString())
                const stale = age > activeRuleset.staleAvailabilityHours
                const cs = complianceStatus(p, requiredCompliance(p, activeRuleset), today)
                const sup = data.suppliers.find(s => s.id === p.supplierId)
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="font-bold">{p.label}</div>
                      <div className="text-xs text-muted">{p.district}</div>
                    </td>
                    <td className="text-sm">{UNIT_LABEL[p.unitType]}</td>
                    <td className="num text-right">{p.bedrooms}</td>
                    <td className="num text-right">{gbp(p.nightlyCharge)}</td>
                    <td className="num whitespace-nowrap text-sm">
                      {formatDate(p.availableFrom)}
                      {p.availableUntil && <div className="text-xs text-muted">to {formatDate(p.availableUntil)}</div>}
                    </td>
                    <td className="text-sm">
                      <span className={`chip ${stale ? 'chip-warn' : 'chip-plain'}`}>
                        {age < 24 ? `${Math.max(1, Math.round(age))} h ago` : `${Math.round(age / 24)} days ago`}
                      </span>
                      <button className="btn-quiet btn ml-1 text-xs" onClick={() => confirmAvailability(p.id)}>
                        Confirm now
                      </button>
                    </td>
                    <td>
                      <span className={`chip ${cs.cls}`}>{cs.text}</span>
                    </td>
                    <td className="text-sm">{sup?.approved ? sup.name : <span className="chip chip-bad">Not approved</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Import from a spreadsheet">
        <p className="mb-2 text-sm text-muted">
          Paste CSV with a header row. Required: id, label, lat, lng, district, brma, bedrooms, nightly, available_from (YYYY-MM-DD). Certificates as expiry
          dates (gas_expires, eicr_expires), epc_band, inspected (yes/no).
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <button className="btn" onClick={() => setCsv(propertiesToCsv(data.properties.slice(0, 3)))}>
            Fill with an example
          </button>
          <label className="btn cursor-pointer">
            Choose a CSV file
            <input
              id="csvfile"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (f) setCsv(await f.text())
              }}
            />
          </label>
        </div>
        <textarea
          id="csv"
          className="input hash min-h-40 !text-[0.8rem]"
          value={csv}
          onChange={e => setCsv(e.target.value)}
          placeholder="id,uprn,label,address,…"
        />
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input id="mode-add" type="radio" name="mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Add or update by id
          </label>
          <label className="flex items-center gap-2">
            <input id="mode-replace" type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace the whole inventory
          </label>
          <button className="btn btn-primary" disabled={!csv.trim()} onClick={runImport}>
            Import
          </button>
        </div>
        {result && (
          <ul className={`mt-3 grid gap-1 rounded-md px-3 py-2 text-sm ${result.ok ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'}`}>
            {result.text.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
