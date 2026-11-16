import { Document, Page, pdf, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ChainRecord, DecisionRecord } from '../audit/chain'
import { clocksNow, consentAtDecision, consentSummary, currentConsent, deciderOf, statusLine, storyOf, termsRows } from '../audit/records'
import { ACCESS_QUESTIONS, effectiveAccessNeeds, needSentence, subjectLabel } from '../engine/access'
import { formatDate, formatDateTime } from '../engine/dates'
import { TIER_LABEL } from '../engine/scoring'
import { journeySourceOf } from '../engine/journeys'
import { JOURNEY_SOURCE_LABEL, journeyView, subsidyOfSearch } from '../audit/provenance'

// The audit pack as a PDF, rendered from the sealed snapshot (never from live
// data), with the record and policy hashes printed on every page.

const ink = '#142429'
const muted = '#4b5e63'
const rule = '#c9d3d1'

const st = StyleSheet.create({
  page: { padding: 36, paddingBottom: 54, fontSize: 9, fontFamily: 'Helvetica', color: ink, lineHeight: 1.35 },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 1.2, borderBottomColor: ink },
  small: { fontSize: 7.5, color: muted },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: rule, paddingVertical: 2.5 },
  k: { width: 120, color: muted },
  v: { flex: 1 },
  th: { fontFamily: 'Helvetica-Bold', color: muted, fontSize: 7.5 },
  footer: { position: 'absolute', bottom: 22, left: 36, right: 36, fontSize: 7, color: muted, flexDirection: 'row', justifyContent: 'space-between' },
  banner: { marginTop: 6, padding: 5, backgroundColor: '#f9edd2', fontSize: 8 },
})

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={st.row} wrap={false}>
      <Text style={st.k}>{k}</Text>
      <Text style={st.v}>{v}</Text>
    </View>
  )
}

