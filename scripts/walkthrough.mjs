// Clicks through every flow and saves screenshots to screenshots/.
// Usage: node scripts/walkthrough.mjs [url]   (default: dist-demo/index.html)
// Needs both builds: `npm run build:demo` (the single-file demo, most flows)
// and `npm run build` (the hosted build, served here on a local port, for
// journey times through the site's functions and real file downloads).
// The postcode service and the site's travel functions are answered by
// Playwright routes, so those flows run the same every time, failures included.
// Prints a JSON summary: the widest horizontal overflow seen at phone width,
// console errors, and the checks below. Exits non-zero if a check fails.
import { createRequire } from 'node:module'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { extname, join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const url = process.argv[2] ?? pathToFileURL(resolve('dist-demo/index.html')).href
const out = p => resolve('screenshots', p)
const errors = []
const simulatedFailures = []
const checks = {}
const expect = (name, ok) => {
  checks[name] = !!ok
}
const browser = await chromium.launch()

// The hosted build, served from dist/ with the app's own fallback to index.html.
const DIST = resolve('dist')
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing: run `npm run build` first.')
  process.exit(1)
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.startsWith('/api/')) {
    res.writeHead(404)
    return res.end('Not routed by the walkthrough')
  }
  let file = join(DIST, path)
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const hosted = `http://127.0.0.1:${server.address().port}/`

// Stand-ins for the outside services. TravelTime is never called: these answer the site's own function URLs.
const km = (a, b) => {
  const r = d => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
const travelStatus = configured => route => json(route, 200, { configured, provider: 'traveltime', region: configured ? 'lhr1' : null })
const travelMeasured = route => {
  const b = route.request().postDataJSON()
  const cells = b.destinations.map(d => b.origins.map(o => ({ minutes: Math.min(240, Math.round(9 + km(o, d) * 3.4)), km: Math.round(km(o, d) * 12.5) / 10 })))
  return json(route, 200, { ok: true, source: 'traveltime', partial: false, cells })
}
const travelBadKey = route => json(route, 502, { ok: false, code: 'bad_key', message: 'TravelTime did not accept the key' })
const postcodes = {
  'E15 1AA': { status: 200, body: { status: 200, result: { postcode: 'E15 1AA', latitude: 51.5418, longitude: 0.0015, admin_district: 'Newham' } } },
  'E7 9ZZ': { status: 404, body: { status: 404, error: 'Postcode not found' } },
}
const postcodeRoute = route => {
  const pc = decodeURIComponent(route.request().url().split('/postcodes/')[1] ?? '')
  if (pc === 'E1 1AB') return route.abort('failed')
  const a = postcodes[pc] ?? { status: 404, body: { status: 404, error: 'Invalid postcode' } }
  return json(route, a.status, a.body)
}
const lhaCsv = [
  'brma,1_bed,2_bed,3_bed,4_bed',
  'Inner East London,262.50,312.00,365.00,430.00',
  'Outer North East London,185.00,226.00,272.00,338.00',
  'Outer East London,172.00,213.00,255.00,316.00',
  'Outer South London,178.00,219.00,264.00,331.00',
  '"Harlow & Stortford",142.00,173.00,214.00,276.00',
  'Basildon,137.00,168.00,204.00,259.00',
  'Luton,117.00,142.00,168.00,219.00',
  'Milton Keynes,127.00,153.00,183.00,239.00',
  'Chelmsford,142.00,178.00,219.00,280.00',
].join('\n')

async function open(options, name) {
  const ctx = await browser.newContext(options)
  const page = await ctx.newPage()
  page.on('console', m => {
    if (m.type() !== 'error') return
    // A failed request to a stand-in service is the failure being tested (an unknown postcode, a refused
    // key, a blocked lookup); the browser logs it. Counted apart, never mixed with the app's own errors.
    if (m.text().startsWith('Failed to load resource') && /api\.postcodes\.io|\/api\/travel-/.test(m.location()?.url ?? ''))
      return simulatedFailures.push(`[${name}] ${m.location().url}`)
    errors.push(`[${name}] ${m.text()}`)
  })
  page.on('pageerror', e => errors.push(`[${name}] ${String(e)}`))
  return { ctx, page }
}
const signIn = async (page, userId) => {
  await page.waitForSelector('text=Demo sign-in, not security')
  await page.click(`#signin-${userId}`)
  await page.waitForSelector('nav[aria-label="Main"]')
}
const switchUser = async (page, userId) => {
  await page.click('#switch-user:visible, #switch-user-phone:visible')
  await signIn(page, userId)
}
// Full-page shots from the top, so the sticky rail sits where an officer sees it.
const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: out(name), fullPage: true })
}
const focusedId = page => page.evaluate(() => document.activeElement?.id ?? '')
// UK calendar date, as the app works it out (the engine uses Europe/London).
const ukToday = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const submitIn = async (page, formId) => page.click(`#${formId} button[type="submit"]`)
const sealed = async page => page.waitForSelector('text=/Saved as record #\\d+/')
const answerAll = async (page, subject, answer = 'yes', except = {}) => {
  for (const q of ['wheelchair_accessible', 'step_free', 'ground_floor_or_lift', 'adapted_bathroom', 'assistance_dog', 'equipment_or_carer']) {
    const a = except[q] ?? answer
    await page.check(a === 'yes' ? `#access-${subject}-${q}` : `#access-${subject}-${q}-no`)
  }
}

