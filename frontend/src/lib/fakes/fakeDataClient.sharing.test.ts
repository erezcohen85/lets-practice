import { describe, expect, it } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, OTHER_USER, setPlanLimits, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { TERMS_VERSION } from '@/domain/terms'
import { shareLinkOn } from '@/test/shareLink'

function file(name: string) { return new File(['x'], name, { type: 'application/pdf' }) }

async function ownedPiece(fakes: Fakes) {
  signInAs(fakes.store, DEMO_USER.id)
  return fakes.data.createPiece({ title: 'Etude', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [{ file: file('a.pdf'), name: 'A' }] })
}
async function joined(fakes: Fakes, userId = OTHER_USER.id) {
  const piece = await ownedPiece(fakes)
  const { token } = await shareLinkOn(fakes.data, piece.id)
  signInAs(fakes.store, userId)
  await fakes.data.joinPiece(token)
  return { piece, token }
}

describe('profiles', () => {
  it('the demo user is admin, the other user is not', async () => {
    const fakes = createFakes()
    signInAs(fakes.store, DEMO_USER.id)
    expect(await fakes.data.getProfile()).toMatchObject({ isAdmin: true })
    signInAs(fakes.store, OTHER_USER.id)
    expect(await fakes.data.getProfile()).toMatchObject({ isAdmin: false, email: OTHER_USER.email, displayName: OTHER_USER.name })
  })
  it('accepting stores the time and the version', async () => {
    const fakes = createFakes({ signedIn: true })
    expect(await fakes.data.acceptTerms()).toMatchObject({ acceptedTermsVersion: TERMS_VERSION })
  })
  it('createFakes with accepted terms means the current version', async () => {
    const fakes = createFakes({ signedIn: true, termsAccepted: true })
    expect((await fakes.data.getProfile()).acceptedTermsVersion).toBe(TERMS_VERSION)
  })
})

describe('joining', () => {
  it('every status', async () => {
    const fakes = createFakes()
    const piece = await ownedPiece(fakes)
    const { token } = await shareLinkOn(fakes.data, piece.id)
    expect(await fakes.data.joinPiece(token)).toEqual({ pieceId: piece.id, status: 'owner' })
    expect(await fakes.data.joinPiece('nope')).toEqual({ pieceId: null, status: 'not_found' })
    signInAs(fakes.store, OTHER_USER.id)
    expect(await fakes.data.joinPiece(token)).toEqual({ pieceId: piece.id, status: 'joined' })
    expect(await fakes.data.joinPiece(token)).toEqual({ pieceId: piece.id, status: 'already_member' })
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.data.setShareEnabled(piece.id, false)
    expect(await fakes.data.joinPiece(token)).toEqual({ pieceId: piece.id, status: 'owner' })
    signInAs(fakes.store, THIRD_USER.id)
    expect(await fakes.data.joinPiece(token)).toEqual({ pieceId: null, status: 'link_off' })
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.joinPiece(token)).status).toBe('already_member')
  })
  it('a new link is off with no rights time, and joining by it says link_off', async () => {
    const fakes = createFakes()
    const piece = await ownedPiece(fakes)

    const share = await fakes.data.getShare(piece.id)

    expect(share).toMatchObject({ enabled: false, rightsConfirmedAt: null })
    signInAs(fakes.store, THIRD_USER.id)
    expect(await fakes.data.joinPiece(share.token)).toEqual({ pieceId: null, status: 'link_off' })
  })
  it('turning a link on needs the rights confirmation, which saves the time once; off and on again need none', async () => {
    const fakes = createFakes()
    const piece = await ownedPiece(fakes)
    await fakes.data.getShare(piece.id)

    await expect(fakes.data.setShareEnabled(piece.id, true)).rejects.toThrow(/confirm the rights/)
    expect(await fakes.data.getShare(piece.id)).toMatchObject({ enabled: false, rightsConfirmedAt: null })

    await fakes.data.setShareEnabled(piece.id, true, true)
    const confirmed = (await fakes.data.getShare(piece.id)).rightsConfirmedAt
    expect(confirmed).not.toBeNull()
    await fakes.data.setShareEnabled(piece.id, false)
    await fakes.data.setShareEnabled(piece.id, true)
    await fakes.data.setShareEnabled(piece.id, true, true)
    expect(await fakes.data.getShare(piece.id)).toMatchObject({ enabled: true, rightsConfirmedAt: confirmed })
  })
  it('a reset keeps the switch and the rights time as they were', async () => {
    const fakes = createFakes()
    const piece = await ownedPiece(fakes)
    const before = await shareLinkOn(fakes.data, piece.id)

    const after = await fakes.data.resetShareLink(piece.id)

    expect(after.token).not.toBe(before.token)
    expect(after).toMatchObject({ enabled: true, rightsConfirmedAt: before.rightsConfirmedAt })
  })
  it('getShare gives the same link until it is reset; the old one then fails', async () => {
    const fakes = createFakes()
    const piece = await ownedPiece(fakes)
    const first = await fakes.data.getShare(piece.id)
    expect(await fakes.data.getShare(piece.id)).toEqual(first)
    const second = await fakes.data.resetShareLink(piece.id)
    expect(second.token).not.toBe(first.token)
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.joinPiece(first.token)).status).toBe('not_found')
  })
})

