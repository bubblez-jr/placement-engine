import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../src/data/households'
import { defaultRuleset } from '../src/data/ruleset'
import { STAFF } from '../src/data/staff'
import { subsidyPerNight, subsidyProvenance, subsidyStatusOf } from '../src/engine/cost'
import { PermissionError } from '../src/engine/permissions'
import { brmaCounts, diffLhaTables, parseLhaCsv, validateSubsidyImport } from '../src/engine/subsidyTable'
import { ValidationError } from '../src/engine/validate'
import { cmdPublishRuleset, cmdPublishSubsidyTable, cmdSearch, type CommandCtx } from '../src/store/commands'
import { activeRulesetOf, seed } from '../src/store/data'
import { seedProperties } from '../src/data/properties'
import { estimateProvider } from '../src/travel/estimate'
import { NOW, TODAY } from './fixtures'

// A table in the documented format. The numbers are test values, not DWP's.
const BRMAS = [
  'Inner East London',
  'Outer North East London',
  'Outer East London',
  'Outer South London',
  'Harlow & Stortford',
  'Basildon',
  'Luton',
  'Milton Keynes',
  'Chelmsford',
]
const goodCsv = ['brma,1_bed,2_bed,3_bed,4_bed', ...BRMAS.map((b, i) => `${b.includes('&') ? `"${b}"` : b},${200 + i},${240 + i},${290 + i},${350 + i}`)].join(
  '\n',
)
const inventory = brmaCounts(seedProperties(TODAY, NOW))
const as = (id: string): CommandCtx => ({ user: STAFF.find(s => s.id === id)!, now: NOW, today: TODAY })
const note = 'Loads the official subsidy table; no change to weights, so no new equality effect on who is placed where.'
const input = {
  csv: goodCsv,
  citation: 'DWP, Local Housing Allowance rates January 2011 (test copy)',
  sourceDate: '2011-01-01',
  confirmedOfficial: true,
  equalityNote: note,
}
const refused = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e
  }
  return null
}