// ---------- Desktop, light ----------
const { page } = await open({ viewport: { width: 1360, height: 900 } }, 'desktop')
await page.goto(url)
await page.waitForSelector('text=Demo sign-in, not security')
expect('appUnusableUntilSignedIn', (await page.locator('nav[aria-label="Main"]').count()) === 0)
await shot(page, '00-sign-in.png')
await signIn(page, 'u-ta-1')
await page.waitForSelector('text=Start from an example household')
expect('seededHistoryShowsMyTasks', await page.locator('section:has-text("My tasks") [data-task]').first().isVisible())
expect('approvalsHiddenFromOfficer', (await page.locator('#nav-approvals').count()) === 0)
expect('tasksCountInRail', /Tasks, \d+ open/.test((await page.getAttribute('#nav-tasks', 'aria-label')) ?? ''))
await shot(page, '01-home.png')

// A failed submit: blank form, error summary takes focus, no search runs
await page.click('nav >> text=New placement')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('#error-summary')
expect('errorSummaryFocused', (await focusedId(page)) === 'error-summary')
expect('failedSubmitStaysOnForm', (await page.locator('text=Placement options').count()) === 0)
expect('ageFieldMarkedInvalid', (await page.getAttribute('#age-a1', 'aria-invalid')) === 'true')
await shot(page, '02-form-errors.png')
// Errors update live as fields are corrected; the summary link moves focus to the field
await page.click('#error-summary a:has-text("case reference")')
expect('summaryLinkFocusesField', (await focusedId(page)) === 'caseRef')
await page.fill('#caseRef', 'HN-26-0901')
await page.fill('#age-a1', '38')
expect('errorsClearLive', (await page.locator('#error-summary').count()) === 0)

// Access needs follow the person: ticking wheelchair user opens the panel, unanswered blocks the search
await page.check('#wheelchairUser-a1')
await page.waitForSelector('#access-panel-a1')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('#error-summary')
expect('unansweredAccessBlocksSearch', (await page.locator('#error-summary li').count()) === 6)
await shot(page, '03-access-panel-unanswered.png')
await answerAll(page, 'a1', 'yes', { assistance_dog: 'no', equipment_or_carer: 'no' })
await page.locator('#access-panel-a1').screenshot({ path: out('03b-access-panel-answered.png') })
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
expect('accessNeedNamedInResults', await page.locator('text=Adult 1 needs a wheelchair-accessible home').first().isVisible())
await shot(page, '04-results-access.png')

// The brief example: results, detail, compare, decide with consent
await page.click('nav >> text=Overview')
await page.click('text=Parent and three children, needed tonight')
await page.waitForSelector('text=Find placements')
await shot(page, '05-form-example.png')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await shot(page, '06-results.png')
await page.click('text=Why this property')
await page.waitForSelector('text=Every check run')
await shot(page, '07-property.png')
await page.click('text=Back to options')
await page.click('button:has-text("Compare top options")')
await page.waitForSelector('text=Side by side')
await page.click('button.chip:has-text("Becontree Heath 22")')
await shot(page, '08-compare.png')
await page.click('text=Back to options')
await page.click('text=Review and record decision')
await page.waitForSelector('text=Record the placement decision')
expect('noFreeTextOfficerName', (await page.locator('#officer, #role').count()) === 0)
expect('consentHasNoDefault', (await page.locator('input[name="consent-status"]:checked').count()) === 0)
await page.check('#confirm')
await page.click('button:has-text("Record decision")')
await page.waitForSelector('#error-summary')
expect('decisionNeedsConsent', await page.locator('#error-summary >> text=Record whether a parent consents').isVisible())
await shot(page, '09-decide-consent-missing.png')
await page.check('#consent-status')
await page.selectOption('#consent-givenBy', 'Adult 1')
await page.check('#consent-method')
await shot(page, '10-decide.png')
await page.click('button:has-text("Record decision")')
await page.waitForSelector('#placement')
expect('decisionShowsSignedInOfficer', await page.locator('dd:has-text("Sam Okafor, Temporary accommodation officer")').isVisible())
expect('newPlacementIsHeld', await page.locator('#placement li[aria-current="step"]:has-text("Held")').isVisible())
await shot(page, '11-decision.png')
await page.click('text=Open the audit pack')
await page.waitForSelector('text=Seal intact')
await shot(page, '12-audit-pack.png')

// A second search for another case: the held property is ruled out, with its message and nothing about the other household
await page.click('nav >> text=Overview')
await page.click('text=Parent and three children, needed tonight')
await page.fill('#caseRef', 'HN-26-0999')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await page.click('text=Show every ruled-out property and why')
const heldMsg = page.locator('text=/Held for another case until \\d\\d:\\d\\d on/').first()
expect('heldPropertyRuledOut', await heldMsg.isVisible())
expect('occupiedPropertyRuledOut', await page.locator('text=/Occupied \\d+ \\w+ to \\d+ \\w+/').first().isVisible())
expect('ruledOutSaysNothingAboutOtherCase', (await page.locator('text=HN-26-0317').count()) === 0)
await heldMsg.scrollIntoViewIfNeeded()
await shot(page, '12b-results-held-ruled-out.png')
await page.locator('section.panel:has(h2:has-text("Ruled out by the checks"))').screenshot({ path: out('12b-ruled-out-section.png') })

