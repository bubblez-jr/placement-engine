import { useSession } from '../../auth/session'
import { ROLE_LABEL } from '../../engine/permissions'
import { Icon, Logo } from '../icons'

export function SignIn() {
  const { auth, signIn } = useSession()
  return (
    <div className="min-h-screen px-4 py-8 sm:py-14">
      <main className="mx-auto grid max-w-[760px] gap-6">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <div className="text-lg leading-tight font-semibold tracking-tight">Placement Engine</div>
            <div className="text-sm text-muted">Demo Borough Council · Housing Needs</div>
          </div>
        </div>
        <div>
          <h1 className="display text-[1.7rem] leading-tight">Sign in</h1>
          <p className="mt-1.5 text-muted">Choose who you are for this demo. Every record you make shows this name and role.</p>
        </div>
        <div className="callout flex gap-3 border-warn bg-warn-soft" role="note">
          <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-sm">
            <b>Demo sign-in, not security.</b> {auth.disclaimer}
          </p>
        </div>
        <section className="panel" aria-labelledby="who-h">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3 sm:px-5">
            <h2 id="who-h" className="text-[0.98rem] font-semibold">
              Demo staff
            </h2>
            <span className="chip chip-warn">Synthetic people</span>
          </div>
          <ul className="divide-y divide-[var(--rule)]">
            {auth.directory().map(u => (
              <li key={u.id}>
                <button
                  id={`signin-${u.id}`}
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--hover)] sm:px-5"
                  onClick={() => signIn(u.id)}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.78rem] font-semibold text-accent">
                    {u.name
                      .split(' ')
                      .map(w => w[0])
                      .join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{u.name}</span>
                    <span className="block text-sm text-muted">
                      {ROLE_LABEL[u.role]} · {u.team}
                    </span>
                  </span>
                  <Icon name="arrow-right" size={17} className="shrink-0 text-faint group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-faint">Synthetic demo: invented households, properties and staff. Data stays in this browser.</p>
      </main>
    </div>
  )
}