describe('reading an LHA table', () => {
  it('reads a good file, with quoted names and pound signs', () => {
    const r = parseLhaCsv(goodCsv.replace('200,', '£200.00,'), inventory)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.rows).toBe(9)
    expect(r.table!['Inner East London']).toEqual({ '1': 200, '2': 240, '3': 290, '4': 350 })
    expect(r.table!['Harlow & Stortford']).toEqual({ '1': 204, '2': 244, '3': 294, '4': 354 })
  })
  it('reads and ignores the shared and 5-bedroom columns, saying so', () => {
    const r = parseLhaCsv('brma,shared,1_bed,2_bed,3_bed,4_bed,5_bed\nLuton,60,100,120,150,190,240')
    expect(r.errors).toEqual([])
    expect(r.ignoredColumns).toEqual(['shared', '5_bed'])
    expect(r.table).toEqual({ Luton: { '1': 100, '2': 120, '3': 150, '4': 190 } })
  })
  it.each([
    ['wrong columns', 'area,one,two,three,four\nLuton,1,2,3,4', /Columns not recognised: area, one/],
    ['a missing column', 'brma,1_bed,2_bed,3_bed\nLuton,100,120,150', /Missing columns: 4_bed/],
    ['a column twice', 'brma,1_bed,1_bed,2_bed,3_bed,4_bed\nLuton,1,1,2,3,4', /Columns given twice: 1_bed/],
    ['no rows', 'brma,1_bed,2_bed,3_bed,4_bed', /header row and at least one area/],
    ['a short row', 'brma,1_bed,2_bed,3_bed,4_bed\nLuton,100,120,150', /Row 2: 4 values for 5 columns/],
    ['a monthly figure', 'brma,1_bed,2_bed,3_bed,4_bed\nLuton,100,120,150,4800', /£4800 a week is too high.*monthly/],
    ['a daily figure', 'brma,1_bed,2_bed,3_bed,4_bed\nLuton,15,120,150,190', /£15 a week is too low/],
    ['text for a rate', 'brma,1_bed,2_bed,3_bed,4_bed\nLuton,n/a,120,150,190', /“n\/a” is not an amount/],
    ['a negative rate', 'brma,1_bed,2_bed,3_bed,4_bed\nLuton,-100,120,150,190', /not an amount/],
    ['a blank area', 'brma,1_bed,2_bed,3_bed,4_bed\n,100,120,150,190', /area \(BRMA\) name is blank/],
    ['a duplicate area', 'brma,1_bed,2_bed,3_bed,4_bed\nLuton,100,120,150,190\nluton,101,121,151,191', /Row 3: luton appears twice \(first on row 2\)/],
  ])('refuses %s', (_, csv, msg) => {
    const r = parseLhaCsv(csv)
    expect(r.table).toBeNull()
    expect(r.errors.join(' ')).toMatch(msg)
  })
  it('warns when rates do not rise with size, and when the inventory uses an area the file lacks or spells differently', () => {
    const csv = goodCsv
      .replace('Luton,206,246,296,356', 'Luton,206,196,296,356')
      .replace('Basildon', 'BASILDON')
      .replace(/\nChelmsford.*$/, '')
    const r = parseLhaCsv(csv, inventory)
    expect(r.errors).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/Luton: the rates do not rise/)
    expect(r.warnings.join(' ')).toMatch(/in “Basildon”, but the file spells it “BASILDON”/)
    expect(r.warnings.join(' ')).toMatch(/in Chelmsford, which is not in the file: their subsidy would be counted as £0/)
  })
  it('compares against the table in use', () => {
    const cur = defaultRuleset(NOW).subsidy.lhaJan2011Weekly
    const next = parseLhaCsv(goodCsv.replace(/\nChelmsford.*$/, '') + '\nNew Area,100,120,140,160').table!
    const d = diffLhaTables(cur, next)
    expect(d.added).toEqual(['New Area'])
    expect(d.removed).toEqual(['Chelmsford'])
    expect(d.changed.length).toBe(8)
    expect(d.changed[0]).toEqual({
      brma: 'Inner East London',
      from: { '1': 250, '2': 300, '3': 350, '4': 420 },
      to: { '1': 200, '2': 240, '3': 290, '4': 350 },
    })
    expect(diffLhaTables(cur, cur)).toEqual({ added: [], removed: [], changed: [], unchanged: 9 })
  })
  it('needs a citation, a real past date for the source and a confirmation', () => {
    const { issues } = validateSubsidyImport({ csv: goodCsv, citation: 'DWP', sourceDate: '2099-01-01', confirmedOfficial: false }, TODAY, inventory)
    expect(issues.filter(i => i.severity === 'error').map(i => i.path)).toEqual(['lha-citation', 'lha-sourceDate', 'lha-confirm'])
    expect(validateSubsidyImport({}, TODAY, inventory).issues.map(i => i.path)).toEqual(['lha-file', 'lha-citation', 'lha-sourceDate', 'lha-confirm'])
  })
})

describe('subsidy status', () => {
  it('the shipped table, and every version published before phase 3, is illustrative', () => {
    const rs = defaultRuleset(NOW)
    expect(subsidyStatusOf(rs)).toBe('illustrative')
    const old = { ...rs, subsidy: { ...rs.subsidy, status: undefined } }
    expect(subsidyStatusOf(old)).toBe('illustrative')
    expect(subsidyProvenance(old).label).toBe('Illustrative subsidy figures')
  })
  it('“official” without a citation and dates still reads as illustrative', () => {
    const rs = defaultRuleset(NOW)
    expect(subsidyStatusOf({ subsidy: { ...rs.subsidy, status: 'official' } })).toBe('illustrative')
  })
})

