import { SCENARIOS } from '../data/households'
import { staffById } from '../data/staff'
import { addDays, addHours, ukDate, ukTimeToIso } from '../engine/dates'
import type { DecisionInput } from '../engine/decision'
import type { TransitionInput } from '../engine/placement'
import type { Household, IsoDateTime } from '../engine/types'
import { estimateProvider } from '../travel/estimate'
import { assertCan } from '../engine/permissions'
import { cmdCompleteTask, cmdDecide, cmdDecideApproval, cmdPlaceOutOfHours, cmdSearch, cmdTransition, type CommandCtx } from './commands'
import { seed, type AppData } from './data'

// SYNTHETIC demo history, so a five-minute demo can show an occupied property
// being ruled out, an approval waiting for a manager, a family in B&B part-way
// through the six-week ladder, and overdue and escalated tasks, without first
// clicking through ten screens.
//
// Every record here is sealed by the same commands an officer uses, at
// backdated times, with the actor of the synthetic staff member who would have
// done it. The commands check permissions and every rule as usual, and each
// record carries the note "Seeded demo history". Nothing is hand-written JSON.

const history = (at: IsoDateTime, userId: string): CommandCtx => ({ user: staffById(userId)!, now: at, today: ukDate(at), seeded: true })

function scenario(id: string, today: string, over: Partial<Household> = {}): Household {
  return { ...SCENARIOS.find(s => s.id === id)!.household(today), ...over }
}

const review = (at: IsoDateTime) => ({ resultsOpenedAt: at, propertiesOpened: [], comparisonOpened: false })

