import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseDemoBundle } from '@/lib/demo/demoBundle'
import { demoBaseUrl } from '@/lib/demo/demoClients'

// The bundles in git, read from disk as the page will read them over the web. The drawn one needs no credit, and real/ is
// the git-ignored place for a piece nobody has cleared. Anything else in public/demo is real music in public: it must say
// whose it is.
const publicDir = path.resolve(import.meta.dirname, '..', '..', '..', 'public')
const demoDir = path.join(publicDir, 'demo')
const read = (name: string) => parseDemoBundle(JSON.parse(readFileSync(path.join(demoDir, name, 'demo.json'), 'utf8')))
const realBundles = readdirSync(demoDir).filter((name) => name !== 'synthetic' && name !== 'real')

describe('the bundles in git', () => {
  it('has the default bundle of /demo among them', () => {
    expect(existsSync(path.join(publicDir, demoBaseUrl({ BASE_URL: '/' }), 'demo.json'))).toBe(true)
  })

  it.each(realBundles)('%s credits its recording and its score', (name) => {
    expect(read(name).credits?.map((credit) => credit.what)).toEqual(['Recording', 'Score'])
  })

  it.each(realBundles)('%s has its recording and every page image on disk', (name) => {
    const bundle = read(name)
    const files = [bundle.audio, ...Object.values(bundle.pageImages).flat().map((image) => image.file)]
    for (const file of files) expect(existsSync(path.join(demoDir, name, file))).toBe(true)
  })

  it.each(realBundles)('%s has a box and a time for every bar', (name) => {
    const bundle = read(name)
    const timed = bundle.timing.locators.map((locator) => locator.bar).sort((a, b) => a - b)
    for (const part of bundle.parts) expect(bundle.pages[part.id].bars.map((box) => box.bar).sort((a, b) => a - b)).toEqual(timed)
  })

  // CC BY 3.0 section 4: the author, the title the licensor gave it, a link, the licence, and how the work was used.
  it('credits the Gondola Song recording as CC BY 3.0 asks', () => {
    expect(read('gondola-song').credits?.[0]).toMatchObject({
      who: 'FAE Piano cafe',
      title: 'Mendelssohn Venetianisches Gondellied op.30 no.6',
      note: 'Converted to AAC and synced to the score.',
      licence: 'CC BY 3.0',
      source: expect.stringContaining('commons.wikimedia.org/wiki/File:FAE_Piano_cafe'),
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    })
  })

  it('shows the Gondola Song under its clean names, not the names of the owner files', () => {
    const bundle = read('gondola-song')

    expect(bundle.piece.title).toBe('Mendelssohn, Venetian Gondola Song, Op. 30 No. 6')
    expect(bundle.parts.map((part) => part.name)).toEqual(['Piano'])
    expect(JSON.stringify(bundle)).not.toContain('venetian-boat-song')
  })
})
