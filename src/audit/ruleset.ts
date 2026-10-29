import { canonicalize } from './canonical'
import { sha256Hex } from './hash'
import type { Ruleset } from '../engine/types'

/** Hash of the rule-set content (excluding the hash itself). Every decision records it. */
export async function hashRuleset(rs: Ruleset): Promise<Ruleset & { hash: string }> {
  const { hash: _ignored, ...content } = rs
  void _ignored
  return { ...rs, hash: await sha256Hex(canonicalize(content)) }
}
