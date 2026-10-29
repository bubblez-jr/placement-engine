import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { appendRecord, verifyChain, type ChainCheck, type ChainRecord } from '../audit/chain'
import { hashRuleset } from '../audit/ruleset'
import type { DecisionSnapshot } from '../audit/snapshot'
import { statutoryClocks } from '../engine/clocks'
import { toIsoDate } from '../engine/dates'
import { runSearch } from '../engine/search'
import type { Decision, Household, Property, Ruleset, SearchResult, Supplier } from '../engine/types'
import { seedProperties, SUPPLIERS } from '../data/properties'
import { defaultRuleset } from '../data/ruleset'
import { estimateProvider } from '../travel/estimate'
import { load, remove, save } from './storage'

const KEY = 'placement-engine/v1'

export type HashedRuleset = Ruleset & { hash: string }

export interface AppData {
  schema: 1
  seededAt: string
  rulesets: HashedRuleset[]
  activeVersion: string
  properties: Property[]
  propertiesVersion: string
  suppliers: Supplier[]
  searches: SearchResult[]
  chain: ChainRecord[]
  /** Demo only: original snapshot kept while a tampering demo is active */
  tamperBackup?: { seq: number; snapshot: DecisionSnapshot }
}

export interface ReviewLog {
  resultsOpenedAt: string
  propertiesOpened: string[]
  comparisonOpened: boolean
}

export interface Officer {
  name: string
  role: string
}

interface AppApi {
  data: AppData
  ready: boolean
  officer: Officer
  setOfficer: (o: Officer) => void
  activeRuleset: HashedRuleset
  search: (h: Household) => Promise<SearchResult>
  getSearch: (id: string) => SearchResult | undefined
  review: (searchId: string) => ReviewLog
  noteReview: (searchId: string, patch: Partial<ReviewLog> & { propertyOpened?: string }) => void
  decide: (searchId: string, d: Omit<Decision, 'reviewed' | 'decidedAt'> & { confirmedFullListReviewed: boolean }) => Promise<ChainRecord>
  publishRuleset: (draft: Ruleset) => Promise<HashedRuleset>
  replaceProperties: (props: Property[], mode: 'add' | 'replace') => void
  confirmAvailability: (propertyId: string) => void
  verify: () => Promise<ChainCheck>
  tamper: () => void
  undoTamper: () => void
  resetDemo: () => Promise<void>
}

const Ctx = createContext<AppApi | null>(null)

async function seed(): Promise<AppData> {
  const now = new Date().toISOString()
  const today = toIsoDate(new Date())
  const rs = await hashRuleset(defaultRuleset(now))
  return {
    schema: 1,
    seededAt: now,
    rulesets: [rs],
    activeVersion: rs.version,
    properties: seedProperties(today, now),
    propertiesVersion: `inventory ${now.slice(0, 16).replace('T', ' ')}`,
    suppliers: SUPPLIERS,
    searches: [],
    chain: [],
  }
}