describe('a member', () => {
  it('sees the piece as a viewer with the owner\'s name and when they joined', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    const [summary] = await fakes.data.listPieces()
    expect(summary).toMatchObject({ id: piece.id, role: 'viewer', ownerName: DEMO_USER.name })
    expect(summary?.joinedAt).not.toBeNull()
    expect((await fakes.data.getPiece(piece.id))?.piece).toMatchObject({ role: 'viewer', ownerName: DEMO_USER.name })
    expect(await fakes.data.getPieceMap(piece.id)).not.toBeNull()
  })
  it('an owner sees role owner and no join time', async () => {
    const fakes = createFakes()
    await ownedPiece(fakes)
    expect((await fakes.data.listPieces())[0]).toMatchObject({ role: 'owner', joinedAt: null })
  })
  it('cannot change anything the owner can', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    const map = (await fakes.data.getPieceMap(piece.id))!
    const refused = [
      fakes.data.renamePiece(piece.id, 'x'),
      fakes.data.deletePiece(piece.id),
      fakes.data.renameRecording(piece.id, 'x'),
      fakes.data.saveTiming(piece.id, map.timing),
      fakes.data.storeParts(piece.id, [{ file: file('b.pdf'), name: 'B' }]),
      fakes.data.getShare(piece.id),
      fakes.data.setShareEnabled(piece.id, false),
      fakes.data.resetShareLink(piece.id),
    ]
    for (const attempt of refused) await expect(attempt).rejects.toThrow()
    expect(await fakes.data.listMembers(piece.id)).toEqual([])
  })
  it('keeps their own memory; the owner\'s stays unchanged', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    const before = (await fakes.data.getPiece(piece.id))!.piece
    await fakes.data.setCountInBars(piece.id, 4)
    await fakes.data.savePracticeMemory(piece.id, { ...before.practice, speed: 0.5 })
    await fakes.data.setLastPart(piece.id, piece.parts[0]!.id)
    const mine = (await fakes.data.getPiece(piece.id))!.piece
    expect(mine).toMatchObject({ countInBars: 4, lastPartId: piece.parts[0]!.id })
    expect(mine.practice.speed).toBe(0.5)
    signInAs(fakes.store, DEMO_USER.id)
    const owners = (await fakes.data.getPiece(piece.id))!.piece
    expect(owners).toMatchObject({ countInBars: before.countInBars, lastPartId: null })
    expect(owners.practice.speed).toBe(before.practice.speed)
  })
  it('leaving removes the piece and its memory; joining again starts fresh', async () => {
    const fakes = createFakes()
    const { piece, token } = await joined(fakes)
    await fakes.data.setCountInBars(piece.id, 4)
    await fakes.data.leavePiece(piece.id)
    expect(await fakes.data.listPieces()).toEqual([])
    expect(await fakes.data.getPiece(piece.id)).toBeNull()
    await fakes.data.joinPiece(token)
    expect((await fakes.data.getPiece(piece.id))?.piece.countInBars).not.toBe(4)
  })
  it('an owner edit reaches the member', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.data.renamePiece(piece.id, 'Better title')
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.getPiece(piece.id))?.piece.title).toBe('Better title')
  })
})

