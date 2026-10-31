import { AppProvider, useApp } from './store/app'
import { NavProvider, useNav, type Route } from './store/nav'
import { Icon, Logo } from './ui/icons'
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

const NAV: { view: Route['view']; label: string; icon: Parameters<typeof Icon>[0]['name']; match: Route['view'][] }[] = [
  { view: 'home', label: 'Overview', icon: 'home', match: ['home', 'decision', 'report'] },
  { view: 'new', label: 'New placement', icon: 'plus', match: ['new', 'results', 'property', 'compare', 'decide'] },
  { view: 'properties', label: 'Properties', icon: 'building', match: ['properties'] },
  { view: 'rules', label: 'Placement policy', icon: 'sliders', match: ['rules'] },
  { view: 'audit', label: 'Audit log', icon: 'shield', match: ['audit'] },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('')
}

function Shell() {
  const { route, go } = useNav()
  const { activeRuleset, officer } = useApp()
  const nav = (
    <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {NAV.map(n => {
        const active = n.match.includes(route.view)
        return (
          <li key={n.view} className="shrink-0">
            <button
              onClick={() => go({ view: n.view } as Route)}
              aria-current={active ? 'page' : undefined}
              className="rail-link flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.9rem] font-medium transition-colors"
            >
              <Icon name={n.icon} size={17} />
              {n.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <div style={{ background: 'var(--rail)' }}>
        <aside
          className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col"
          style={{
            color: 'var(--rail-ink)',
            paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
            paddingRight: '16px',
          }}
        >
          <div className="flex items-center justify-between gap-3 py-4 lg:py-5">
            <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => go({ view: 'home' })}>
              <Logo />
              <span className="min-w-0">
                <span className="block text-[0.98rem] leading-tight font-semibold tracking-tight">Placement Engine</span>
                <span className="block truncate text-xs" style={{ color: 'var(--rail-muted)' }}>
                  {activeRuleset.councilName}
                </span>
              </span>
            </button>
            <span className="chip chip-warn lg:hidden">Demo data</span>
          </div>
          <nav aria-label="Main" className="pb-3 lg:flex-1 lg:pb-0">
            {nav}
          </nav>
          <div className="hidden gap-3 border-t py-4 text-xs lg:grid lg:grid-cols-1" style={{ borderColor: 'var(--rail-active)', color: 'var(--rail-muted)' }}>
            <div className="rounded-lg px-3 py-2" style={{ background: 'var(--rail-hover)' }}>
              <div className="font-semibold" style={{ color: '#f3c46a' }}>
                Synthetic demo data
              </div>
              <div>Invented households and properties</div>
            </div>
            <div className="px-1">
              Policy v{activeRuleset.version} · <span className="hash">{activeRuleset.hash.slice(0, 10)}</span>
            </div>
            <div className="flex items-center gap-2.5 px-1">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold"
                style={{ background: 'var(--rail-active)', color: 'var(--rail-accent)' }}
              >
                {initials(officer.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium" style={{ color: 'var(--rail-ink)' }}>
                  {officer.name}
                </span>
                <span className="block truncate">{officer.role}</span>
              </span>
            </div>
          </div>
        </aside>
      </div>
      <div className="min-w-0" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
        <main className="mx-auto max-w-[1200px] py-6 lg:px-4 lg:py-8">
          <Screen route={route} />
        </main>
        <footer className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 border-t border-rule py-4 text-xs text-faint lg:px-4">
          <span>Decision support only: the officer makes every placement decision.</span>
          <span>Demo with invented data · legal references to be confirmed before any pilot</span>
        </footer>
      </div>
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
