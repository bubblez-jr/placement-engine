import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { StaffUser } from '../engine/types'
import { DemoAuth, type AuthProvider } from './provider'

interface SessionApi {
  user: StaffUser | null
  auth: AuthProvider
  signIn: (userId: string) => void
  signOut: () => void
}

const Ctx = createContext<SessionApi | null>(null)

export function SessionProvider({ children, auth = DemoAuth }: { children: ReactNode; auth?: AuthProvider }) {
  const [user, setUser] = useState<StaffUser | null>(() => auth.currentUser())
  const signIn = useCallback((id: string) => setUser(auth.signIn(id)), [auth])
  const signOut = useCallback(() => {
    auth.signOut()
    setUser(null)
  }, [auth])
  return <Ctx.Provider value={{ user, auth, signIn, signOut }}>{children}</Ctx.Provider>
}

export function useSession(): SessionApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}

/** The signed-in person. Only for screens rendered behind the sign-in gate. */
export function useUser(): StaffUser {
  const { user } = useSession()
  if (!user) throw new Error('No one is signed in')
  return user
}