describe('the owner', () => {
  it('lists and removes members', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    signInAs(fakes.store, DEMO_USER.id)
    expect(await fakes.data.listMembers(piece.id)).toMatchObject([{ userId: OTHER_USER.id, displayName: OTHER_USER.name, email: OTHER_USER.email }])
    await fakes.data.removeMember(piece.id, OTHER_USER.id)
    expect(await fakes.data.listMembers(piece.id)).toEqual([])
    signInAs(fakes.store, OTHER_USER.id)
    expect(await fakes.data.getPiece(piece.id)).toBeNull()
  })
  it('deleting the piece deletes the link, the members and their memory', async () => {
    const fakes = createFakes()
    const { piece, token } = await joined(fakes)
    await fakes.data.setCountInBars(piece.id, 4)
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.data.deletePiece(piece.id)
    expect(fakes.store.shares.size).toBe(0)
    expect(fakes.store.members.size).toBe(0)
    expect(fakes.store.memberMemory.size).toBe(0)
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.joinPiece(token)).status).toBe('not_found')
  })
  it('deleting a part clears it from a member\'s memory', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    signInAs(fakes.store, DEMO_USER.id)
    const [added] = await fakes.data.storeParts(piece.id, [{ file: file('b.pdf'), name: 'B' }])
    signInAs(fakes.store, OTHER_USER.id)
    await fakes.data.setLastPart(piece.id, added!.id)
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.data.deletePart(piece.id, added!.id)
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.getPiece(piece.id))?.piece.lastPartId).toBeNull()
  })
})

describe('uploads and the admin', () => {
  it('a Trial user can create a piece, up to the plan', async () => {
    const fakes = createFakes()
    signInAs(fakes.store, OTHER_USER.id)
    const piece = await fakes.data.createPiece({ title: 'x', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [] })
    expect((await fakes.data.listPieces()).map((summary) => summary.id)).toEqual([piece.id])
  })
  it('refuses the admin methods for a non-admin', async () => {
    const fakes = createFakes()
    signInAs(fakes.store, OTHER_USER.id)
    await expect(fakes.data.adminOverview()).rejects.toThrow(/admin only/)
    await expect(fakes.data.saveAdminChanges({ plans: [], people: [] })).rejects.toThrow(/admin only/)
  })
  it('the processor refuses a member, and an owner whose plan has no room', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    await expect(fakes.processor.realign(piece.id)).rejects.toThrow()
    await expect(fakes.processor.processPiece(piece.id)).rejects.toThrow()
  })
})

