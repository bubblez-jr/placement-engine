import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// Tiny in-page router. Only top-level views go in the URL hash (plain names,
// so links survive being shared); detail views keep their ids in memory.

export type Route =
  | { view: 'home' }
  | { view: 'new'; scenarioId?: string; fromSearchId?: string }
  | { view: 'results'; searchId: string }
  | { view: 'property'; searchId: string; propertyId: string }
  | { view: 'compare'; searchId: string; ids: string[] }
  | { view: 'decide'; searchId: string; propertyId?: string }
  | { view: 'decision'; seq: number }
  | { view: 'report'; seq: number }
  | { view: 'audit' }
  | { view: 'rules' }
  | { view: 'properties' }

const TOP: Route['view'][] = ['home', 'new', 'audit', 'rules', 'properties']

function fromHash(): Route {
  const h = window.location.hash.replace(/^#/, '')
  return (TOP as string[]).includes(h) ? ({ view: h } as Route) : { view: 'home' }
}

interface NavApi {
  route: Route
  go: (r: Route) => void
}

const Ctx = createContext<NavApi | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => {
    try {
      return fromHash()
    } catch {
      return { view: 'home' }
    }
  })
  useEffect(() => {
    const on = () => {
      const r = fromHash()
      setRoute(cur => (TOP.includes(cur.view) || r.view !== 'home' ? r : cur))
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = useCallback((r: Route) => {
    setRoute(r)
    try {
      if (window.location.hash !== `#${r.view}`) history.replaceState(null, '', `#${r.view}`)
    } catch {
      /* sandboxed frames may refuse history changes */
    }
    window.scrollTo({ top: 0 })
  }, [])
  return <Ctx.Provider value={{ route, go }}>{children}</Ctx.Provider>
}

export function useNav(): NavApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNav outside NavProvider')
  return v
}