// The full placement, from hold to move-out, each step sealed with who and when
await page.click('nav >> text=Overview')
await page.click('tbody tr:has-text("HN-26-0317")')
await page.waitForSelector('#placement')
await page.click('#act-confirm_provider')
await submitIn(page, 'placement-step')
expect('providerConfirmationNeedsContact', await page.locator('#placement-step-errors >> text=Enter the name of the person at the provider').isVisible())
await page.fill('#pl-contactName', 'Mo Patel, Northside Lettings')
await page.fill('#pl-providerReference', 'NL-2611-04')
await submitIn(page, 'placement-step')
await sealed(page)
await page.click('#act-offer')
await page.check('#pl-method-phone')
await submitIn(page, 'placement-step')
await sealed(page)
await page.click('#act-accept')
await submitIn(page, 'placement-step')
await sealed(page)
await page.click('#act-check_in')
await submitIn(page, 'placement-step')
await sealed(page)
await shot(page, '12c-placement-moved-in.png')
await page.click('#act-move_out')
await page.fill('#pl-moveReason', 'Offered a council tenancy')
await page.selectOption('#pl-destination', 'settled_home')
await submitIn(page, 'placement-step')
await sealed(page)
expect('fullLifecycleToMoveOut', await page.locator('#placement li[aria-current="step"]:has-text("Moved out")').isVisible())
expect('historyListsEachStep', (await page.locator('#history li').count()) >= 6)
await shot(page, '12d-placement-moved-out.png')
await page.click('text=Open the audit pack')
await page.waitForSelector('text=Seal intact')
expect(
  'auditPackTellsTheStory',
  (await page.locator('#story li').count()) >= 6 && (await page.locator('#story >> text=The household moved out on').isVisible()),
)
await page.locator('#story').scrollIntoViewIfNeeded()
await shot(page, '12e-audit-pack-story.png')

// Second decision: an override with consent not asked yet, then consent recorded later as a new record
await page.click('nav >> text=Overview')
await page.click('text=Two adults and five children, exam year')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await shot(page, '13-results-large.png')
await page.click('text=Review and record decision')
await page.click('label:has-text("Seven Kings 8")')
await page.selectOption('#reason', 'household_preference')
await page.fill('#reasonText', 'Household asked for Seven Kings: the father works nights nearby and the eldest is settled at a youth club there.')
await page.check('#consent-status-not_asked')
await page.fill('#consent-reason', 'Both parents at the hospital with the youngest; will ask at the evening visit.')
await page.check('#confirm')
expect('overrideShowsApprovalNeeded', await page.locator('#exceptions >> text=Not the recommended option').isVisible())
await page.click('button:has-text("Record decision")')
await page.waitForSelector('#placement')
expect('notAskedCreatesFollowUp', await page.locator('#tasks >> text=Ask a parent for consent').first().isVisible())
expect('overrideAwaitsApproval', await page.locator('header >> text=Awaiting approval').isVisible())
expect('confirmBlockedUntilApproval', await page.isDisabled('#act-confirm_provider'))
expect('officerCannotApprove', await page.locator('#approval >> text=cannot approve an exception').isVisible())
await shot(page, '13b-override-awaiting-approval.png')
await page.click('#update-consent')
await page.check('#consent-status')
await page.selectOption('#consent-givenBy', 'Adult 2')
await page.check('#consent-method-phone')
await page.click('button:has-text("Save consent")')
await page.waitForSelector('text=The decision record is unchanged')
expect('consentUpdateIsNewRecord', await page.locator('text=/Record #\\d+: changed by Sam Okafor/').isVisible())
await shot(page, '14-decision-consent-updated.png')

// Out-of-hours example: last resort and the six-week clock
await page.click('nav >> text=Overview')
await page.click('text=Pregnant, alone, out of hours')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await shot(page, '15-results-outofhours.png')

// Emergency B&B for a pregnant woman: a reason, a move-on plan with a named owner, then "placed out of hours, approval to follow"
await page.click('text=Review and record decision')
await page.waitForSelector('#six-week')
await page.check('#confirm')
await page.click('button:has-text("Record decision")')
await page.waitForSelector('#error-summary')
expect(
  'sixWeekNeedsPlan',
  (await page.locator('#error-summary >> text=named person who owns the move-on plan').isVisible()) && (await page.locator('#error-summary li').count()) >= 4,
)
await page.selectOption('#emergency-reasonCode', 'out_of_hours')
await page.fill('#emergency-reasonText', 'Excluded by family at 23:40, pregnant, nowhere safe tonight; no self-contained unit free.')
await page.selectOption('#moveon-owner', 'u-ta-2')
await page.fill('#moveon-targetDate', ukToday(28))
await page.selectOption('#moveon-route', 'self_contained_ta')
expect('sharedFamilyNeedsApproval', await page.locator('#exceptions >> text=A family in B&B or shared accommodation').isVisible())
await shot(page, '15b-decide-bnb-plan.png')
await page.click('button:has-text("Record decision")')
await page.waitForSelector('#placement')
await page.click('#out-of-hours')
await page.fill('#ooh-reason', 'Pregnant and alone at 23:40; the duty manager did not answer two calls.')
await submitIn(page, 'ooh-form')
await page.waitForSelector('#ooh-banner')
expect('outOfHoursBannerShown', await page.locator('#ooh-banner >> text=A manager must approve or reject by').isVisible())
expect('oohUnblocksConfirmation', !(await page.isDisabled('#act-confirm_provider')))
expect('dayCounterShown', await page.locator('#shared-stay-counter >> text=/\\d+ of 42 days used/').isVisible())
await page.click('#act-confirm_provider')
await page.fill('#pl-contactName', 'Night desk, Oakfield Annex')
await page.fill('#pl-providerReference', 'OA-26-118')
await submitIn(page, 'placement-step')
await sealed(page)
await shot(page, '15c-placement-out-of-hours.png')

