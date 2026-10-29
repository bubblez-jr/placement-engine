import { useState, type ReactNode } from 'react'
import type { Candidate, CriterionKey, CriterionScore, GateCheck } from '../engine/types'
import { TIER_LABEL } from '../engine/scoring'

export const IS_DEMO_BUILD = import.meta.env.MODE === 'demo'

export function gbp(n: number, dp = 0): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
}

/** Fixed criterion → series slot. Colour follows the criterion, never its rank. */
export const SERIES: Record<CriterionKey, string> = {
  school_journey: 'var(--s1)',
  work_journey: 'var(--s2)',
  medical_journey: 'var(--s3)',
  support_journey: 'var(--s4)',
  location_tier: 'var(--s5)',
  facilities: 'var(--s6)',
  condition: 'var(--s7)',
  stability: 'var(--s8)',
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="display text-[1.75rem] leading-tight">{title}</h1>
        {children && <div className="mt-2 text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Section({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="panel p-4 sm:p-5" id={id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function TierChip({ tier, district }: { tier: 1 | 2 | 3 | 4; district?: string }) {
  const cls = tier === 1 ? 'chip-good' : tier === 2 ? 'chip-accent' : tier === 3 ? 'chip-warn' : 'chip-bad'
  return (
    <span className={`chip ${cls}`} title={TIER_LABEL[tier]}>
      Tier {tier}
      {district ? ` · ${district}` : ''}
    </span>
  )
}

export function CheckIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (warn)
    return (
      <span aria-label="Warning" className="font-bold text-warn">
        !
      </span>
    )
  return ok ? (
    <span aria-label="Pass" className="font-bold text-good">
      ✓
    </span>
  ) : (
    <span aria-label="Fail" className="font-bold text-bad">
      ✕
    </span>
  )
}

export function GateList({ checks, showPasses = true, columns = false }: { checks: GateCheck[]; showPasses?: boolean; columns?: boolean }) {
  const items = showPasses ? checks : checks.filter(c => !c.passed)
  return (
    <ul className={`grid gap-x-6 gap-y-1.5 ${columns ? 'lg:grid-cols-2' : ''}`}>
      {items.map((c, i) => (
        <li key={i} className="grid grid-cols-[1.2rem_1fr] gap-2">
          <CheckIcon ok={c.passed} warn={c.severity === 'warn'} />
          <div className="min-w-0">
            <div>{c.message}</div>
            <div className="text-xs text-faint">{c.legalBasis}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Banner() {
  return (
    <div className="chip chip-warn" title="Every household, property and place in this demo is invented">
      Synthetic demo data
    </div>
  )
}

/** Hover tooltip wrapper: shows `tip` while the pointer or focus is on the child. */
export function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-64 -translate-x-1/2 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink shadow-lg"
        >
          {tip}
        </span>
      )}
    </span>
  )
}

/** Stacked contribution bar: each factor's points, out of 100. */
export function ScoreBar({ criteria, score, height = 12 }: { criteria: CriterionScore[]; score: number; height?: number }) {
  const [hover, setHover] = useState<CriterionKey | null>(null)
  const parts = criteria.filter(c => c.applicable && c.contribution > 0)
  let offset = 0
  const segs = parts.map(c => {
    const seg = { c, left: offset }
    offset += c.contribution
    return seg
  })
  const h = segs.find(x => x.c.key === hover)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative flex w-full min-w-24 rounded-[4px] bg-sunken" style={{ height }} onMouseLeave={() => setHover(null)}>
        {segs.map(({ c }, i) => (
          <span
            key={c.key}
            tabIndex={0}
            aria-label={`${c.label}: ${c.contribution.toFixed(1)} points`}
            onMouseEnter={() => setHover(c.key)}
            onFocus={() => setHover(c.key)}
            onBlur={() => setHover(null)}
            className="block h-full"
            style={{
              width: `${c.contribution}%`,
              background: SERIES[c.key],
              boxShadow: i < segs.length - 1 ? 'inset -2px 0 0 var(--surface)' : undefined,
              borderRadius: segs.length === 1 ? 4 : i === 0 ? '4px 0 0 4px' : i === segs.length - 1 ? '0 4px 4px 0' : 0,
            }}
          />
        ))}
        {h && (
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-30 mb-2 w-max max-w-64 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink shadow-lg"
            style={{ left: `${Math.min(80, Math.max(12, h.left + h.c.contribution / 2))}%`, transform: 'translateX(-50%)' }}
          >
            <b>{h.c.label}</b>: {h.c.contribution.toFixed(1)} of {h.c.weight.toFixed(1)} points
            <br />
            {h.c.rawLabel}
          </span>
        )}
      </div>
      <span className="num w-8 shrink-0 text-right font-bold" aria-label={`Suitability ${score} out of 100`}>
        {score.toFixed(0)}
      </span>
    </div>
  )
}

export function FactorLegend({ keys }: { keys: { key: CriterionKey; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Factor colours">
      {keys.map(k => (
        <li key={k.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES[k.key] }} />
          {k.label}
        </li>
      ))}
    </ul>
  )
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = Math.max(1, max - min)
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) ?? step0
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

