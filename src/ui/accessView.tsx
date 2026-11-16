import { ACCESS_QUESTIONS, effectiveAccessNeeds, needSentence, subjectLabel } from '../engine/access'
import { formatDateTime } from '../engine/dates'
import type { Household } from '../engine/types'

/** The access answers as recorded, per person, for the results screen and the audit pack. */
export function AccessAnswers({ household: h }: { household: Household }) {
  const assessments = h.accessAssessments ?? []
  const legacy = h.accessNeeds ?? []
  if (assessments.length === 0 && legacy.length === 0) return <p className="text-sm text-muted">No access needs recorded.</p>
  return (
    <div className="grid gap-2">
      {assessments.length > 0 && (
        <div className="scroll-x">
          <table className="table min-w-[560px] text-sm">
            <thead>
              <tr>
                <th>Question</th>
                {assessments.map(a => (
                  <th key={a.subject}>{subjectLabel(h, a.subject)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACCESS_QUESTIONS.map(q => (
                <tr key={q.key}>
                  <td>{q.question}</td>
                  {assessments.map(a => {
                    const v = a.answers[q.key]
                    return (
                      <td key={a.subject} className={v === 'yes' ? 'font-semibold' : 'text-muted'}>
                        {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not answered'}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <td className="text-muted">Answered by</td>
                {assessments.map(a => (
                  <td key={a.subject} className="text-xs text-muted">
                    {a.answeredBy ? `${a.answeredBy.name}${a.answeredAt ? `, ${formatDateTime(a.answeredAt)}` : ''}` : 'Not recorded'}
                    {a.note && <div>Note: {a.note}</div>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {legacy.length > 0 && <p className="text-sm">Recorded for the whole household under the earlier version: {legacy.join(', ').replaceAll('_', ' ')}.</p>}
      <p className="text-sm">Checks applied: {effectiveAccessNeeds(h).map(needSentence).join('; ') || 'none (every access answer was no)'}.</p>
    </div>
  )
}