// Completing a task needs evidence
await page.click('#nav-tasks')
await page.waitForSelector('text=Reminders are in this app only')
expect('inAppOnlyNoticeShown', true)
const s213 = page.locator('li[data-task^="s213aa:"]:has-text("HN-26-0350")')
await s213.locator('button[data-action="complete"]').click()
await submitIn(page, 'task-form')
expect('taskNeedsEvidence', await page.locator('#task-form-errors >> text=Say what was done').isVisible())
await page.fill('#task-evidence', 'Emailed the school and the GP practice with the new address; health visitor told by phone.')
await page.fill('#task-reference', 'EMAIL-S213-0350')
await submitIn(page, 'task-form')
await page.waitForSelector('text=/Task done\\. Sealed as record #\\d+/')
await page.click('#tasks-filter-done')
expect('taskCompletedWithEvidence', await page.locator('li[data-task^="s213aa:"]:has-text("EMAIL-S213-0350")').isVisible())
await page.click('#tasks-filter-open')
await shot(page, '15d-tasks-officer.png')

// Switch to a manager: the audit log, tamper demo, and a policy screen they cannot publish from
await switchUser(page, 'u-mgr-1')
expect('railShowsManager', (await page.locator('aside :text("Hannah Clarke"):visible').count()) > 0)
expect('approvalsCountShown', /Approvals, \d+ waiting/.test((await page.getAttribute('#nav-approvals', 'aria-label')) ?? ''))
await page.click('#nav-approvals')
await page.waitForSelector('text=Waiting (')
expect('oohWaitsForManager', await page.locator('li[data-approval]:has-text("Placed out of hours: approval to follow")').first().isVisible())
await shot(page, '16a-approvals.png')
const large = page.locator('li[data-approval]:has-text("Seven Kings 8")')
await large.locator('button:has-text("Approve or reject")').click()
await page.check('#ap-outcome')
await page.fill('#ap-reason', 'The work and youth club reasons outweigh the score gap; agreed.')
await submitIn(page, 'approval-form')
await large.waitFor({ state: 'detached' })
expect('managerApproves', await page.locator('section:has-text("Recently decided") li:has-text("HN-26-0291"):has-text("Exception approved")').isVisible())
await page.click('#nav-tasks')
expect('oohApprovalTaskUrgent', await page.locator('li[data-task^="approval:"]:has-text("Placed out of hours")').first().isVisible())
await shot(page, '16b-tasks-manager.png')
await page.click('nav >> text=Audit log')
await page.click('text=Edit record #1 behind the system’s back')
await page.click('section >> button:has-text("Check every seal")')
await page.waitForSelector('text=cannot be relied on')
await shot(page, '16-audit-log-tampered.png')
await page.click('text=Put record #1 back')
await page.click('nav >> text=Placement policy')
await page.waitForSelector('text=Version history')
expect('managerCannotPublish', await page.isDisabled('#publish'))
await shot(page, '17-rules-manager.png')

// Switch to the auditor: reads everything, is refused every write
await switchUser(page, 'u-aud-1')
await page.click('nav >> text=New placement')
expect('auditorCannotSearch', await page.isDisabled('button:has-text("Find placements")'))
expect('auditorToldWhy', await page.locator('text=Your role (Auditor (read only)) cannot run a placement search.').first().isVisible())
await shot(page, '18-auditor-refused.png')
await page.click('nav >> text=Audit log')
expect('auditorCannotTamper', await page.isDisabled('#tamper'))
expect('auditorCannotReset', await page.isDisabled('#reset'))
await page.click('nav >> text=Overview')
await page.click('tbody tr:has-text("HN-26-0350")')
await page.waitForSelector('#placement')
expect('auditorCannotChangeConsent', (await page.locator('#update-consent').count()) === 0)
expect('auditorCannotActOnPlacement', (await page.locator('#act-move_out').count()) === 0)
await page.click('nav >> text=Properties')
await page.waitForSelector('text=Import from a spreadsheet')
await shot(page, '19-properties-auditor.png')
await page.click('nav >> text=Overview')
await shot(page, '20-home-after.png')

// ---------- Schema-1 data from the live demo: migrated, verified, rendered ----------
const fixture = readFileSync(resolve('tests/fixtures/schema1-localstorage.json'), 'utf8')
const { page: old } = await open({ viewport: { width: 1360, height: 900 } }, 'schema1')
await old.addInitScript(raw => {
  if (!localStorage.getItem('placement-engine/v2')) localStorage.setItem('placement-engine/v1', raw)
}, fixture)
await old.goto(url)
await signIn(old, 'u-ta-2')
await old.click('nav >> text=Audit log')
await old.click('section >> button:has-text("Check every seal")')
expect('schema1ChainVerifies', await old.locator('text=All 2 records intact.').isVisible())
await old.click('td >> button.link:has-text("2")')
await old.waitForSelector('text=Seal intact')
expect('schema1ConsentReadsHonestly', await old.locator('text=under the earlier version').first().isVisible())
await shot(old, '21-schema1-audit-pack.png')
await old.click('text=Back to the decision')
await old.waitForSelector('#placement')
expect('schema1ReadsAsExpiredHold', await old.locator('#placement >> text=Recorded before placements were tracked').isVisible())
await shot(old, '22-schema1-decision.png')