function AuditDoc({ r, chain, now }: { r: DecisionRecord; chain: ChainRecord[]; now: string }) {
  const { search: s, decision: d, ruleset: rs, properties } = r.snapshot
  const clocks = clocksNow(chain, r)
  const by = deciderOf(r.snapshot)
  const consent = currentConsent(chain, r)
  const story = storyOf(chain, r)
  const h = s.household
  const needs = effectiveAccessNeeds(h)
  const eligible = s.candidates.filter(c => c.eligible).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const rejected = s.candidates.filter(c => !c.eligible)
  const chosen = s.candidates.find(c => c.propertyId === d.chosenPropertyId)
  const prop = properties.find(p => p.id === d.chosenPropertyId)
  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
  const person = (id: string) => s.household.members.find(m => m.id === id)?.label ?? id
  const journeys = journeyView(s)
  const subsidy = subsidyOfSearch(s, rs)
  const placeSource = (x: (typeof h.destinations)[number]) =>
    x.placeSource === 'postcode'
      ? `located from postcode ${x.postcode ?? ''}`
      : x.placeSource === 'import'
        ? 'from the imported file'
        : 'synthetic example place'
  const money = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return (
    <Document title={`Placement decision record ${r.seq}`} author={rs.councilName} subject={`Case ${s.household.caseRef}`}>
      <Page size="A4" style={st.page}>
        <Text style={st.small}>{rs.councilName} · Housing Needs</Text>
        <Text style={st.h1}>Placement decision record #{r.seq}</Text>
        <Text>
          Case {s.household.caseRef} · sealed {formatDateTime(r.snapshot.frozenAt)}
        </Text>
        <Text style={st.banner}>SYNTHETIC DEMO DATA: invented household and properties. Decision support only: the officer named below made the decision.</Text>

        <Text style={st.h2}>1. Decision</Text>
        <KV
          k="Outcome"
          v={d.outcome === 'accepted' ? 'Recommendation accepted' : d.outcome === 'override' ? 'Officer chose another option' : 'No suitable option available'}
        />
        <KV k="Placement" v={chosen && prop ? `${chosen.label}, ${prop.address}` : '—'} />
        <KV k="Starts" v={chosen ? formatDate(d.startDate) : '—'} />
        <KV
          k="Decided by"
          v={`${by.name}, ${by.roleLabel}, ${formatDateTime(d.decidedAt)}. ${by.signedIn ? 'From the signed-in session (demo sign-in, no password).' : 'Name typed on the form under the earlier version, before sign-in.'}`}
        />
        {consentAtDecision(r.snapshot).kind !== 'not_applicable' && (
          <KV
            k="Consent to notify"
            v={`${consentSummary(consent.now)}${consent.now.kind === 'record' ? `. Recorded by ${consent.now.consent.recordedBy.name}, ${formatDateTime(consent.now.consent.recordedAt)}` : ''}${consent.updates.length ? `. Changed after the decision (record ${consent.updates.map(u => `#${u.seq}`).join(', ')}); at the decision: ${consentSummary(consentAtDecision(r.snapshot))}` : ''}`}
          />
        )}
        {d.outcome === 'override' && <KV k="Recommended instead" v={rec?.label ?? ''} />}
        {d.reasonText ? <KV k={d.outcome === 'no_suitable' ? 'Search steps' : 'Officer’s words'} v={`“${d.reasonText}”`} /> : null}
        {termsRows(r).map(([k, v]) => (
          <KV key={k} k={k} v={v} />
        ))}
        <KV
          k="Review before deciding"
          v={`Options opened ${formatDateTime(d.reviewed.resultsOpenedAt)}; details opened: ${d.reviewed.propertiesOpened.length ? d.reviewed.propertiesOpened.join(', ') : 'none'}; comparison ${d.reviewed.comparisonOpened ? 'opened' : 'not opened'}; confirmed full list reviewed: ${d.reviewed.confirmedFullListReviewed ? 'yes' : 'no'}`}
        />

        <Text style={st.h2}>2. Household needs</Text>
        <Text>
          Needed from {formatDate(s.household.needFrom)} for about {s.household.expectedNights} nights. Last settled area: {s.household.homeAreaLabel}. Bedroom
          need: {s.bedroomNeed}. Safeguarding exclusion zones: {s.household.safeguardingZones.length} (details restricted).
        </Text>
        <Text>Access checks applied: {needs.length ? needs.map(needSentence).join('; ') : 'none'}.</Text>
        {(h.accessAssessments ?? []).map(a => (
          <KV
            key={a.subject}
            k={`Access answers: ${subjectLabel(h, a.subject)}`}
            v={`${ACCESS_QUESTIONS.map(q => `${q.question}: ${a.answers[q.key] ?? 'not answered'}`).join('; ')}. Answered by ${a.answeredBy?.name ?? 'not recorded'}${a.answeredAt ? `, ${formatDateTime(a.answeredAt)}` : ''}${a.note ? `. Note: ${a.note}` : ''}`}
          />
        ))}
        {(h.accessNeeds ?? []).length > 0 && (
          <Text>Recorded for the whole household under the earlier version: {h.accessNeeds.join(', ').replaceAll('_', ' ')}.</Text>
        )}
        {h.importedFrom && (
          <Text>
            Details imported from {h.importedFrom.system ?? 'a case system file'} by {h.importedFrom.importedBy.name},{' '}
            {formatDateTime(h.importedFrom.importedAt)}, then reviewed on the form.
          </Text>
        )}
        {(s.validation ?? []).map((w, i) => (
          <Text key={`w${i}`} style={st.small}>
            Warning when searched: {w.message}
          </Text>
        ))}
        {s.household.members.map(m => (
          <KV
            key={m.id}
            k={`${m.label}, ${m.age}`}
            v={
              s.household.destinations
                .filter(x => x.personId === m.id)
                .map(x => `${x.name} (arrive ${x.arriveBy}; ${placeSource(x)})`)
                .join('; ') || '—'
            }
          />
        ))}

        <Text style={st.h2}>3. Policy applied</Text>
        <Text>
          {rs.name} v{rs.version}, signed off by {rs.signOff.by} on {formatDate(rs.signOff.at)}.
        </Text>
        <Text style={st.small}>{rs.signOff.equalityNote}</Text>
        <Text style={st.small}>Policy hash {rs.hash}</Text>
        {rs.criteria.map(c => (
          <KV
            key={c.key}
            k={c.label}
            v={`${c.legalFactor} · weight for this household ${s.effectiveWeights[c.key] > 0 ? s.effectiveWeights[c.key].toFixed(1) : 'n/a'}`}
          />
        ))}

        <Text style={st.h2}>4. Recommendation</Text>
        <Text style={{ fontFamily: 'Helvetica-Bold' }}>{s.explanation.headline}</Text>
        {[...s.explanation.reasons, ...s.explanation.cost, ...s.explanation.caveats].map((x, i) => (
          <Text key={i}>• {x}</Text>
        ))}

        <Text style={st.h2}>5. Options considered ({eligible.length})</Text>
        <View style={st.row}>
          <Text style={[st.th, { width: 24 }]}>Rank</Text>
          <Text style={[st.th, { flex: 1 }]}>Property</Text>
          <Text style={[st.th, { width: 130 }]}>Location</Text>
          <Text style={[st.th, { width: 40, textAlign: 'right' }]}>Score</Text>
          <Text style={[st.th, { width: 60, textAlign: 'right' }]}>TA/night</Text>
          <Text style={[st.th, { width: 70, textAlign: 'right' }]}>Public, stay</Text>
        </View>
        {eligible.map(c => (
          <View key={c.propertyId} style={st.row} wrap={false}>
            <Text style={{ width: 24 }}>{c.rank}</Text>
            <Text style={{ flex: 1 }}>
              {c.label}
              {c.propertyId === s.recommendedId ? ' (recommended)' : ''}
              {c.propertyId === d.chosenPropertyId ? ' (chosen)' : ''}
            </Text>
            <Text style={{ width: 130 }}>
              {c.district}, {TIER_LABEL[c.tier].toLowerCase()}
            </Text>
            <Text style={{ width: 40, textAlign: 'right' }}>{c.score.toFixed(1)}</Text>
            <Text style={{ width: 60, textAlign: 'right' }}>{money(c.cost.taNetPerNight)}</Text>
            <Text style={{ width: 70, textAlign: 'right' }}>{money(c.cost.publicStay)}</Text>
          </View>
        ))}

        <Text style={st.h2}>6. Options ruled out ({rejected.length})</Text>
        {rejected.map(c => (
          <KV key={c.propertyId} k={c.label} v={c.blocks.map(b => b.message).join('; ')} />
        ))}

        {chosen && (
          <>
            <Text style={st.h2}>7. Evidence for the chosen property</Text>
            {chosen.checks.map((c, i) => (
              <Text key={i}>
                {c.severity === 'warn' ? '! ' : c.passed ? 'PASS ' : 'FAIL '}
                {c.message} <Text style={st.small}>({c.legalBasis})</Text>
              </Text>
            ))}
            <Text style={st.small}>{journeys.headline}</Text>
            {chosen.journeys.map(j => (
              <Text key={j.destinationId}>
                Journey: {person(j.personId)} to {j.name}: {j.minutes === null ? 'no public transport route found' : `${j.minutes} min`}, {j.distanceKm} km (
                {JOURNEY_SOURCE_LABEL[journeySourceOf(j, s.travelProvider)].toLowerCase()})
              </Text>
            ))}
            <Text style={st.small}>
              Costs use {subsidy.label.toLowerCase()}. {subsidy.detail}
            </Text>
            {chosen.cost.lines.map(l => (
              <Text key={l.key}>
                Cost: {l.label}: {money(l.perUnit)}/{l.unit}, {money(l.stayTotal)} over the stay ({l.basis})
              </Text>
            ))}
          </>
        )}

        {clocks.length > 0 && (
          <>
            <Text style={st.h2}>8. Deadlines</Text>
            {clocks.map(c => (
              <KV key={c.key} k={formatDate(c.due)} v={`${c.label}. ${c.basis}`} />
            ))}
          </>
        )}

        <Text style={st.h2}>9. What happened next</Text>
        <Text style={st.small}>The decision, then every later record about it, in the order sealed. Each is its own record; the decision is never edited.</Text>
        {story.map(e => (
          <KV key={e.seq} k={`#${e.seq} ${formatDateTime(e.at)}`} v={`${e.who}: ${e.text} Hash ${e.rowHash}`} />
        ))}
        <Text style={st.banner}>
          Status when this PDF was produced ({formatDateTime(now)}): {statusLine(chain, r, now)} Worked out from the records above; not part of any sealed
          record.
        </Text>

        <Text style={st.h2}>10. Method and seal</Text>
        <Text>
          Journeys: {journeys.label}. {journeys.disclaimer} {journeys.assumptions}.
        </Text>
        <Text>
          Subsidy: {subsidy.label}. {subsidy.detail}
        </Text>
        <Text>Record hash: {r.rowHash}</Text>
        <Text>Previous record: {r.prevHash}</Text>

        <View style={st.footer} fixed>
          <Text>
            Record #{r.seq} · {r.rowHash.slice(0, 16)}… · policy v{rs.version} {rs.hash?.slice(0, 12)}…
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

/** `now` is when the PDF is produced: it only labels the status line, never a sealed fact. */
export async function renderAuditPdf(r: DecisionRecord, chain: ChainRecord[], now: string): Promise<Blob> {
  return pdf(<AuditDoc r={r} chain={chain} now={now} />).toBlob()
}
