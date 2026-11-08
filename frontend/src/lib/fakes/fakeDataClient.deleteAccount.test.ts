import { describe, expect, it } from 'vitest'
import { createFakes } from '@/lib/fakes'
import { DEMO_USER, setPlan, OTHER_USER, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { shareLinkOn } from '@/test/shareLink'

function pdf(name: string) {
  return new File(['x'], name, { type: 'application/pdf' })
}
const newPiece = (title: string) => ({ title, recording: { kind: 'file' as const, file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [{ file: pdf('a.pdf'), name: 'A' }] })

/** The demo user (the admin) owns a shared piece; OTHER_USER joined it and is signed in. */
async function sharedPieceJoinedBy(...members: string[]) {
  const fakes = createFakes()
  signInAs(fakes.store, DEMO_USER.id)
  const piece = await fakes.data.createPiece(newPiece('Etude'))
  const { token } = await shareLinkOn(fakes.data, piece.id)
  for (const member of members) {
    signInAs(fakes.store, member)
    await fakes.data.joinPiece(token)
  }
  return { fakes, piece }
}

// The same behaviour as the migration's delete_account() (src/test/migration0011.test.ts) and the real client's deleteAccount.
describe('FakeDataClient.deleteAccount', () => {
  it('rejects while signed out', async () => {
    await expect(createFakes().data.deleteAccount()).rejects.toThrow('not signed in')
  })

  it('deletes the user, their profile, their membership and their memory of a shared piece', async () => {
    const { fakes, piece } = await sharedPieceJoinedBy(OTHER_USER.id)
    await fakes.data.savePracticeMemory(piece.id, { ...(await fakes.data.getPiece(piece.id))!.piece.practice, speed: 0.5 })

    await fakes.data.deleteAccount()

    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
    expect(fakes.store.profiles.has(OTHER_USER.id)).toBe(false)
    expect(fakes.store.members.get(piece.id)?.has(OTHER_USER.id)).toBe(false)
    expect([...fakes.store.memberMemory.keys()].filter((key) => key.startsWith(`${OTHER_USER.id}:`))).toEqual([])
  })

  it('leaves the shared piece, its owner and the other members as they were', async () => {
    const { fakes, piece } = await sharedPieceJoinedBy(THIRD_USER.id, OTHER_USER.id)

    await fakes.data.deleteAccount()

    expect(fakes.store.pieces.has(piece.id)).toBe(true)
    expect(fakes.store.users.has(DEMO_USER.id)).toBe(true)
    expect(fakes.store.members.get(piece.id)?.has(THIRD_USER.id)).toBe(true)
  })

  it('leaves the session to signOut, which still works once the account is gone, as the real one does', async () => {
    const { fakes } = await sharedPieceJoinedBy(OTHER_USER.id)

    await fakes.data.deleteAccount()
    await fakes.data.signOut()

    expect(await fakes.data.getUser()).toBeNull()
  })

  it('rejects a user who still owns a piece, and changes nothing', async () => {
    const fakes = createFakes({ signedInAs: OTHER_USER.id })
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    await fakes.data.createPiece(newPiece('Mine'))

    await expect(fakes.data.deleteAccount()).rejects.toThrow('delete your pieces first')

    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
  })

  it('works once the user has deleted their pieces', async () => {
    const fakes = createFakes({ signedInAs: OTHER_USER.id })
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const piece = await fakes.data.createPiece(newPiece('Mine'))
    await fakes.data.deletePiece(piece.id)

    await fakes.data.deleteAccount()

    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
  })

  it('rejects the admin', async () => {
    const fakes = createFakes({ signedIn: true })

    await expect(fakes.data.deleteAccount()).rejects.toThrow('the admin cannot delete their account')

    expect(fakes.store.users.has(DEMO_USER.id)).toBe(true)
  })
})