// ---------- Phase 3 in the shared demo file: places by postcode, a household import, the subsidy table, exports ----------
const { ctx: p3ctx, page: p3 } = await open({ viewport: { width: 1360, height: 900 } }, 'phase3')
await p3ctx.route('https://api.postcodes.io/**', postcodeRoute)
let travelCalls = 0
await p3ctx.route('**/api/**', route => {
  travelCalls++
  return route.abort()
})
await p3.goto(url)
await signIn(p3, 'u-ta-1')

// A place by postcode: found, unknown, the lookup failing; the form stays usable throughout
await p3.click('text=Parent and three children, needed tonight')
await p3.waitForSelector('text=Find placements')
expect('examplePlacesLabelledSynthetic', await p3.locator('text=Synthetic example place').first().isVisible())
await p3.click('#pc-open')
await p3.fill('#pc-postcode', 'e7 9zz')
await p3.click('#pc-lookup')
await p3.waitForSelector('#pc-message')
expect('unknownPostcodeExplained', /No postcode E7 9ZZ was found/.test(await p3.textContent('#pc-message')))
await p3.fill('#pc-postcode', 'E1 1AB')
await p3.click('#pc-lookup')
await p3.waitForSelector('#pc-message:has-text("not available just now")')
expect('postcodeLookupFailureExplained', true)
await p3.locator('#postcode-panel').screenshot({ path: out('50-postcode-failed.png') })
await p3.fill('#pc-postcode', 'e15 1aa')
await p3.click('#pc-lookup')
await p3.waitForSelector('#pc-found')
await p3.fill('#pc-name', 'Stratford library homework club')
await p3.selectOption('#pc-kind', 'support')
await p3.selectOption('#pc-who', 'c1')
await p3.click('#pc-add')
expect('postcodePlaceAdded', await p3.locator('text=Located from postcode E15 1AA (postcodes.io)').isVisible())
await p3.locator('section:has(h2:has-text("Places that matter"))').screenshot({ path: out('51-postcode-place-added.png') })
await p3.click('button:has-text("Find placements")')
await p3.waitForSelector('text=Placement options')
expect('demoBuildUsesEstimate', (await p3.getAttribute('#journey-source', 'data-outcome')) === 'estimated' && travelCalls === 0)
expect('subsidyIllustrativeBeforeImport', (await p3.getAttribute('#subsidy-status', 'data-status')) === 'illustrative')
await shot(p3, '52-results-demo-estimate.png')
await p3.click('text=Why this property')
await p3.waitForSelector('text=Every check run')
expect('postcodePlaceJourneyShown', await p3.locator('td:has-text("Located from postcode E15 1AA")').first().isVisible())
await p3.click('text=Back to options')

// A household imported from the case system: reported, not searched, fixed on the form, then searched
await p3.click('nav >> text=New placement')
await p3.click('#import-open')
await p3.click('#import-example-wheelchair')
await p3.waitForSelector('#import-report')
expect('importNeverSearches', (await p3.locator('text=Placement options').count()) === 0)
expect('importReportsWhatWasNotUsed', await p3.locator('#import-report >> text=no coordinates (postcode E15 1XX)').isVisible())
expect('importedWheelchairUserBlocked', (await p3.locator('#error-summary li').count()) === 7)
await shot(p3, '53-import-report.png')
await p3.click('button:has-text("Find placements")')
expect('importedSearchRefusedUntilAnswered', (await p3.locator('text=Placement options').count()) === 0)
await answerAll(p3, 'a1', 'yes', { assistance_dog: 'no', equipment_or_carer: 'no' })
await p3.fill('#needFrom', ukToday(2))
expect('importErrorsClearWhenFixed', (await p3.locator('#error-summary').count()) === 0)
await p3.click('button:has-text("Find placements")')
await p3.waitForSelector('text=Placement options')
expect('importedHouseholdSearched', await p3.locator('text=Case HN-26-0561').first().isVisible())
await shot(p3, '54-results-imported.png')

// The head of service loads the official subsidy table: a bad file is refused, a good one checked, compared and published
await switchUser(p3, 'u-hos-1')
await p3.click('nav >> text=Placement policy')
await p3.click('#lha-open')
await p3.fill('#lha-file', lhaCsv + '\nluton,1,2,3,4')
await p3.click('#lha-check')
await p3.waitForSelector('#lha-errors')
expect('subsidyFileChecked', await p3.locator('#lha-errors >> text=luton appears twice').isVisible())
expect('subsidyNeedsCitationAndConfirmation', (await p3.locator('#lha-errors li').count()) >= 4)
await p3.locator('#lha-import').screenshot({ path: out('55-subsidy-import-errors.png') })
await p3.fill('#lha-file', lhaCsv)
await p3.fill('#lha-citation', 'DWP, Local Housing Allowance rates, January 2011 (walkthrough copy)')
await p3.fill('#lha-sourceDate', '2011-01-01')
await p3.check('#lha-confirm')
await p3.click('#lha-check')
await p3.waitForSelector('#lha-preview')
expect('subsidyDiffShown', /9 areas changed, 0 added, 0 removed/.test(await p3.textContent('#lha-diff')))
await p3.fill('#lha-equality', 'Official rates replace illustrative ones; costs only break near-ties, so no group is newly disadvantaged.')
await p3.locator('#lha-import').screenshot({ path: out('56-subsidy-import-preview.png') })
await p3.click('#lha-publish')
await p3.waitForSelector('text=with the official table')
expect('subsidyPublishedAsOfficial', (await p3.getAttribute('#subsidy-status-policy', 'data-status')) === 'official')
await p3.locator('#subsidy-table').screenshot({ path: out('57-subsidy-official.png') })
await p3.click('nav >> text=Overview')
await p3.click('text=Parent and three children, needed tonight')
await p3.fill('#caseRef', 'HN-26-0777')
await p3.click('button:has-text("Find placements")')
await p3.waitForSelector('text=Placement options')
expect('newSearchSaysOfficial', (await p3.getAttribute('#subsidy-status', 'data-status')) === 'official')
expect('costExplanationSaysOfficial', await p3.locator('text=/After housing benefit subsidy \\(official table\\)/').first().isVisible())