describe('publishing the official table', () => {
  it('only the head of service or an administrator can load it', async () => {
    const d = await seed(NOW, TODAY)
    for (const who of ['u-ta-1', 'u-mgr-1', 'u-sup-1', 'u-aud-1'])
      expect(await refused(cmdPublishSubsidyTable(d, as(who), input))).toBeInstanceOf(PermissionError)
    expect((await cmdPublishSubsidyTable(d, as('u-adm-1'), input)).ruleset.subsidy.status).toBe('official')
  })
  it('refuses a table that fails the checks, and publishes nothing', async () => {
    const d = await seed(NOW, TODAY)
    for (const bad of [
      { ...input, csv: 'brma,1,2,3,4\nLuton,1,2,3,4' },
      { ...input, csv: goodCsv + '\nLuton,1,2,3,4' },
      { ...input, citation: '' },
      { ...input, confirmedOfficial: false },
      { ...input, equalityNote: '' },
    ])
      expect(await refused(cmdPublishSubsidyTable(d, as('u-hos-1'), bad))).toBeInstanceOf(ValidationError)
  })
  it('publishes a new signed version; the old version is unchanged; new searches say official all the way to the explanation', async () => {
    const d0 = await seed(NOW, TODAY)
    const officer = as('u-ta-1')
    const h = SCENARIOS.find(s => s.id === 'brief')!.household(TODAY)
    const before = await cmdSearch(d0, officer, h, { id: 'S-before', travel: estimateProvider })
    const { data: d1, ruleset } = await cmdPublishSubsidyTable(before.data, as('u-hos-1'), input)
    expect(ruleset.version).toBe('1.1')
    expect(ruleset.hash).not.toBe(d0.rulesets[0].hash)
    expect(ruleset.subsidy).toMatchObject({ status: 'official', citation: input.citation, sourceDate: '2011-01-01', loadedOn: TODAY })
    expect(ruleset.signOff.actor?.userId).toBe('u-hos-1')
    expect(d1.rulesets[0]).toEqual(d0.rulesets[0])
    expect(activeRulesetOf(d1).version).toBe('1.1')

    // The search before: illustrative, and it stays so.
    expect(before.result.subsidy).toMatchObject({ status: 'illustrative', label: 'Illustrative subsidy figures' })
    expect(before.result.explanation.cost.join(' ')).toMatch(/After housing benefit subsidy \(illustrative figures\)/)
    expect(before.result.explanation.cost.join(' ')).toMatch(/illustrative, not the official table/)
    expect(before.result.candidates[0].cost.subsidyBasis).toMatch(/^Illustrative figures: /)

    const after = await cmdSearch(d1, officer, h, { id: 'S-after', travel: estimateProvider })
    expect(after.result.rulesetVersion).toBe('1.1')
    expect(after.result.subsidy).toMatchObject({ status: 'official', label: 'Official subsidy table' })
    expect(after.result.subsidy!.detail).toContain(input.citation)
    expect(after.result.explanation.cost.join(' ')).toMatch(/After housing benefit subsidy \(official table\)/)
    expect(after.result.explanation.cost.join(' ')).toMatch(/official January 2011 LHA table loaded on 2026-11-02/)
    const p = after.result.candidates.find(c => c.eligible)!
    expect(p.cost.subsidyBasis).toMatch(/^Official table: /)
    expect(subsidyPerNight(d1.properties.find(x => x.id === p.propertyId)!, ruleset).basis).toMatch(/^Official table/)
  })
  it('a weights change cannot edit the table or relabel it as official', async () => {
    const d = await seed(NOW, TODAY)
    const rs = activeRulesetOf(d)
    const forged = {
      ...rs,
      subsidy: { ...rs.subsidy, status: 'official' as const, citation: 'Made up for the test', sourceDate: '2011-01-01', loadedOn: TODAY },
    }
    expect(await refused(cmdPublishRuleset(d, as('u-hos-1'), forged, note))).toBeInstanceOf(ValidationError)
    const edited = { ...rs, subsidy: { ...rs.subsidy, lhaJan2011Weekly: { Luton: { '1': 1, '2': 2, '3': 3, '4': 4 } } } }
    expect(await refused(cmdPublishRuleset(d, as('u-hos-1'), edited, note))).toBeInstanceOf(ValidationError)
    // After an official load, a weights change keeps the official table as it is.
    const { data: d1 } = await cmdPublishSubsidyTable(d, as('u-hos-1'), input)
    const next = activeRulesetOf(d1)
    const { ruleset } = await cmdPublishRuleset(d1, as('u-hos-1'), { ...next, costTieBreakBand: 4 }, note)
    expect(subsidyStatusOf(ruleset)).toBe('official')
  })
})
