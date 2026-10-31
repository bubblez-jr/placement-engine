import { useMemo, useState } from 'react'
import { useApp } from '../../store/app'
import { formatDate, formatDateTime } from '../../engine/dates'
import type { Ruleset } from '../../engine/types'
import { shortHash } from '../../audit/hash'
import { PageHeader, SERIES, Section } from '../bits'

export function Rules() {
  const { data, activeRuleset, publishRuleset, officer } = useApp()
  const [draft, setDraft] = useState<Ruleset>(() => structuredClone(activeRuleset))
  const [by, setBy] = useState(officer.name)
  const [role, setRole] = useState('Head of Housing Needs')
  const [equality, setEquality] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const total = draft.criteria.reduce((a, c) => a + c.weight, 0)
  const changed = useMemo(
    () => JSON.stringify({ ...draft, hash: undefined, signOff: undefined }) !== JSON.stringify({ ...activeRuleset, hash: undefined, signOff: undefined }),
    [draft, activeRuleset],
  )

  const setCrit = (key: string, weight: number) => setDraft(d => ({ ...d, criteria: d.criteria.map(c => (c.key === key ? { ...c, weight } : c)) }))

  async function publish() {
    setMsg(null)
    if (!by.trim()) return setMsg({ ok: false, text: 'Enter who signs off this version.' })
    if (equality.trim().length < 30)
      return setMsg({ ok: false, text: 'Record the equality assessment for this change (at least 30 characters): weights decide who gets placed where.' })
    const next = await publishRuleset({ ...draft, signOff: { by: by.trim(), role: role.trim(), at: new Date().toISOString(), equalityNote: equality.trim() } })
    setDraft(structuredClone(next))
    setEquality('')
    setMsg({ ok: true, text: `Published version ${next.version}. New searches use it; past decisions keep the version they used.` })
  }

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Placement policy" title={`${activeRuleset.name}, v${activeRuleset.version}`}>
        The council’s published placement policy as rules the engine applies the same way every time. Every decision records the version and its hash.
      </PageHeader>

      <Section title="Weights" aside={<span className={`chip ${total === 100 ? 'chip-plain' : 'chip-warn'}`}>Total {total} · applied as shares of 100</span>}>
        <div className="scroll-x">
          <table className="table min-w-[680px]">
            <thead>
              <tr>
                <th>Factor</th>
                <th>Legal basis</th>
                <th className="w-[34%]">Weight</th>
                <th className="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {draft.criteria.map(c => (
                <tr key={c.key}>
                  <td className="font-bold whitespace-nowrap">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-middle" style={{ background: SERIES[c.key] }} />
                    {c.label}
                  </td>
                  <td className="text-sm text-muted">{c.legalFactor}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <input
                        id={`w-${c.key}`}
                        type="range"
                        min={0}
                        max={40}
                        value={c.weight}
                        onChange={e => setCrit(c.key, Number(e.target.value))}
                        className="w-full accent-[var(--accent)]"
                        aria-label={`${c.label} weight`}
                      />
                      <span className="num w-8 text-right">{c.weight}</span>
                    </div>
                  </td>
                  <td className="num text-right">{total ? ((c.weight / total) * 100).toFixed(0) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Journey factors only count for households with that kind of place; their share is spread across the others otherwise.
        </p>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Rules">
          <div className="grid gap-3">
            <label className="field max-w-xs">
              <span>Cost decides between options within (points)</span>
              <input
                id="band"
                type="number"
                min={0}
                max={20}
                className="input num"
                value={draft.costTieBreakBand}
                onChange={e => setDraft(d => ({ ...d, costTieBreakBand: Number(e.target.value) }))}
              />
            </label>
            <label className="field max-w-xs">
              <span>“Within reach” limit, public transport (minutes)</span>
              <input
                id="reach"
                type="number"
                min={15}
                max={240}
                className="input num"
                value={draft.tierTravelLimitMins}
                onChange={e => setDraft(d => ({ ...d, tierTravelLimitMins: Number(e.target.value) }))}
              />
            </label>
            <label className="field max-w-xs">
              <span>Extra bedrooms allowed above need</span>
              <input
                id="extra"
                type="number"
                min={0}
                max={3}
                className="input num"
                value={draft.maxExtraBedrooms}
                onChange={e => setDraft(d => ({ ...d, maxExtraBedrooms: Number(e.target.value) }))}
              />
            </label>
            <label className="field max-w-sm">
              <span>Travel to an existing school after a move</span>
              <select
                id="school"
                className="input"
                value={draft.schoolTransport.funding}
                onChange={e =>
                  setDraft(d => ({ ...d, schoolTransport: { ...d.schoolTransport, funding: e.target.value as 'council_discretionary' | 'family' } }))
                }
              >
                <option value="council_discretionary">Council funds journeys over {draft.schoolTransport.fundIfMinutesOver} minutes</option>
                <option value="family">The family pays</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                id="inspection"
                type="checkbox"
                checked={draft.requireInspection}
                onChange={e => setDraft(d => ({ ...d, requireInspection: e.target.checked }))}
              />
              Require a council inspection before first use
            </label>
          </div>
        </Section>
        <Section title="Location tiers and journey scales">
          <ul className="grid gap-2 text-sm">
            <li>
              <b>Tier 1</b> in {draft.homeDistrict} · <b>Tier 2</b> {draft.adjacentDistricts.join(', ')} · <b>Tier 3</b> within {draft.tierTravelLimitMins}{' '}
              minutes · <b>Tier 4</b> out of area
            </li>
            {draft.criteria
              .filter(c => c.breakpoints && c.key !== 'location_tier')
              .map(c => (
                <li key={c.key}>
                  <b>{c.label}:</b> {c.breakpoints!.map(([x, v]) => `${x} min → ${v}`).join(', ')}
                </li>
              ))}
            <li>
              <b>Priority flags:</b>{' '}
              {draft.priorityMultipliers
                .map(m => `${m.flag.replaceAll('_', ' ')} ×${m.multiplier} ${draft.criteria.find(c => c.key === m.criterion)?.label.toLowerCase()}`)
                .join('; ')}
            </li>
            <li className="text-muted">{draft.subsidy.source}</li>
          </ul>
        </Section>
      </div>

      <Section title="Publish a new version">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Signed off by</span>
            <input id="by" className="input" value={by} onChange={e => setBy(e.target.value)} />
          </label>
          <label className="field">
            <span>Role</span>
            <input id="role2" className="input" value={role} onChange={e => setRole(e.target.value)} />
          </label>
        </div>
        <label className="field mt-3">
          <span>Equality assessment of this change</span>
          <textarea
            id="equality"
            className="input min-h-20"
            value={equality}
            onChange={e => setEquality(e.target.value)}
            placeholder="Who could this change disadvantage (large families, disabled people, survivors of domestic abuse), and why is it justified?"
          />
        </label>
        {msg && <p className={`mt-3 rounded-md px-3 py-2 ${msg.ok ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!changed} onClick={publish}>
            Publish version{' '}
            {(() => {
              const [a, b] = data.rulesets[data.rulesets.length - 1].version.split('.').map(Number)
              return `${a}.${(b ?? 0) + 1}`
            })()}
          </button>
          <button className="btn" disabled={!changed} onClick={() => setDraft(structuredClone(activeRuleset))}>
            Discard changes
          </button>
        </div>
      </Section>

      <Section title="Version history">
        <div className="scroll-x">
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>Version</th>
                <th>Effective</th>
                <th>Signed off</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {[...data.rulesets].reverse().map(r => (
                <tr key={r.hash}>
                  <td className="num font-bold">
                    {r.version} {r.version === data.activeVersion && <span className="chip chip-accent">In use</span>}
                  </td>
                  <td className="num">{formatDate(r.effectiveFrom)}</td>
                  <td>
                    {r.signOff.by}, {formatDateTime(r.signOff.at)}
                    <div className="text-xs text-muted">{r.signOff.equalityNote}</div>
                  </td>
                  <td className="hash">{shortHash(r.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