export async function seedDemo(now: IsoDateTime): Promise<AppData> {
  const today = ukDate(now)
  const day = (offset: number, time: string) => ukTimeToIso(addDays(today, offset), time)
  let d = await seed(now, today, day(-60, '09:00'))

  const step = async (at: IsoDateTime, userId: string, seq: number, input: TransitionInput) => {
    d = (await cmdTransition(d, history(at, userId), seq, input)).data
  }
  const complete = async (at: IsoDateTime, userId: string, taskId: string, evidence: string, reference: string) => {
    d = (await cmdCompleteTask(d, history(at, userId), taskId, { evidence, reference })).data
  }

  // 1. A pregnant woman placed in B&B at midnight, 31 days ago. Out of hours,
  //    approval to follow; approved the next morning. Day 31 of 42 today.
  const bnbDay = addDays(today, -31)
  const night = (time: string) => ukTimeToIso(bnbDay, time)
  {
    const ctx = history(night('23:40'), 'u-ooh-1')
    const s = await cmdSearch(d, ctx, scenario('outofhours', bnbDay, { caseRef: 'HN-26-0412' }), { id: 'S-DEMO-BNB', travel: estimateProvider })
    d = s.data
    const input: DecisionInput = {
      outcome: 'accepted',
      chosenPropertyId: s.result.recommendedId,
      reasonText: 'Nothing self-contained was free tonight; Atlas Lodge has a room with a private bathroom.',
      startDate: bnbDay,
      confirmedFullListReviewed: true,
      emergency: {
        reasonCode: 'out_of_hours',
        reasonText: 'Excluded by family at 23:00, 30 weeks pregnant, nowhere safe to stay tonight.',
      },
      moveOnPlan: { targetDate: addDays(bnbDay, 28), route: 'self_contained_ta', ownerUserId: 'u-ta-2' },
    }
    const dec = await cmdDecide(d, history(night('23:50'), 'u-ooh-1'), s.result.id, input, review(night('23:41')))
    d = dec.data
    const seq = dec.record.seq
    d = (
      await cmdPlaceOutOfHours(d, history(night('23:52'), 'u-ooh-1'), seq, {
        reason: 'Pregnant and alone at midnight; the duty manager did not answer two calls.',
      })
    ).data
    await step(night('23:55'), 'u-ooh-1', seq, { action: 'confirm_provider', contactName: 'Night desk, Atlas Lodge', providerReference: 'AT-26-3312' })
    await step(night('23:56'), 'u-ooh-1', seq, { action: 'offer', method: 'in_person' })
    await step(night('23:57'), 'u-ooh-1', seq, { action: 'accept' })
    await step(night('23:58'), 'u-ooh-1', seq, { action: 'check_in', checkedInOn: bnbDay })
    d = (
      await cmdDecideApproval(d, history(ukTimeToIso(addDays(bnbDay, 1), '09:40'), 'u-mgr-1'), seq, {
        outcome: 'approved',
        reason: 'Agreed: nothing self-contained was free that night. Move-on plan in place with Priya.',
      })
    ).data
    await complete(
      ukTimeToIso(addDays(bnbDay, 7), '11:00'),
      'u-ta-2',
      `bnb-review:${seq}:1`,
      'Asked three leasing landlords for a one-bed; none free yet. Plan unchanged.',
      'CASE-NOTE-0412-01',
    )
    await complete(
      ukTimeToIso(addDays(bnbDay, 14), '15:20'),
      'u-ta-2',
      `bnb-review:${seq}:2`,
      'One-bed at Thornbury House offered by the leasing scheme; viewing booked.',
      'EMAIL-PSL-7781',
    )
    await complete(
      ukTimeToIso(addDays(bnbDay, 22), '10:05'),
      'u-ta-2',
      `bnb-review:${seq}:3`,
      'Viewing done; landlord needs a gas certificate before the tenancy can start.',
      'CALL-2211',
    )
  }

  // 2. A family moved in 20 days ago at Ilford Gardens 9: the property is
  //    occupied, so today's searches rule it out with its dates.
  {
    const start = addDays(today, -20)
    const at = (time: string) => ukTimeToIso(start, time)
    const s = await cmdSearch(d, history(at('10:00'), 'u-ta-1'), scenario('brief', start, { caseRef: 'HN-26-0350', notes: 'Synthetic demo household.' }), {
      id: 'S-DEMO-ILFORD',
      travel: estimateProvider,
    })
    d = s.data
    const dec = await cmdDecide(
      d,
      history(at('10:20'), 'u-ta-1'),
      s.result.id,
      {
        outcome: 'accepted',
        chosenPropertyId: s.result.recommendedId,
        reasonText: '',
        startDate: start,
        confirmedFullListReviewed: true,
        consent: { status: 'given', givenBy: 'Adult 1', method: 'in_person' },
      },
      review(at('10:05')),
    )
    d = dec.data
    const seq = dec.record.seq
    await step(at('10:40'), 'u-ta-1', seq, { action: 'confirm_provider', contactName: 'Jas Kaur, Northside Lettings', providerReference: 'NL-26-0950' })
    await step(at('11:00'), 'u-ta-1', seq, { action: 'offer', method: 'phone' })
    await step(at('11:05'), 'u-ta-1', seq, { action: 'accept', note: 'Mother pleased it is one bus to the schools.' })
    await step(at('16:00'), 'u-ta-1', seq, { action: 'check_in', checkedInOn: start })
    await complete(
      ukTimeToIso(addDays(start, 2), '14:30'),
      'u-ta-1',
      `s208:${seq}`,
      'Section 208 notice emailed to Redbridge housing needs.',
      'EMAIL-S208-0350',
    )
  }

  // 3. An officer chose another option an hour ago: waiting for a manager.
  {
    const at = addHours(now, -1)
    const ctx = history(at, 'u-ta-2')
    const s = await cmdSearch(d, ctx, scenario('dialysis', ukDate(at), { caseRef: 'HN-26-0471' }), { id: 'S-DEMO-OVERRIDE', travel: estimateProvider })
    d = s.data
    const second = s.result.candidates.filter(c => c.eligible && c.propertyId !== s.result.recommendedId).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0]
    d = (
      await cmdDecide(
        d,
        history(addHours(at, 0.1), 'u-ta-2'),
        s.result.id,
        {
          outcome: 'override',
          chosenPropertyId: second.propertyId,
          overrideReason: 'household_preference',
          reasonText: 'He asked to stay near his sister, who drives him to dialysis on Saturdays.',
          startDate: s.result.household.needFrom,
          confirmedFullListReviewed: true,
        },
        review(addHours(at, 0.05)),
      )
    ).data
  }
  return d
}

/** Demo only (administrator): replace everything in this browser with fresh demo data and history. */
export async function cmdReset(ctx: CommandCtx): Promise<AppData> {
  assertCan(ctx.user, 'reset_demo')
  return seedDemo(ctx.now)
}
