import { describe, expect, it, vi } from 'vitest'
import { AccountDeletionError, deleteAccountWithPieces } from '@/lib/accountDeletion'
import { type Job } from '@/domain/types'
import { type DataClient } from '@/lib/dataClient'
import { createFakes } from '@/lib/fakes'
import { DEMO_USER, setPlan, OTHER_USER, signInAs } from '@/lib/fakes/store'
import { shareLinkOn } from '@/test/shareLink'

const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
const newPiece = (title: string) => ({ title, recording: { kind: 'file' as const, file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [{ file: pdf, name: 'A' }] })

/** OTHER_USER, signed in, owns two pieces and has joined one of the demo user's. */
async function userWithTwoPieces() {
  const fakes = createFakes()
  signInAs(fakes.store, DEMO_USER.id)
  const shared = await fakes.data.createPiece(newPiece('Shared with me'))
  const { token } = await shareLinkOn(fakes.data, shared.id)
  setPlan(fakes.store, OTHER_USER.email, 'creator')
  signInAs(fakes.store, OTHER_USER.id)
  await fakes.data.joinPiece(token)
  const first = await fakes.data.createPiece(newPiece('First'))
  const second = await fakes.data.createPiece(newPiece('Second'))
  return { fakes, shared, first, second }
}

const busyJob = (pieceId: string, status: 'queued' | 'running'): Job => ({ id: 'job-busy', pieceId, kind: 'process-piece', status, progress: 0, error: null })

const failure = async (run: Promise<unknown>) => {
  const error = await run.then(() => null, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(AccountDeletionError)
  return error as AccountDeletionError
}

describe('deleteAccountWithPieces', () => {
  it('deletes every piece the user owns, then the account, in that order', async () => {
    const { fakes, first, second } = await userWithTwoPieces()
    const calls: string[] = []
    const data: DataClient = {
      ...fakes.data,
      deletePiece: async (id) => {
        calls.push(`piece ${id}`)
        await fakes.data.deletePiece(id)
      },
      deleteAccount: async () => {
        calls.push('account')
        await fakes.data.deleteAccount()
      },
    }

    await deleteAccountWithPieces(data)

    expect(calls.slice(0, 2).sort()).toEqual([`piece ${first.id}`, `piece ${second.id}`].sort())
    expect(calls.at(-1)).toBe('account')
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
    expect([...fakes.store.pieces.values()].filter((piece) => piece.ownerId === OTHER_USER.id)).toEqual([])
  })

  it('does not delete a piece the user only joined', async () => {
    const { fakes, shared } = await userWithTwoPieces()

    await deleteAccountWithPieces(fakes.data)

    expect(fakes.store.pieces.has(shared.id)).toBe(true)
    expect(fakes.store.members.get(shared.id)?.has(OTHER_USER.id)).toBe(false)
  })

  it('stops before deleting anything when one piece is still processing', async () => {
    const { fakes, second } = await userWithTwoPieces()
    fakes.store.jobs.set('job-busy', { job: busyJob(second.id, 'running'), stagesDone: 1 })
    const deletePiece = vi.spyOn(fakes.data, 'deletePiece')
    const deleteAccount = vi.spyOn(fakes.data, 'deleteAccount')

    const error = await failure(deleteAccountWithPieces(fakes.data))

    expect(error.step).toBe('busy')
    expect(deletePiece).not.toHaveBeenCalled()
    expect(deleteAccount).not.toHaveBeenCalled()
    expect([...fakes.store.pieces.values()].filter((piece) => piece.ownerId === OTHER_USER.id)).toHaveLength(2)
  })

  it('also stops for a queued job', async () => {
    const { fakes, first } = await userWithTwoPieces()
    fakes.store.jobs.set('job-busy', { job: busyJob(first.id, 'queued'), stagesDone: 0 })

    expect((await failure(deleteAccountWithPieces(fakes.data))).step).toBe('busy')
  })

  it('names the pieces step when a piece cannot be deleted, keeps the account, and can be run again', async () => {
    const { fakes } = await userWithTwoPieces()
    const real = fakes.data.deletePiece.bind(fakes.data)
    let calls = 0
    const data: DataClient = {
      ...fakes.data,
      deletePiece: async (id) => {
        calls += 1
        if (calls === 2) throw new Error('offline')
        await real(id)
      },
    }

    expect((await failure(deleteAccountWithPieces(data))).step).toBe('pieces')
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)

    await deleteAccountWithPieces(data)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
  })

  it('clears the staged PDFs after the pieces and before the account', async () => {
    const { fakes } = await userWithTwoPieces()
    fakes.store.splits.set('s1', { pageCount: 6, fullScore: false, fileName: 'Band.pdf' })
    const calls: string[] = []
    const data: DataClient = {
      ...fakes.data,
      deletePiece: async (id) => {
        calls.push('piece')
        await fakes.data.deletePiece(id)
      },
      deleteStagedFiles: async () => {
        calls.push('staged')
        await fakes.data.deleteStagedFiles()
      },
      deleteAccount: async () => {
        calls.push('account')
        await fakes.data.deleteAccount()
      },
    }

    await deleteAccountWithPieces(data)

    expect(calls).toEqual(['piece', 'piece', 'staged', 'account'])
    expect(fakes.store.splits.size).toBe(0)
  })

  it('names the files step when the staged PDFs cannot be listed, keeps the account, and can be run again', async () => {
    const { fakes } = await userWithTwoPieces()
    const real = fakes.data.deleteStagedFiles.bind(fakes.data)
    let calls = 0
    const data: DataClient = {
      ...fakes.data,
      deleteStagedFiles: async () => {
        calls += 1
        if (calls === 1) throw new Error('offline')
        await real()
      },
    }

    expect((await failure(deleteAccountWithPieces(data))).step).toBe('files')
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)

    await deleteAccountWithPieces(data)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
  })

  it('names the account step when the database function fails, with the pieces already gone', async () => {
    const { fakes } = await userWithTwoPieces()
    const data: DataClient = { ...fakes.data, deleteAccount: () => Promise.reject(new Error('offline')) }

    expect((await failure(deleteAccountWithPieces(data))).step).toBe('account')
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
    expect([...fakes.store.pieces.values()].filter((piece) => piece.ownerId === OTHER_USER.id)).toEqual([])
  })

  it('names the check step when the pieces cannot be listed, and deletes nothing', async () => {
    const { fakes } = await userWithTwoPieces()
    const data: DataClient = { ...fakes.data, listPieces: () => Promise.reject(new Error('offline')) }

    expect((await failure(deleteAccountWithPieces(data))).step).toBe('check')
    expect([...fakes.store.pieces.values()].filter((piece) => piece.ownerId === OTHER_USER.id)).toHaveLength(2)
  })
})
