import { useState } from 'react'
import { haversineKm } from '../engine/geo'
import type { Candidate, Household, LatLng, Property } from '../engine/types'

// A schematic map drawn in SVG, with no map tiles: it works offline and inside
// locked-down frames. Distance rings around the home area give scale.

const KIND_MARK: Record<string, string> = { school: 'S', work: 'W', medical: 'M', care: 'C', support: '+' }

export function MiniMap({
  household,
  candidates,
  properties,
  recommendedId,
  onPick,
}: {
  household: Household
  candidates: Candidate[]
  properties: Property[]
  recommendedId: string | null
  onPick: (id: string) => void
}) {
  const [scope, setScope] = useState<'near' | 'all'>('near')
  const [hover, setHover] = useState<string | null>(null)
  const loc = (id: string) => properties.find(p => p.id === id)?.location
  const placed = candidates.map(c => ({ c, at: loc(c.propertyId) })).filter((x): x is { c: Candidate; at: LatLng } => !!x.at)
  const nearKm = 16
  const shown = scope === 'all' ? placed : placed.filter(x => haversineKm(household.homeArea, x.at) <= nearKm)
  const offMap = placed.length - shown.length

  const pts: LatLng[] = [household.homeArea, ...household.destinations.map(d => d.location), ...shown.map(x => x.at)]
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = pts.map(p => p.lng * k)
  const ys = pts.map(p => p.lat)
  const pad = 0.01
  let minX = Math.min(...xs) - pad
  let maxX = Math.max(...xs) + pad
  let minY = Math.min(...ys) - pad
  let maxY = Math.max(...ys) + pad
  const W = 520
  const H = 340
  // keep aspect ratio
  const sx = (maxX - minX) / W
  const sy = (maxY - minY) / H
  const s = Math.max(sx, sy)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  minX = cx - (W * s) / 2
  maxX = cx + (W * s) / 2
  minY = cy - (H * s) / 2
  maxY = cy + (H * s) / 2
  const px = (p: LatLng) => ((p.lng * k - minX) / (maxX - minX)) * W
  const py = (p: LatLng) => H - ((p.lat - minY) / (maxY - minY)) * H
  const kmToPx = 1 / (111.32 * s) // degrees-lat per km ≈ 1/111.32
  const home = { x: px(household.homeArea), y: py(household.homeArea) }
  const rings = scope === 'all' ? [10, 25, 50] : [2, 5, 10]
  const hovered = shown.find(x => x.c.propertyId === hover)

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Map extent">
          <button className={`btn ${scope === 'near' ? 'btn-primary' : ''} px-2.5 py-1 text-sm`} onClick={() => setScope('near')}>
            Within {nearKm} km
          </button>
          <button className={`btn ${scope === 'all' ? 'btn-primary' : ''} px-2.5 py-1 text-sm`} onClick={() => setScope('all')}>
            All properties
          </button>
        </div>
        {offMap > 0 && <span className="text-xs text-muted">{offMap} further away not shown</span>}
      </div>
      <div className="scroll-x rounded-lg border border-rule bg-sunken">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label="Schematic map of the household's places and the properties considered"
        >
          {rings.map(r => (
            <g key={r}>
              <circle cx={home.x} cy={home.y} r={r * kmToPx} fill="none" stroke="var(--rule)" strokeWidth={1} strokeDasharray="3 4" />
              <text x={home.x + r * kmToPx * 0.71 + 3} y={home.y - r * kmToPx * 0.71 - 3} fontSize={10} fill="var(--faint)">
                {r} km
              </text>
            </g>
          ))}
          {household.safeguardingZones.map(z => (
            <g key={z.id}>
              <circle
                cx={px(z.center)}
                cy={py(z.center)}
                r={z.radiusKm * kmToPx}
                fill="var(--bad-soft)"
                stroke="var(--bad)"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                opacity={0.85}
              />
              <text x={px(z.center)} y={py(z.center) + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--bad)">
                Restricted
              </text>
            </g>
          ))}
          {/* ruled-out properties */}
          {shown
            .filter(x => !x.c.eligible)
            .map(({ c, at }) => (
              <g
                key={c.propertyId}
                onMouseEnter={() => setHover(c.propertyId)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick(c.propertyId)}
                className="cursor-pointer"
              >
                <circle cx={px(at)} cy={py(at)} r={10} fill="transparent" />
                <path d={`M${px(at) - 3.5},${py(at) - 3.5} l7,7 M${px(at) + 3.5},${py(at) - 3.5} l-7,7`} stroke="var(--faint)" strokeWidth={1.6} />
              </g>
            ))}
          {/* household places */}
          <g>
            <rect x={home.x - 7} y={home.y - 7} width={14} height={14} rx={3} fill="var(--ink)" />
            <text x={home.x} y={home.y + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--surface)">
              H
            </text>
          </g>
          {household.destinations.map(d => (
            <g key={d.id}>
              <rect x={px(d.location) - 7} y={py(d.location) - 7} width={14} height={14} rx={3} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
              <text x={px(d.location)} y={py(d.location) + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--ink)">
                {KIND_MARK[d.kind]}
              </text>
            </g>
          ))}
          {/* eligible options */}
          {shown
            .filter(x => x.c.eligible)
            .sort((a, b) => (b.c.rank ?? 99) - (a.c.rank ?? 99))
            .map(({ c, at }) => {
              const isRec = c.propertyId === recommendedId
              return (
                <g
                  key={c.propertyId}
                  onMouseEnter={() => setHover(c.propertyId)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick(c.propertyId)}
                  className="cursor-pointer"
                >
                  <circle cx={px(at)} cy={py(at)} r={isRec ? 12 : 9.5} fill={isRec ? 'var(--accent)' : 'var(--s1)'} stroke="var(--surface)" strokeWidth={2} />
                  <text
                    x={px(at)}
                    y={py(at) + 4}
                    textAnchor="middle"
                    fontSize={isRec ? 11 : 10}
                    fontWeight={700}
                    fill={isRec ? 'var(--accent-ink)' : '#ffffff'}
                  >
                    {c.rank}
                  </text>
                </g>
              )
            })}
          {hovered && (
            <g pointerEvents="none">
              <rect
                x={Math.min(px(hovered.at) + 12, W - 200)}
                y={Math.max(4, py(hovered.at) - 46)}
                width={190}
                height={38}
                rx={6}
                fill="var(--surface)"
                stroke="var(--rule)"
              />
              <text x={Math.min(px(hovered.at) + 20, W - 192)} y={Math.max(4, py(hovered.at) - 46) + 16} fontSize={11} fontWeight={700} fill="var(--ink)">
                {hovered.c.label}
              </text>
              <text x={Math.min(px(hovered.at) + 20, W - 192)} y={Math.max(4, py(hovered.at) - 46) + 31} fontSize={10.5} fill="var(--muted)">
                {hovered.c.eligible ? `Rank ${hovered.c.rank} · score ${hovered.c.score}` : `Ruled out: ${hovered.c.blocks[0]?.message.slice(0, 32) ?? ''}`}
              </text>
            </g>
          )}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>■ H home area</span>
        <span>□ S school · W work · M medical · C care · + support</span>
        <span>● numbered: eligible, by rank (ringed colour: recommended)</span>
        <span>✕ ruled out</span>
      </figcaption>
    </figure>
  )
}
