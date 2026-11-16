import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { verifyChain, type ChainCheck, type ChainRecord } from '../audit/chain'
import type { DecisionSnapshotV2, PlacementEvent } from '../audit/snapshot'
import { placementsFrom, tasksFrom } from '../audit/records'
import { useSession } from '../auth/session'
import { ukDate } from '../engine/dates'
import type { ConsentInput, DecisionInput } from '../engine/decision'
import { occupancyOf, type OccupiedPeriod } from '../engine/occupancy'
import type { Placement, TransitionInput } from '../engine/placement'
import type { Task } from '../engine/tasks'
import type { Household, Property, Ruleset, SearchResult, TaskOwner } from '../engine/types'
import { estimateProvider } from '../travel/estimate'
import {
  cmdConfirmAvailability,
  cmdDecide,
  cmdPublishRuleset,
  cmdReplaceProperties,
  cmdSearch,
  cmdTamper,
  cmdUndoTamper,
  cmdUpdateConsent,
  cmdTransition,
  cmdExtendStay,
  cmdDecideApproval,
  cmdPlaceOutOfHours,
  cmdCompleteTask,
  cmdReassignTask,
  cmdCancelTask,
  openCases,
  type CommandCtx,
} from './commands'
import { activeRulesetOf, type AppData, type HashedRuleset, type ReviewLog } from './data'
import { cmdReset, seedDemo } from './demo'
import { KEY_V1, KEY_V2, loadStored } from './migrate'
import { load, remove, save } from './storage'

export type { AppData, HashedRuleset, ReviewLog } from './data'

type Sealed = Promise<ChainRecord<PlacementEvent>>

interface AppApi {
  data: AppData
  ready: boolean
  /**
   * The time screens work from: read at the edge, refreshed every 30 seconds,
   * when the tab regains focus and after every change, so a page left open
   * does not go stale. Hold expiry, due states and day counters use it; no
   * sealed record ever contains it.
   */
  now: string
  /** Derived at `now` from the chain and inventory; never stored */
  placements: Placement[]
  tasks: Task[]
  occupancy: OccupiedPeriod[]
  activeRuleset: HashedRuleset
  search: (h: Household) => Promise<SearchResult>
  getSearch: (id: string) => SearchResult | undefined
  openCases: ReturnType<typeof openCases>
  review: (searchId: string) => ReviewLog
  noteReview: (searchId: string, patch: Partial<ReviewLog> & { propertyOpened?: string }) => void
  decide: (searchId: string, input: DecisionInput) => Promise<ChainRecord<DecisionSnapshotV2>>
  updateConsent: (seq: number, input: ConsentInput) => Sealed
  transition: (seq: number, input: TransitionInput) => Sealed
  extendStay: (seq: number, input: { newEnd?: string; reason?: string }) => Sealed
  decideApproval: (seq: number, input: { outcome?: 'approved' | 'rejected'; reason?: string }) => Sealed
  placeOutOfHours: (seq: number, input: { reason?: string }) => Sealed
  completeTask: (taskId: string, input: { evidence?: string; reference?: string }) => Sealed
  reassignTask: (taskId: string, input: { to?: TaskOwner | null; note?: string }) => Sealed
  cancelTask: (taskId: string, input: { reason?: string }) => Sealed
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
  const [now, setNow] = useState(() => new Date().toISOString())

  useEffect(() => {
    const tick = () => setNow(new Date().toISOString())
    const id = window.setInterval(tick, 30_000)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const now = new Date().toISOString()
      const d = loadStored({ load }, now) ?? (await seedDemo(now))
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
    setNow(new Date().toISOString())
  }, [])

  const derived = useMemo(() => {
    if (!data) return null
    const placements = placementsFrom(data.chain, now)
    return {
      placements,
      occupancy: occupancyOf(placements, now),
      tasks: tasksFrom(data.chain, data.properties, activeRulesetOf(data), now),
    }
  }, [data, now])

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
    return { user: userRef.current, now: n.toISOString(), today: ukDate(n.toISOString()) }
  }
  const seal = async (p: Promise<{ data: AppData; record: ChainRecord<PlacementEvent> }>) => {
    const { data: next, record } = await p
    commit(next)
    return record
  }

  const api: AppApi | null = useMemo(() => {
    if (!data || !derived) return null
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
      now,
      ...derived,
      activeRuleset: activeRulesetOf(data),
      openCases: openCases(data, now),
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
      transition: (seq, input) => seal(cmdTransition(current(), ctx(), seq, input)),
      extendStay: (seq, input) => seal(cmdExtendStay(current(), ctx(), seq, input)),
      decideApproval: (seq, input) => seal(cmdDecideApproval(current(), ctx(), seq, input)),
      placeOutOfHours: (seq, input) => seal(cmdPlaceOutOfHours(current(), ctx(), seq, input)),
      completeTask: (id, input) => seal(cmdCompleteTask(current(), ctx(), id, input)),
      reassignTask: (id, input) => seal(cmdReassignTask(current(), ctx(), id, input)),
      cancelTask: (id, input) => seal(cmdCancelTask(current(), ctx(), id, input)),
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
  }, [data, derived, now, commit])

  if (!api) return <div className="p-8 text-muted">Loading…</div>
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useApp(): AppApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
