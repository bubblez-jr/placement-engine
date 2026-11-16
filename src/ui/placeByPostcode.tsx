import { useState } from 'react'
import { PLACE_KIND_LABEL } from '../data/places'
import type { Destination, DestinationKind, Person } from '../engine/types'
import { lookupPostcode, type PostcodeLookup } from '../places/postcodes'
import { Icon } from './icons'

const KINDS: DestinationKind[] = ['school', 'work', 'medical', 'care', 'support']

/**
 * "Add a place by postcode": a real location for a school, workplace or
 * clinic, found with postcodes.io. The officer names it and says what it is.
 * If the lookup fails, the example places above still work.
 */
export function PlaceByPostcode({ members, onAdd }: { members: Person[]; onAdd: (d: Omit<Destination, 'id'>) => void }) {
  const [open, setOpen] = useState(false)
  const [postcode, setPostcode] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Extract<PostcodeLookup, { ok: true }> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DestinationKind>('school')
  const [who, setWho] = useState('')
  const [nameError, setNameError] = useState(false)

  if (!open)
    return (
      <button id="pc-open" type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon name="map-pin" size={15} />
        Add a place by postcode
      </button>
    )

  async function look(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setMessage(null)
    setFound(null)
    const r = await lookupPostcode(postcode, (...a) => window.fetch(...a))
    setBusy(false)
    if (r.ok) setFound(r)
    else setMessage(r.message)
  }

  function add() {
    if (!found) return
    if (!name.trim()) return setNameError(true)
    onAdd({
      // Left blank if not chosen: the form then asks who goes there.
      personId: who,
      kind,
      name: name.trim().slice(0, 80),
      refId: `Postcode ${found.postcode}`,
      location: found.location,
      arriveBy: kind === 'school' ? '08:45' : '09:00',
      daysPerWeek: 5,
      placeSource: 'postcode',
      postcode: found.postcode,
    })
    setOpen(false)
    setPostcode('')
    setFound(null)
    setName('')
    setWho('')
    setNameError(false)
  }

  return (
    <div id="postcode-panel" className="grid w-full basis-full gap-3 rounded-lg border border-rule p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="field w-40">
          <span>Postcode</span>
          <input
            id="pc-postcode"
            className="input uppercase"
            value={postcode}
            autoComplete="off"
            onChange={e => setPostcode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), look())}
            aria-describedby="pc-hint"
          />
        </label>
        <button id="pc-lookup" type="button" className="btn" onClick={() => look()} disabled={busy || !postcode.trim()}>
          {busy ? 'Looking up…' : 'Find the place'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p id="pc-hint" className="text-xs text-muted">
        For a school, workplace, clinic or support service. Only the postcode is sent, to postcodes.io (a free public lookup). Do not enter the household’s own
        address.
      </p>
      {message && (
        <p id="pc-message" role="alert" className="text-sm font-medium text-bad">
          {message}
        </p>
      )}
      {found && (
        <div className="grid gap-3" id="pc-found">
          <p className="text-sm text-good" role="status">
            Found {found.postcode}
            {found.district ? `, ${found.district}` : ''}. This is a real location; name the place and say who goes there.
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto] sm:items-end">
            <label className="field">
              <span>Name of the place</span>
              <input
                id="pc-name"
                className="input"
                value={name}
                onChange={e => (setName(e.target.value), setNameError(false))}
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? 'pc-name-error' : undefined}
              />
              {nameError && (
                <span id="pc-name-error" className="text-sm font-medium text-bad">
                  Enter a name for the place.
                </span>
              )}
            </label>
            <label className="field">
              <span>What it is</span>
              <select id="pc-kind" className="input" value={kind} onChange={e => setKind(e.target.value as DestinationKind)}>
                {KINDS.map(k => (
                  <option key={k} value={k}>
                    {PLACE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Who goes there</span>
              <select id="pc-who" className="input" value={who} onChange={e => setWho(e.target.value)}>
                <option value="">Choose…</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <button id="pc-add" type="button" className="btn btn-primary" onClick={add}>
              Add this place
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