function nextVersion(v: string): string {
  const [maj, min] = v.split('.').map(Number)
  return `${maj}.${(min ?? 0) + 1}`
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null)
  const [officer, setOfficerState] = useState<Officer>(() => load<Officer>(`${KEY}/officer`) ?? { name: 'Sam Okafor', role: 'Temporary Accommodation Officer' })
  const reviews = useRef(new Map<string, ReviewLog>())
  const [, bump] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = load<AppData>(KEY)
      const d = stored && stored.schema === 1 ? stored : await seed()
      if (!cancelled) {
        setData(d)
        save(KEY, d)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const commit = useCallback((next: AppData) => {
    setData(next)
    save(KEY, next)
  }, [])

  const dataRef = useRef(data)
  dataRef.current = data
  const current = () => {
    if (!dataRef.current) throw new Error('App data not loaded yet')
    return dataRef.current
  }

  const activeRuleset = useMemo(() => {
    if (!data) return null
    return data.rulesets.find(r => r.version === data.activeVersion) ?? data.rulesets[data.rulesets.length - 1]
  }, [data])

  const api: AppApi | null = useMemo(() => {
    if (!data || !activeRuleset) return null
    const getReview = (id: string): ReviewLog => {
      let r = reviews.current.get(id)
      if (!r) {
        r = { resultsOpenedAt: new Date().toISOString(), propertiesOpened: [], comparisonOpened: false }
        reviews.current.set(id, r)
      }
      return r
    }
    return {
      data,
      ready: true,
      officer,
      setOfficer: o => {
        setOfficerState(o)
        save(`${KEY}/officer`, o)
      },
      activeRuleset,
      async search(h) {
        const d = current()
        const rs = d.rulesets.find(r => r.version === d.activeVersion)!
        const result = await runSearch({
          household: h,
          properties: d.properties,
          suppliers: d.suppliers,
          ruleset: rs,
          travel: estimateProvider,
          now: new Date().toISOString(),
          dataVersions: { properties: d.propertiesVersion, reference: 'synthetic reference places v1' },
        })
        commit({ ...d, searches: [result, ...d.searches].slice(0, 40) })
        return result
      },
      getSearch: id => data.searches.find(s => s.id === id),
      review: getReview,
      noteReview(id, patch) {
        const r = getReview(id)
        if (patch.propertyOpened && !r.propertiesOpened.includes(patch.propertyOpened)) r.propertiesOpened.push(patch.propertyOpened)
        if (patch.comparisonOpened) r.comparisonOpened = true
        bump(x => x + 1)
      },
      async decide(searchId, input) {
        const d = current()
        const search = d.searches.find(s => s.id === searchId)
        if (!search) throw new Error('Search not found')
        const rs = d.rulesets.find(r => r.hash === search.rulesetHash) ?? d.rulesets.find(r => r.version === search.rulesetVersion)!
        const r = getReview(searchId)
        const decision: Decision = {
          outcome: input.outcome,
          chosenPropertyId: input.chosenPropertyId,
          overrideReason: input.overrideReason,
          reasonText: input.reasonText,
          officer: input.officer,
          officerRole: input.officerRole,
          decidedAt: new Date().toISOString(),
          reviewed: {
            resultsOpenedAt: r.resultsOpenedAt,
            propertiesOpened: [...r.propertiesOpened],
            comparisonOpened: r.comparisonOpened,
            confirmedFullListReviewed: input.confirmedFullListReviewed,
          },
          startDate: input.startDate,
          consentToNotifyServices: input.consentToNotifyServices,
        }
        const chosen = d.properties.find(p => p.id === input.chosenPropertyId)
        const clocks = chosen ? statutoryClocks(search.household, chosen, rs, decision) : []
        const snapshot: DecisionSnapshot = {
          schema: 'placement-decision/1',
          frozenAt: decision.decidedAt,
          councilName: rs.councilName,
          search,
          ruleset: rs,
          properties: d.properties.filter(p => search.candidates.some(c => c.propertyId === p.id)),
          decision,
          clocks,
          notes: ['SYNTHETIC DEMO DATA. Not a real household or property.', search.travelProvider.disclaimer, rs.subsidy.source],
        }
        const record = await appendRecord(d.chain, snapshot)
        commit({ ...d, chain: [...d.chain, record] })
        return record
      },
      async publishRuleset(draft) {
        const d = current()
        const latest = d.rulesets[d.rulesets.length - 1]
        const next = await hashRuleset({ ...draft, version: nextVersion(latest.version), effectiveFrom: toIsoDate(new Date()), hash: undefined })
        commit({ ...d, rulesets: [...d.rulesets, next], activeVersion: next.version })
        return next
      },
      replaceProperties(props, mode) {
        const d = current()
        const now = new Date().toISOString()
        const merged = mode === 'replace' ? props : [...d.properties.filter(p => !props.some(n => n.id === p.id)), ...props]
        commit({ ...d, properties: merged, propertiesVersion: `inventory ${now.slice(0, 16).replace('T', ' ')} (import)` })
      },
      confirmAvailability(pid) {
        const d = current()
        const now = new Date().toISOString()
        commit({
          ...d,
          properties: d.properties.map(p => (p.id === pid ? { ...p, availabilityConfirmedAt: now, availabilityConfirmedBy: officer.name } : p)),
          propertiesVersion: `inventory ${now.slice(0, 16).replace('T', ' ')}`,
        })
      },
      verify: () => verifyChain(current().chain),
      tamper() {
        const d = current()
        if (d.chain.length === 0 || d.tamperBackup) return
        const target = d.chain[0]
        const altered: DecisionSnapshot = structuredClone(target.snapshot)
        altered.decision.reasonText = `${altered.decision.reasonText} [edited after the decision]`
        commit({
          ...d,
          chain: d.chain.map(r => (r.seq === target.seq ? { ...r, snapshot: altered } : r)),
          tamperBackup: { seq: target.seq, snapshot: target.snapshot },
        })
      },
      undoTamper() {
        const d = current()
        if (!d.tamperBackup) return
        const b = d.tamperBackup
        commit({ ...d, chain: d.chain.map(r => (r.seq === b.seq ? { ...r, snapshot: b.snapshot } : r)), tamperBackup: undefined })
      },
      async resetDemo() {
        remove(KEY)
        reviews.current.clear()
        commit(await seed())
      },
    }
  }, [data, activeRuleset, officer, commit])

  if (!api) return <div className="p-8 text-muted">Loading…</div>
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useApp(): AppApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
