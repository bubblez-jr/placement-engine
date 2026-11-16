import type { StaffUser } from '../engine/types'
import { STAFF, staffById } from '../data/staff'

/**
 * How the app learns who is signed in. Today there is one implementation,
 * DemoAuth: pick a synthetic person, no password. The hosted pilot adds an
 * implementation backed by the council's single sign-on with MFA; nothing
 * else in the app needs to change.
 */
export interface AuthProvider {
  readonly kind: 'demo' | 'sso'
  /** Plain words for the sign-in screen about what this sign-in does and does not prove */
  readonly disclaimer: string
  directory(): StaffUser[]
  currentUser(): StaffUser | null
  signIn(userId: string): StaffUser
  signOut(): void
}

const SESSION_KEY = 'placement-engine/session'
let memory: string | null = null

function read(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY)
  } catch {
    return memory
  }
}
function write(v: string | null) {
  memory = v
  try {
    if (v === null) window.sessionStorage.removeItem(SESSION_KEY)
    else window.sessionStorage.setItem(SESSION_KEY, v)
  } catch {
    /* storage blocked: the memory copy keeps this tab signed in */
  }
}

/** Demo sign-in: the session lasts for this browser tab (sessionStorage). */
export const DemoAuth: AuthProvider = {
  kind: 'demo',
  disclaimer:
    'This is a demo sign-in. There is no password: you choose who to be, so it proves nothing about who you are. Real sign-in, through the council’s single sign-on with multi-factor authentication, comes with the hosted pilot.',
  directory: () => STAFF,
  currentUser() {
    const id = read() ?? memory
    return id ? (staffById(id) ?? null) : null
  },
  signIn(userId) {
    const u = staffById(userId)
    if (!u) throw new Error(`No such demo user: ${userId}`)
    write(u.id)
    return u
  },
  signOut() {
    write(null)
  },
}
