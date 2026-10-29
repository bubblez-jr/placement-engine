// Browser storage that never throws. In the MVP all data lives in this
// browser only; a pilot moves it to Supabase (London) with row-level isolation.

const memory = new Map<string, string>()

export function load<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw) as T
  } catch {
    /* storage blocked: fall back to memory */
  }
  const m = memory.get(key)
  return m ? (JSON.parse(m) as T) : null
}

export function save(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  memory.set(key, raw)
  try {
    window.localStorage.setItem(key, raw)
  } catch {
    /* storage blocked or full: memory copy keeps the session working */
  }
}

export function remove(key: string): void {
  memory.delete(key)
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