/** Suitability (up) against public cost per night (left is cheaper). One series. */
export function ScatterPlot({ candidates, recommendedId, onPick }: { candidates: Candidate[]; recommendedId: string | null; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const pts = candidates.filter(c => c.eligible)
  if (pts.length === 0) return <p className="text-muted">No eligible options to plot.</p>
  const W = 520
  const H = 300
  const m = { l: 48, r: 16, t: 16, b: 44 }
  const costs = pts.map(c => c.cost.publicPerNight)
  const ticksX = niceTicks(Math.max(0, Math.min(...costs) - 10), Math.max(...costs) + 10)
  const x0 = ticksX[0]
  const x1 = ticksX[ticksX.length - 1]
  const sx = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r)
  const sy = (v: number) => H - m.b - (v / 100) * (H - m.t - m.b)
  // Label the recommendation and the top three, placing each label where it
  // does not hit another label or point (right, left, above, below).
  const toLabel = [
    ...new Set([
      recommendedId,
      ...[...pts]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(c => c.propertyId),
    ]),
  ]
  const boxes: { x: number; y: number; w: number; h: number }[] = pts.map(c => ({ x: sx(c.cost.publicPerNight) - 7, y: sy(c.score) - 7, w: 14, h: 14 }))
  const hit = (a: { x: number; y: number; w: number; h: number }) =>
    a.x < m.l ||
    a.x + a.w > W - 2 ||
    a.y < 2 ||
    a.y + a.h > H - m.b ||
    boxes.some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
  const labels = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>()
  for (const id of toLabel) {
    const c = pts.find(p => p.propertyId === id)
    if (!c) continue
    const cx = sx(c.cost.publicPerNight)
    const cy = sy(c.score)
    const w = c.label.length * 6.2 + 4
    const options = [
      { box: { x: cx + 10, y: cy - 8, w, h: 15 }, at: { x: cx + 12, y: cy + 4, anchor: 'start' as const } },
      { box: { x: cx - 10 - w, y: cy - 8, w, h: 15 }, at: { x: cx - 12, y: cy + 4, anchor: 'end' as const } },
      { box: { x: cx - w / 2, y: cy - 26, w, h: 15 }, at: { x: cx, y: cy - 14, anchor: 'middle' as const } },
      { box: { x: cx - w / 2, y: cy + 10, w, h: 15 }, at: { x: cx, y: cy + 22, anchor: 'middle' as const } },
    ]
    const pick = options.find(o => !hit(o.box))
    if (pick) {
      boxes.push(pick.box)
      labels.set(id!, pick.at)
    }
  }
  const hovered = pts.find(p => p.propertyId === hover)
  return (
    <figure className="m-0">
      <div className="scroll-x">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label="Suitability score against public cost per night for each eligible option"
        >
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke="var(--rule)" strokeWidth={1} />
              <text x={m.l - 8} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
                {v}
              </text>
            </g>
          ))}
          {ticksX.map(v => (
            <text key={v} x={sx(v)} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">
              £{v}
            </text>
          ))}
          <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
            Public cost per night after subsidy (TA budget + education)
          </text>
          <text x={12} y={(m.t + H - m.b) / 2} textAnchor="middle" fontSize={11} fill="var(--muted)" transform={`rotate(-90 12 ${(m.t + H - m.b) / 2})`}>
            Suitability
          </text>
          {pts.map(c => {
            const isRec = c.propertyId === recommendedId
            const cx = sx(c.cost.publicPerNight)
            const cy = sy(c.score)
            return (
              <g
                key={c.propertyId}
                className="cursor-pointer"
                onMouseEnter={() => setHover(c.propertyId)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick(c.propertyId)}
              >
                <circle cx={cx} cy={cy} r={14} fill="transparent" />
                {isRec && <circle cx={cx} cy={cy} r={10} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                <circle cx={cx} cy={cy} r={5.5} fill={isRec ? 'var(--accent)' : 'var(--s1)'} stroke="var(--surface)" strokeWidth={2} />
                {labels.has(c.propertyId) && (
                  <text
                    x={labels.get(c.propertyId)!.x}
                    y={labels.get(c.propertyId)!.y}
                    textAnchor={labels.get(c.propertyId)!.anchor}
                    fontSize={11}
                    fill="var(--ink)"
                    fontWeight={isRec ? 700 : 400}
                  >
                    {c.label}
                  </text>
                )}
              </g>
            )
          })}
          {hovered && (
            <g pointerEvents="none">
              <rect
                x={Math.min(sx(hovered.cost.publicPerNight) + 10, W - 190)}
                y={Math.max(4, sy(hovered.score) - 52)}
                width={180}
                height={44}
                rx={6}
                fill="var(--surface)"
                stroke="var(--rule)"
              />
              <text
                x={Math.min(sx(hovered.cost.publicPerNight) + 20, W - 180)}
                y={Math.max(4, sy(hovered.score) - 52) + 18}
                fontSize={11}
                fontWeight={700}
                fill="var(--ink)"
              >
                {hovered.label}
              </text>
              <text x={Math.min(sx(hovered.cost.publicPerNight) + 20, W - 180)} y={Math.max(4, sy(hovered.score) - 52) + 34} fontSize={11} fill="var(--muted)">
                Score {hovered.score} · {gbp(hovered.cost.publicPerNight)}/night
              </text>
            </g>
          )}
        </svg>
      </div>
      <figcaption className="mt-1 text-xs text-muted">
        Higher is more suitable; further left costs the public less. Ringed: the recommendation. Click a point for its detail.
      </figcaption>
    </figure>
  )
}
