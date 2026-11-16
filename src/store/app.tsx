import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { verifyChain, type ChainCheck, type ChainRecord } from '../audit/chain'
import type { DecisionSnapshotV2, PlacementEvent } from '../audit/snapshot'
import { useSession } from '../auth/session'
import { toIsoDate } from '../engine/dates'
import type { ConsentInput, DecisionInput } from '../engine/decision'
import type { Household, Property, Ruleset, SearchResult } from '../engine/types'
import { estimateProvider } from '../travel/estimate'
import {
  cmdConfirmAvailability,
  cmdDecide,
  cmdPublishRuleset,
  cmdReplaceProperties,
  cmdReset,
  cmdSearch,
  cmdTamper,
  cmdUndoTamper,
  cmdUpdateConsent,
  openCases,
  type CommandCtx,
} from './commands'
import { activeRulesetOf, seed, type AppData, type HashedRuleset, type ReviewLog } from './data'
import { KEY_V1, KEY_V2, loadStored } from './migrate'
import { load, remove, save } from './storage'

export type { AppData, HashedRuleset, ReviewLog } from './data'

interface AppApi {
  data: AppData
  ready: boolean
  activeRuleset: HashedRuleset
  search: (h: Household) => Promise<SearchResult>
  getSearch: (id: string) => SearchResult | undefined
  openCases: ReturnType<typeof openCases>
  review: (searchId: string) => ReviewLog
  noteReview: (searchId: string, patch: Partial<ReviewLog> & { propertyOpened?: string }) => void
  decide: (searchId: string, input: DecisionInput) => Promise<ChainRecord<DecisionSnapshotV2>>
  updateConsent: (seq: number, input: ConsentInput) => Promise<ChainRecord<PlacementEvent>>
  publishRuleset: (draft: Ruleset, equalityNote: string) => Promise<HashedRuleset>
  replaceProperties: (props: Property[], mode: 'add' | 'replace') => void
  confirmAvailability: (propertyId: string) => void
  verify: () => Promise<ChainCheck>
  tamper: () => void
  undoTamper: () => void
  resetDemo: () => Promise<void>
}

const Ctx = createContext<AppApi | null>(null)

function searchId(): string {
  return `S-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const [data, setData] = useState<AppData | null>(null)
  const reviews = useRef(new Map<string, ReviewLog>())
  const [, bump] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const now = new Date().toISOString()
      const d = loadStored({ load }, now) ?? (await seed(now, toIsoDate(new Date())))
      if (!cancelled) {
        setData(d)
        save(KEY_V2, d)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const commit = useCallback((next: AppData) => {
    setData(next)
    save(KEY_V2, next)
  }, [])

  const dataRef = useRef(data)
  dataRef.current = data
  const userRef = useRef(user)
  userRef.current = user
  const current = () => {
    if (!dataRef.current) throw new Error('App data not loaded yet')
    return dataRef.current
  }
  // Time and the actor are read here, at the edge; the commands and the engine stay pure.
  const ctx = (): CommandCtx => {
    const n = new Date()
    return { user: userRef.current, now: n.toISOString(), today: toIsoDate(n) }
  }

  const api: AppApi | null = useMemo(() => {
    if (!data) return null
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
      activeRuleset: activeRulesetOf(data),
      openCases: openCases(data),
      async search(h) {
        const { data: next, result } = await cmdSearch(current(), ctx(), h, { id: searchId(), travel: estimateProvider })
        commit(next)
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
      async decide(id, input) {
        const { data: next, record } = await cmdDecide(current(), ctx(), id, input, getReview(id))
        commit(next)
        return record
      },
      async updateConsent(seq, input) {
        const { data: next, record } = await cmdUpdateConsent(current(), ctx(), seq, input)
        commit(next)
        return record
      },
      async publishRuleset(draft, equalityNote) {
        const { data: next, ruleset } = await cmdPublishRuleset(current(), ctx(), draft, equalityNote)
        commit(next)
        return ruleset
      },
      replaceProperties: (props, mode) => commit(cmdReplaceProperties(current(), ctx(), props, mode)),
      confirmAvailability: pid => commit(cmdConfirmAvailability(current(), ctx(), pid)),
      verify: () => verifyChain(current().chain),
      tamper: () => commit(cmdTamper(current(), ctx())),
      undoTamper: () => commit(cmdUndoTamper(current(), ctx())),
      async resetDemo() {
        const fresh = await cmdReset(ctx())
        remove(KEY_V1)
        reviews.current.clear()
        commit(fresh)
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, commit])

  if (!api) return <div className="p-8 text-muted">Loading…</div>
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useApp(): AppApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