// Exports in the demo file: copy only, and each one recorded
await p3.click('nav >> text=Overview')
await p3.click('tbody tr:has-text("HN-26-0412")')
await p3.waitForSelector('#placement')
await p3.click('text=Open the audit pack')
await p3.waitForSelector('text=Seal intact')
expect('demoBuildHasNoDownloads', (await p3.locator('#export-pdf, #export-note-download').count()) === 0)
await p3.click('#export-note-copy')
await p3.waitForSelector('#export-status')
expect('caseNoteExportRecorded', /recorded as #\d+/.test(await p3.textContent('#export-status')))
expect('exportJoinsTheStory', await p3.locator('#story >> text=Exported a case note').isVisible())
await p3.click('nav >> text=Audit log')
await p3.click('#export-csv-copy')
await p3.waitForSelector('#export-csv-status')
expect('csvExportRecorded', /recorded as #\d+/.test(await p3.textContent('#export-csv-status')))
expect('exportsListedInAuditLog', await p3.locator('td >> text=All placements').first().isVisible())
await p3.click('section >> button:has-text("Check every seal")')
expect('chainVerifiesAfterExports', await p3.locator('text=/All \\d+ records intact/').isVisible())
await shot(p3, '58-audit-log-exports.png')

// ---------- The hosted build: journey times through the site's functions, and real downloads ----------
const { ctx: hctx, page: hp } = await open({ viewport: { width: 1360, height: 900 }, acceptDownloads: true }, 'hosted')
await hctx.route('**/api/travel-status', travelStatus(true))
await hctx.route('**/api/travel-matrix', travelMeasured)
await hp.goto(hosted)
await signIn(hp, 'u-ta-1')
await hp.click('text=Parent and three children, needed tonight')
await hp.click('button:has-text("Find placements")')
await hp.waitForSelector('text=Placement options')
expect('travelTimeUsedWhenConfigured', (await hp.getAttribute('#journey-source', 'data-outcome')) === 'measured')
expect('travelTimeProvenanceShown', await hp.locator('#journey-source >> text=Public transport times from TravelTime').isVisible())
await shot(hp, '60-results-traveltime.png')
await hp.click('text=Why this property')
await hp.waitForSelector('text=Every check run')
expect('journeyTaggedTravelTime', await hp.locator('td .chip:has-text("TravelTime")').first().isVisible())
await shot(hp, '61-property-traveltime.png')
await hp.click('text=Back to options')
await hp.click('text=Review and record decision')
await hp.check('#confirm')
await hp.check('#consent-status')
await hp.selectOption('#consent-givenBy', 'Adult 1')
await hp.check('#consent-method')
await hp.click('button:has-text("Record decision")')
await hp.waitForSelector('#placement')
await hp.click('text=Open the audit pack')
await hp.waitForSelector('text=Seal intact')
expect('auditPackSaysTravelTime', await hp.locator('#method-journeys >> text=Public transport times from TravelTime').isVisible())
const download = async (sel, name) => {
  const [d] = await Promise.all([hp.waitForEvent('download'), hp.click(sel)])
  const path = out(`download-${name}`)
  await d.saveAs(path)
  return { name: d.suggestedFilename(), text: readFileSync(path, 'utf8') }
}
const note = await download('#export-note-download', 'case-note.txt')
expect(
  'caseNoteDownloaded',
  /case-note\.txt$/.test(note.name) && note.text.startsWith('PLACEMENT DECISION: CASE HN-26-0317') && note.text.includes('from TravelTime'),
)
const rec = await download('#export-json-download', 'record.json')
expect('recordJsonDownloaded', JSON.parse(rec.text).snapshot.schema === 'placement-decision/2')
const pdfDl = await download('#export-pdf', 'audit.pdf')
expect('pdfDownloaded', pdfDl.name.endsWith('.pdf') && pdfDl.text.startsWith('%PDF'))
await hp.waitForSelector('#story >> text=Exported the audit pack as a PDF')
expect('eachDownloadRecorded', (await hp.locator('#story li:has-text("Exported ")').count()) === 3)
await shot(hp, '62-audit-pack-exports.png')
await hp.click('nav >> text=Audit log')
const csv = await download('#export-csv-download', 'placements.csv')
expect(
  'placementsCsvDownloaded',
  csv.text.split('\n')[0].startsWith('decision_record,case_reference,outcome') && csv.text.includes(',measured,illustrative,yes'),
)

// TravelTime failing: the estimate is used, and the results say why
await hctx.unroute('**/api/travel-matrix')
await hctx.route('**/api/travel-matrix', travelBadKey)
await hp.click('nav >> text=Overview')
await hp.click('text=Single adult on dialysis, working')
await hp.click('button:has-text("Find placements")')
await hp.waitForSelector('text=Placement options')
expect('travelFallbackRecorded', (await hp.getAttribute('#journey-source', 'data-fallback')) === 'bad_key')
expect('travelFallbackShown', await hp.locator('#journey-source >> text=TravelTime did not accept this site’s key').isVisible())
await shot(hp, '63-results-traveltime-failed.png')

// Not switched on (no keys on the server): the estimate, said calmly
const { ctx: nctx, page: np } = await open({ viewport: { width: 1360, height: 900 } }, 'hosted-off')
await nctx.route('**/api/travel-status', travelStatus(false))
await nctx.route('**/api/travel-matrix', route => {
  travelCalls++
  return route.abort()
})
await np.goto(hosted)
await signIn(np, 'u-ta-2')
await np.click('text=Single adult on dialysis, working')
await np.click('button:has-text("Find placements")')
await np.waitForSelector('text=Placement options')
expect('notConfiguredSaysSo', (await np.getAttribute('#journey-source', 'data-fallback')) === 'not_configured' && travelCalls === 0)
await np.locator('#journey-source').screenshot({ path: out('64-journeys-not-switched-on.png') })

// ---------- Dark mode ----------
const { page: dp } = await open({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' }, 'dark')
await dp.goto(url)
await shot(dp, '30-sign-in-dark.png')
await signIn(dp, 'u-ta-2')
await dp.click('text=Wheelchair user and two children, fleeing abuse')
await dp.waitForSelector('#access-panel-a1')
await shot(dp, '31-form-access-dark.png')
await dp.click('button:has-text("Find placements")')
await dp.waitForSelector('text=Placement options')
await shot(dp, '32-results-dark.png')
await dp.click('text=Review and record decision')
await dp.check('#confirm')
await dp.click('button:has-text("Record decision")')
await dp.waitForSelector('#error-summary')
await shot(dp, '33-decide-errors-dark.png')
await dp.click('nav >> text=New placement')
await dp.click('button:has-text("Find placements")')
await dp.waitForSelector('#error-summary')
await shot(dp, '34-form-errors-dark.png')
await switchUser(dp, 'u-mgr-1')
await dp.click('#nav-approvals')
await dp.waitForSelector('text=Waiting (')
await dp.locator('li[data-approval] button:has-text("Approve or reject")').first().click()
await shot(dp, '35-approvals-dark.png')
await dp.click('#nav-tasks')
await shot(dp, '36-tasks-dark.png')
await dp.click('nav >> text=Overview')
await dp.click('tbody tr:has-text("HN-26-0412")')
await dp.waitForSelector('#shared-stay-counter')
await shot(dp, '37-placement-bnb-dark.png')
await dp.click('#nav-properties')
await shot(dp, '38-properties-dark.png')

// ---------- Phone ----------
const { page: pp } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }, 'phone')
let overflow = 0
const measureOn = async page => {
  overflow = Math.max(overflow, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
}
const measure = () => measureOn(pp)
await pp.goto(url)
await measure()
await shot(pp, '40-sign-in-phone.png')
await signIn(pp, 'u-ooh-1')
await measure()
await pp.click('nav >> text=New placement')
await pp.click('button:has-text("Find placements")')
await pp.waitForSelector('#error-summary')
await measure()
await shot(pp, '41-form-errors-phone.png')
await pp.click('nav >> text=Overview')
await pp.click('text=Wheelchair user and two children, fleeing abuse')
await pp.waitForSelector('#access-panel-a1')
await measure()
await pp.locator('#access-needs').screenshot({ path: out('42-access-panel-phone.png') })
await pp.click('nav >> text=Overview')
await pp.click('text=Parent and three children, needed tonight')
await pp.click('button:has-text("Find placements")')
await pp.waitForSelector('text=Placement options')
await measure()
await shot(pp, '43-results-phone.png')
await pp.click('text=Review and record decision')
await pp.check('#confirm')
await pp.check('#consent-status-refused')
await pp.click('button:has-text("Record decision")')
await pp.waitForSelector('#error-summary')
await measure()
await shot(pp, '44-decide-consent-phone.png')
await pp.selectOption('#consent-givenBy', 'Adult 1')
await pp.check('#consent-method')
await pp.click('button:has-text("Record decision")')
await pp.waitForSelector('#placement')
expect('refusedSuppressesNotice', await pp.locator('text=so no notice is drafted').isVisible())
await measure()
await shot(pp, '45-decision-phone.png')
await pp.click('#act-confirm_provider')
await measure()
await shot(pp, '45b-placement-step-phone.png')
await pp.click('text=Open the audit pack')
await pp.waitForSelector('text=Seal intact')
await measure()
await shot(pp, '46-audit-pack-phone.png')
await switchUser(pp, 'u-mgr-1')
await pp.click('#nav-tasks')
await pp.waitForSelector('text=Reminders are in this app only')
await measure()
await pp.locator('[data-task] button[data-action="complete"]').first().click()
await pp.waitForSelector('#task-form')
await measure()
await shot(pp, '47-tasks-phone.png')
await pp.click('#nav-home')
await pp.click('tbody tr:has-text("HN-26-0412")')
await pp.waitForSelector('#shared-stay-counter')
await measure()
await shot(pp, '48-placement-bnb-phone.png')
await pp.click('#nav-approvals')
await pp.waitForSelector('text=Waiting (')
await pp.locator('li[data-approval] button:has-text("Approve or reject")').first().click()
await measure()
await shot(pp, '49-approvals-phone.png')
await pp.click('#nav-properties')
await measure()

// Phase 3 on a phone, in the hosted build: journey source, a place by postcode, an import, the subsidy table, exports
const { ctx: phctx, page: ph } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true }, 'phone-hosted')
await phctx.route('**/api/travel-status', travelStatus(true))
await phctx.route('**/api/travel-matrix', travelMeasured)
await phctx.route('https://api.postcodes.io/**', postcodeRoute)
await ph.goto(hosted)
await signIn(ph, 'u-ooh-1')
await ph.click('text=Parent and three children, needed tonight')
await ph.click('#pc-open')
await ph.fill('#pc-postcode', 'E1 1AB')
await ph.click('#pc-lookup')
await ph.waitForSelector('#pc-message')
await ph.fill('#pc-postcode', 'E15 1AA')
await ph.click('#pc-lookup')
await ph.waitForSelector('#pc-found')
await measureOn(ph)
await ph.locator('#postcode-panel').screenshot({ path: out('70-postcode-phone.png') })
await ph.fill('#pc-name', 'Homework club')
await ph.selectOption('#pc-who', 'c1')
await ph.click('#pc-add')
await ph.click('button:has-text("Find placements")')
await ph.waitForSelector('text=Placement options')
await measureOn(ph)
await shot(ph, '71-results-traveltime-phone.png')
await ph.click('text=Review and record decision')
await ph.check('#confirm')
await ph.check('#consent-status')
await ph.selectOption('#consent-givenBy', 'Adult 1')
await ph.check('#consent-method')
await ph.click('button:has-text("Record decision")')
await ph.waitForSelector('#placement')
await ph.click('text=Open the audit pack')
await ph.waitForSelector('text=Seal intact')
await ph.click('#export-note-copy')
await ph.waitForSelector('#export-status')
await measureOn(ph)
await shot(ph, '72-audit-pack-exports-phone.png')
await ph.click('nav >> text=New placement')
await ph.click('#import-open')
await ph.click('#import-example-wheelchair')
await ph.waitForSelector('#import-report')
await measureOn(ph)
await shot(ph, '73-import-phone.png')
await switchUser(ph, 'u-hos-1')
await ph.click('nav >> text=Placement policy')
await ph.click('#lha-open')
await ph.fill('#lha-file', lhaCsv)
await ph.fill('#lha-citation', 'DWP, Local Housing Allowance rates, January 2011 (walkthrough copy)')
await ph.fill('#lha-sourceDate', '2011-01-01')
await ph.check('#lha-confirm')
await ph.click('#lha-check')
await ph.waitForSelector('#lha-preview')
await measureOn(ph)
await ph.locator('#subsidy-table').screenshot({ path: out('74-subsidy-preview-phone.png') })
await ph.click('nav >> text=Audit log')
await measureOn(ph)

// Phase 3 in dark mode
const { ctx: dkctx, page: dk } = await open({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' }, 'dark-hosted')
await dkctx.route('**/api/travel-status', travelStatus(true))
await dkctx.route('**/api/travel-matrix', travelBadKey)
await dkctx.route('https://api.postcodes.io/**', postcodeRoute)
await dk.goto(hosted)
await signIn(dk, 'u-ta-2')
await dk.click('text=Wheelchair user and two children, fleeing abuse')
await dk.click('#pc-open')
await dk.fill('#pc-postcode', 'E7 9ZZ')
await dk.click('#pc-lookup')
await dk.waitForSelector('#pc-message')
await dk.locator('section:has(h2:has-text("Places that matter"))').screenshot({ path: out('80-postcode-dark.png') })
await dk.click('button:has-text("Find placements")')
await dk.waitForSelector('text=Placement options')
await shot(dk, '81-results-fallback-dark.png')
await dk.click('nav >> text=New placement')
await dk.click('#import-open')
await dk.locator('#import-panel').screenshot({ path: out('82-import-panel-dark.png') })
await dk.click('#import-example-family')
await dk.waitForSelector('#import-report')
await shot(dk, '83-import-dark.png')
await switchUser(dk, 'u-hos-1')
await dk.click('nav >> text=Placement policy')
await dk.click('#lha-open')
await dk.fill('#lha-file', lhaCsv)
await dk.fill('#lha-citation', 'DWP, Local Housing Allowance rates, January 2011 (walkthrough copy)')
await dk.fill('#lha-sourceDate', '2011-01-01')
await dk.check('#lha-confirm')
await dk.click('#lha-check')
await dk.waitForSelector('#lha-preview')
await dk.locator('#subsidy-table').screenshot({ path: out('84-subsidy-preview-dark.png') })
await dk.click('nav >> text=Audit log')
await dk.click('#export-csv-copy')
await dk.waitForSelector('#export-csv-status')
await dk.locator('#export-placements').screenshot({ path: out('85-export-dark.png') })

await browser.close()
server.close()
const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([k]) => k)
console.log(
  JSON.stringify(
    {
      horizontalOverflowPx: overflow,
      errors,
      simulatedNetworkFailures: simulatedFailures.length,
      checksPassed: Object.keys(checks).length - failed.length,
      checksFailed: failed,
    },
    null,
    2,
  ),
)
if (failed.length) process.exitCode = 1
