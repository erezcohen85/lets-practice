import { createFakes } from '@/lib/fakes'
import { OTHER_USER, setPlanLimits } from '@/lib/fakes/store'

describe('the fake sample piece', () => {
  it('is given once: the copy is in the library, marked, with its credits and its own parts and map', async () => {
    const { data, processor } = createFakes({ seed: 'empty', signedIn: true, termsAccepted: true })
    expect((await data.getProfile()).sampleGivenAt).toBeNull()

    const claim = await processor.claimSamplePiece()

    expect(claim.status).toBe('given')
    const pieces = await data.listPieces()
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ title: 'Sample: Synthetic Waltz', isSample: true, role: 'owner' })
    expect(claim).toEqual({ status: 'given', pieceId: pieces[0]!.id })
    const detail = await data.getPiece(pieces[0]!.id)
    expect(detail?.sampleCredits).toHaveLength(1)
    expect(detail?.sampleCredits?.[0]).toMatchObject({ what: expect.any(String), who: expect.any(String), licence: expect.any(String), source: expect.stringMatching(/^https:\/\//) })
    expect(detail?.job?.status).toBe('done')
    expect((await data.getPieceMap(pieces[0]!.id))?.timing.barCount).toBeGreaterThan(0)
    expect((await data.getProfile()).sampleGivenAt).not.toBeNull()
  })

  it('a second call answers already and makes no second copy', async () => {
    const { data, processor } = createFakes({ seed: 'empty', signedIn: true })
    await processor.claimSamplePiece()

    expect(await processor.claimSamplePiece()).toEqual({ status: 'already' })
    expect(await data.listPieces()).toHaveLength(1)
  })

  it('stays given when the user deletes the copy', async () => {
    const { data, processor } = createFakes({ seed: 'empty', signedIn: true })
    const claim = await processor.claimSamplePiece()
    if (claim.status !== 'given') throw new Error('expected given')
    await data.deletePiece(claim.pieceId)

    expect(await processor.claimSamplePiece()).toEqual({ status: 'already' })
    expect(await data.listPieces()).toEqual([])
  })

  it('counts as one piece created and one stored in the plan, and not toward the day', async () => {
    const { data, processor } = createFakes({ seed: 'empty', signedIn: true })
    await processor.claimSamplePiece()

    const { usage } = await data.myPlan()
    expect(usage).toMatchObject({ pieces_created: 1, pieces_stored: 1, new_pieces_today_on_plan: 0 })
  })

  it('is skipped on a full Trial (3 stored), and then not asked again', async () => {
    const { data, processor } = createFakes({ seed: 'empty', signedInAs: OTHER_USER.id })
    for (const title of ['A', 'B', 'C']) await data.createPiece({ title, recording: { kind: 'file', file: new File(['a'], 'a.mp3') }, parts: [{ file: new File(['p'], 'p.pdf'), name: '' }] })

    expect(await processor.claimSamplePiece()).toEqual({ status: 'skipped' })
    expect(await data.listPieces()).toHaveLength(3)
    expect((await data.getProfile()).sampleGivenAt).not.toBeNull()
    expect(await processor.claimSamplePiece()).toEqual({ status: 'already' })
  })

  it('is skipped when all the pieces the plan lets be created are used', async () => {
    const { data, processor, store } = createFakes({ seed: 'empty', signedInAs: OTHER_USER.id })
    setPlanLimits(store, 'trial', { pieces_created_max: 0 })

    expect(await processor.claimSamplePiece()).toEqual({ status: 'skipped' })
    expect(await data.listPieces()).toEqual([])
  })

  it('is given to the admin whatever the Trial numbers are', async () => {
    const { processor, store } = createFakes({ seed: 'empty', signedIn: true })
    setPlanLimits(store, 'trial', { pieces_created_max: 0, pieces_stored_max: 0 })

    expect((await processor.claimSamplePiece()).status).toBe('given')
  })

  it('rejects when nobody is signed in', async () => {
    const { processor } = createFakes({ seed: 'empty', signedIn: false })

    await expect(processor.claimSamplePiece()).rejects.toThrow('not signed in')
  })

  it('leaves an ordinary piece unmarked, with no credits', async () => {
    const { data } = createFakes({ seed: 'demo' })

    expect((await data.listPieces()).every((piece) => piece.isSample === false)).toBe(true)
    expect((await data.getPiece('piece-clark-county'))?.sampleCredits).toBeNull()
  })
})
