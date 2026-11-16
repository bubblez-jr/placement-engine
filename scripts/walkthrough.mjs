// Clicks through every flow and saves screenshots to screenshots/.
// Usage: node scripts/walkthrough.mjs [url]   (default: dist-demo/index.html)
// Prints a JSON summary: the widest horizontal overflow seen at phone width,
// console errors, and the checks below. Exits non-zero if a check fails.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const url = process.argv[2] ?? pathToFileURL(resolve('dist-demo/index.html')).href
const out = p => resolve('screenshots', p)
const errors = []
const checks = {}
const expect = (name, ok) => {
  checks[name] = !!ok
}
const browser = await chromium.launch()

async function open(options, name) {
  const ctx = await browser.newContext(options)
  const page = await ctx.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`))
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
await page.waitForSelector('text=Placement recorded')
expect('decisionShowsSignedInOfficer', await page.locator('dd:has-text("Sam Okafor, Temporary accommodation officer")').isVisible())
await shot(page, '11-decision.png')
await page.click('text=Open the audit pack')
await page.waitForSelector('text=Seal intact')
await shot(page, '12-audit-pack.png')

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
await page.click('button:has-text("Record decision")')
await page.waitForSelector('text=Placement recorded')
expect('notAskedCreatesFollowUp', await page.locator('text=Ask a parent for consent').first().isVisible())
await page.click('#update-consent')
await page.check('#consent-status')
await page.selectOption('#consent-givenBy', 'Adult 2')
await page.check('#consent-method-phone')
await page.click('button:has-text("Save consent")')
await page.waitForSelector('text=The decision record is unchanged')
expect('consentUpdateIsNewRecord', await page.locator('text=Record #3: changed by Sam Okafor').isVisible())
await shot(page, '14-decision-consent-updated.png')

// Out-of-hours example: last resort and the six-week clock
await page.click('nav >> text=Overview')
await page.click('text=Pregnant, alone, out of hours')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await shot(page, '15-results-outofhours.png')

// Switch to a manager: the audit log, tamper demo, and a policy screen they cannot publish from
await switchUser(page, 'u-mgr-1')
expect('railShowsManager', (await page.locator('aside :text("Hannah Clarke"):visible').count()) > 0)
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
await page.click('tbody tr:has-text("#2")')
await page.waitForSelector('text=Placement recorded')
expect('auditorCannotChangeConsent', (await page.locator('#update-consent').count()) === 0)
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
await old.waitForSelector('text=Placement recorded')
await shot(old, '22-schema1-decision.png')

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

// ---------- Phone ----------
const { page: pp } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }, 'phone')
let overflow = 0
const measure = async () => {
  overflow = Math.max(overflow, await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
}
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
await pp.waitForSelector('text=Placement recorded')
expect('refusedSuppressesNotice', await pp.locator('text=so no notice is drafted').isVisible())
await measure()
await shot(pp, '45-decision-phone.png')
await pp.click('text=Open the audit pack')
await pp.waitForSelector('text=Seal intact')
await measure()
await shot(pp, '46-audit-pack-phone.png')

await browser.close()
const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([k]) => k)
console.log(JSON.stringify({ horizontalOverflowPx: overflow, errors, checksPassed: Object.keys(checks).length - failed.length, checksFailed: failed }, null, 2))
if (failed.length) process.exitCode = 1
