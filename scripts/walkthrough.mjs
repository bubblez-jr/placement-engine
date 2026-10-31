// Clicks through the main flow and saves screenshots to screenshots/.
// Usage: node scripts/walkthrough.mjs [url]   (default: dist-demo/index.html)
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const url = process.argv[2] ?? pathToFileURL(resolve('dist-demo/index.html')).href
const out = p => resolve('screenshots', p)
const errors = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
const page = await ctx.newPage()
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', e => errors.push(String(e)))

await page.goto(url)
await page.waitForSelector('text=Start from an example household')
await page.screenshot({ path: out('01-home.png'), fullPage: true })

await page.click('text=Parent and three children, needed tonight')
await page.waitForSelector('text=Find placements')
await page.screenshot({ path: out('02-form.png'), fullPage: true })

await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await page.screenshot({ path: out('03-results.png'), fullPage: true })

await page.click('text=Why this property')
await page.waitForSelector('text=Every check run')
await page.screenshot({ path: out('04-property.png'), fullPage: true })

await page.click('text=Back to options')
await page.click('button:has-text("Compare top options")')
await page.waitForSelector('text=Side by side')
await page.click('button.chip:has-text("Becontree Heath 22")')
await page.screenshot({ path: out('05-compare.png'), fullPage: true })

await page.click('text=Back to options')
await page.click('text=Review and record decision')
await page.waitForSelector('text=Record the placement decision')
await page.check('#confirm')
await page.screenshot({ path: out('06-decide.png'), fullPage: true })
await page.click('button:has-text("Record decision")')
await page.waitForSelector('text=Placement recorded')
await page.screenshot({ path: out('07-decision.png'), fullPage: true })

await page.click('text=Open the audit pack')
await page.waitForSelector('text=Seal intact')
await page.screenshot({ path: out('08-audit-pack.png'), fullPage: true })

// Second decision: an override, from the large-family scenario
await page.click('nav >> text=Overview')
await page.click('text=Two adults and five children, exam year')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await page.screenshot({ path: out('09-results-large.png'), fullPage: true })
await page.click('text=Review and record decision')
await page.click('label:has-text("Seven Kings 8")')
await page.fill('#reasonText', 'Household asked for Seven Kings: the father works nights nearby and the eldest is settled at a youth club there.')
await page.check('#confirm')
await page.click('button:has-text("Record decision")')
await page.waitForSelector('text=Placement recorded')

await page.click('nav >> text=Audit log')
await page.click('text=Edit record #1 behind the system’s back')
await page.click('section >> button:has-text("Check every seal")')
await page.waitForSelector('text=cannot be relied on')
await page.screenshot({ path: out('10-audit-log-tampered.png'), fullPage: true })
await page.click('text=Put record #1 back')

await page.click('nav >> text=Placement policy')
await page.waitForSelector('text=Version history')
await page.screenshot({ path: out('11-rules.png'), fullPage: true })

await page.click('nav >> text=Properties')
await page.waitForSelector('text=Import from a spreadsheet')
await page.screenshot({ path: out('12-properties.png'), fullPage: true })

await page.click('nav >> text=Overview')
await page.screenshot({ path: out('13-home-after.png'), fullPage: true })

// Out-of-hours scenario: last resort + 6-week clock
await page.click('text=Pregnant, alone, out of hours')
await page.click('button:has-text("Find placements")')
await page.waitForSelector('text=Placement options')
await page.screenshot({ path: out('14-results-outofhours.png'), fullPage: true })

// Dark mode and phone width
const dark = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' })
const dp = await dark.newPage()
dp.on('pageerror', e => errors.push(String(e)))
await dp.goto(url)
await dp.click('text=Wheelchair user and two children, fleeing abuse')
await dp.click('button:has-text("Find placements")')
await dp.waitForSelector('text=Placement options')
await dp.screenshot({ path: out('15-results-dark.png'), fullPage: true })

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const pp = await phone.newPage()
pp.on('pageerror', e => errors.push(String(e)))
await pp.goto(url)
await pp.click('text=Parent and three children, needed tonight')
await pp.click('button:has-text("Find placements")')
await pp.waitForSelector('text=Placement options')
const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
await pp.screenshot({ path: out('16-results-phone.png'), fullPage: true })

await browser.close()
console.log(JSON.stringify({ horizontalOverflowPx: overflow, errors }, null, 2))
