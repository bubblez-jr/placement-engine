import { canonicalize } from './canonical'
import { sha256Hex } from './hash'
import type { DecisionSnapshot } from './snapshot'

export const GENESIS = '0'.repeat(64)

export interface ChainRecord {
  seq: number
  prevHash: string
  /** SHA-256 of `seq|prevHash|canonical(snapshot)` */
  rowHash: string
  snapshot: DecisionSnapshot
}

async function hashRow(seq: number, prevHash: string, snapshot: DecisionSnapshot): Promise<string> {
  return sha256Hex(`${seq}|${prevHash}|${canonicalize(snapshot)}`)
}

/**
 * Append-only: a new record links to the previous record's hash, so changing
 * any earlier decision breaks every hash after it. In a pilot the same scheme
 * runs in an insert-only Postgres table, with the latest hash copied daily to
 * write-once storage.
 */
export async function appendRecord(chain: ChainRecord[], snapshot: DecisionSnapshot): Promise<ChainRecord> {
  const prev = chain[chain.length - 1]
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.rowHash : GENESIS
  return { seq, prevHash, rowHash: await hashRow(seq, prevHash, snapshot), snapshot }
}

export interface ChainCheck {
  ok: boolean
  checked: number
  brokenAt?: number
  reason?: string
}

export async function verifyChain(chain: ChainRecord[]): Promise<ChainCheck> {
  let prevHash = GENESIS
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i]
    if (r.seq !== i + 1) return { ok: false, checked: i, brokenAt: r.seq, reason: `Record ${r.seq} is out of sequence` }
    if (r.prevHash !== prevHash) return { ok: false, checked: i, brokenAt: r.seq, reason: `Record ${r.seq} does not link to record ${r.seq - 1}` }
    const expected = await hashRow(r.seq, r.prevHash, r.snapshot)
    if (expected !== r.rowHash) return { ok: false, checked: i, brokenAt: r.seq, reason: `Record ${r.seq} has been changed since it was saved` }
    prevHash = r.rowHash
  }
  return { ok: true, checked: chain.length }
}