describe('the member limit', () => {
  /** The demo user's piece with its link on; the demo user is the admin, so the Unlimited plan's numbers set the member limit. */
  async function limited(fakes: Fakes, perPiece: number, perPart: number) {
    const piece = await ownedPiece(fakes)
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: perPiece, members_per_part: perPart })
    const { token } = await shareLinkOn(fakes.data, piece.id)
    return { piece, token }
  }
  async function joinAs(fakes: Fakes, userId: string, token: string) {
    signInAs(fakes.store, userId)
    return fakes.data.joinPiece(token)
  }

  it('the owner\'s plan gives the defaults: 30 for one part', async () => {
    const fakes = createFakes()
    const piece = await ownedPiece(fakes)
    expect(await fakes.data.getMemberLimit(piece.id)).toEqual({ limit: 30, count: 0 })
  })

  it('a full piece says full to someone new; a member and the owner get their usual answers', async () => {
    const fakes = createFakes()
    const { piece, token } = await limited(fakes, 1, 0)
    expect(await joinAs(fakes, OTHER_USER.id, token)).toEqual({ pieceId: piece.id, status: 'joined' })

    expect(await joinAs(fakes, THIRD_USER.id, token)).toEqual({ pieceId: null, status: 'full' })
    expect(await fakes.data.listPieces()).toEqual([])
    expect(await joinAs(fakes, OTHER_USER.id, token)).toEqual({ pieceId: piece.id, status: 'already_member' })
    expect(await joinAs(fakes, DEMO_USER.id, token)).toEqual({ pieceId: piece.id, status: 'owner' })
    expect(await fakes.data.getMemberLimit(piece.id)).toEqual({ limit: 1, count: 1 })
  })

  it('says link_off before full', async () => {
    const fakes = createFakes()
    const { piece, token } = await limited(fakes, 1, 0)
    await joinAs(fakes, OTHER_USER.id, token)
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.data.setShareEnabled(piece.id, false)
    expect((await joinAs(fakes, THIRD_USER.id, token)).status).toBe('link_off')
  })

  it('a lowered limit puts the newest joiner on hold: they read nothing and see the piece as held; the owner sees who and the count', async () => {
    const fakes = createFakes()
    const { piece, token } = await limited(fakes, 2, 0)
    await joinAs(fakes, OTHER_USER.id, token)
    await joinAs(fakes, THIRD_USER.id, token)
    signInAs(fakes.store, DEMO_USER.id)

    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 })

    expect(await fakes.data.getMemberLimit(piece.id)).toEqual({ limit: 1, count: 2 })
    expect((await fakes.data.listMembers(piece.id)).map((member) => [member.userId, member.onHold])).toEqual([
      [THIRD_USER.id, true],
      [OTHER_USER.id, false],
    ])
    signInAs(fakes.store, THIRD_USER.id)
    expect(await fakes.data.listPieces()).toEqual([])
    expect(await fakes.data.getPiece(piece.id)).toBeNull()
    expect(await fakes.data.getPieceMap(piece.id)).toBeNull()
    await expect(fakes.data.setCountInBars(piece.id, 2)).rejects.toThrow()
    const [held] = await fakes.data.listHeldPieces()
    expect(held).toMatchObject({ id: piece.id, title: 'Etude', ownerName: DEMO_USER.name })
    expect(held?.joinedAt).toBe(fakes.store.members.get(piece.id)?.get(THIRD_USER.id))
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.listPieces()).map((summary) => summary.id)).toEqual([piece.id])
    expect(await fakes.data.listHeldPieces()).toEqual([])
  })

  it('room comes back when an older member is removed, or when the limit rises', async () => {
    const fakes = createFakes()
    const { piece, token } = await limited(fakes, 2, 0)
    await joinAs(fakes, OTHER_USER.id, token)
    await joinAs(fakes, THIRD_USER.id, token)
    signInAs(fakes.store, DEMO_USER.id)
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 })

    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 2, members_per_part: 0 })
    signInAs(fakes.store, THIRD_USER.id)
    expect(await fakes.data.getPiece(piece.id)).not.toBeNull()

    signInAs(fakes.store, DEMO_USER.id)
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 })
    await fakes.data.removeMember(piece.id, OTHER_USER.id)
    signInAs(fakes.store, THIRD_USER.id)
    expect(await fakes.data.getPiece(piece.id)).not.toBeNull()
    expect(await fakes.data.listHeldPieces()).toEqual([])
  })

  it('deleting a part lowers the limit, and the newest joiner over it goes on hold', async () => {
    const fakes = createFakes()
    const { piece, token } = await limited(fakes, 1, 1)
    const [added] = await fakes.data.storeParts(piece.id, [{ file: file('b.pdf'), name: 'B' }])
    await joinAs(fakes, OTHER_USER.id, token)
    await joinAs(fakes, THIRD_USER.id, token)
    signInAs(fakes.store, DEMO_USER.id)
    expect(await fakes.data.getMemberLimit(piece.id)).toEqual({ limit: 2, count: 2 })

    await fakes.data.deletePart(piece.id, added!.id)

    expect(await fakes.data.getMemberLimit(piece.id)).toEqual({ limit: 1, count: 2 })
    signInAs(fakes.store, THIRD_USER.id)
    expect(await fakes.data.getPiece(piece.id)).toBeNull()
  })

  it('a held member can leave the piece', async () => {
    const fakes = createFakes()
    const { piece, token } = await limited(fakes, 2, 0)
    await joinAs(fakes, OTHER_USER.id, token)
    await joinAs(fakes, THIRD_USER.id, token)
    signInAs(fakes.store, DEMO_USER.id)
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 })
    signInAs(fakes.store, THIRD_USER.id)

    await fakes.data.leavePiece(piece.id)

    expect(await fakes.data.listHeldPieces()).toEqual([])
    signInAs(fakes.store, DEMO_USER.id)
    expect(await fakes.data.getMemberLimit(piece.id)).toEqual({ limit: 1, count: 1 })
  })

  it('getMemberLimit is the owner\'s alone', async () => {
    const fakes = createFakes()
    const { piece } = await joined(fakes)
    await expect(fakes.data.getMemberLimit(piece.id)).rejects.toThrow()
  })
})
