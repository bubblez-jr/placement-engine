import { AppProvider, useApp } from './store/app'
import { NavProvider, useNav, type Route } from './store/nav'
import { Banner } from './ui/bits'
import { Home } from './ui/screens/Home'
import { NewPlacement } from './ui/screens/NewPlacement'
import { Results } from './ui/screens/Results'
import { PropertyDetail } from './ui/screens/PropertyDetail'
import { Compare } from './ui/screens/Compare'
import { Decide } from './ui/screens/Decide'
import { DecisionRecord } from './ui/screens/DecisionRecord'
import { AuditReport } from './ui/screens/AuditReport'
import { AuditLog } from './ui/screens/AuditLog'
import { Rules } from './ui/screens/Rules'
import { Properties } from './ui/screens/Properties'

const NAV: { view: Route['view']; label: string; match: Route['view'][] }[] = [
  { view: 'home', label: 'Placements', match: ['home', 'decision', 'report'] },
  { view: 'new', label: 'New placement', match: ['new', 'results', 'property', 'compare', 'decide'] },
  { view: 'properties', label: 'Properties', match: ['properties'] },
  { view: 'rules', label: 'Placement policy', match: ['rules'] },
  { view: 'audit', label: 'Audit log', match: ['audit'] },
]

function Shell() {
  const { route, go } = useNav()
  const { activeRuleset, officer } = useApp()
  return (
    <div
      className="min-h-full"
      style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}
    >
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 border-b border-rule py-3">
        <button className="flex items-baseline gap-3 text-left" onClick={() => go({ view: 'home' })}>
          <span className="display text-xl">Placement Engine</span>
          <span className="text-sm text-muted">{activeRuleset.councilName}</span>
        </button>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Banner />
          <span className="text-muted">
            {officer.name} · {officer.role}
          </span>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1240px] gap-6 py-5 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav aria-label="Main" className="lg:sticky lg:top-4 lg:self-start">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {NAV.map(n => {
              const active = n.match.includes(route.view)
              return (
                <li key={n.view}>
                  <button
                    onClick={() => go({ view: n.view } as Route)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full rounded-md px-3 py-2 text-left font-bold ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken'}`}
                  >
                    {n.label}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-4 hidden text-xs leading-relaxed text-faint lg:block">
            Policy v{activeRuleset.version}
            <br />
            <span className="hash">{activeRuleset.hash.slice(0, 12)}</span>
          </div>
        </nav>
        <main className="min-w-0">
          <Screen route={route} />
        </main>
      </div>
      <footer className="mx-auto max-w-[1240px] border-t border-rule py-4 text-xs text-faint">
        Decision support only: the officer makes every placement decision. Demo with invented data; legal references to be confirmed by a solicitor before any
        pilot.
      </footer>
    </div>
  )
}

function Screen({ route }: { route: Route }) {
  switch (route.view) {
    case 'home':
      return <Home />
    case 'new':
      return <NewPlacement scenarioId={route.scenarioId} fromSearchId={route.fromSearchId} />
    case 'results':
      return <Results searchId={route.searchId} />
    case 'property':
      return <PropertyDetail searchId={route.searchId} propertyId={route.propertyId} />
    case 'compare':
      return <Compare searchId={route.searchId} ids={route.ids} />
    case 'decide':
      return <Decide searchId={route.searchId} propertyId={route.propertyId} />
    case 'decision':
      return <DecisionRecord seq={route.seq} />
    case 'report':
      return <AuditReport seq={route.seq} />
    case 'audit':
      return <AuditLog />
    case 'rules':
      return <Rules />
    case 'properties':
      return <Properties />
  }
}

export default function App() {
  return (
    <AppProvider>
      <NavProvider>
        <Shell />
      </NavProvider>
    </AppProvider>
  )
}
