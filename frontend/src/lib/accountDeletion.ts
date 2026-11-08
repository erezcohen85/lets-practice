import { type DataClient } from '@/lib/dataClient'

/**
 * Which step of deleting an account did not happen. 'busy': a piece is still being prepared, nothing was deleted. 'check':
 * the pieces could not be listed, nothing was deleted. 'pieces': deleting the pieces failed part-way (some may be gone). 'files':
 * the pieces are gone, but the PDFs staged for a split could not be listed. 'account': the pieces and files are gone, the account is
 * not. After any of them the account is still there and a new attempt is safe.
 */
export type AccountDeletionStep = 'busy' | 'check' | 'pieces' | 'files' | 'account'

export class AccountDeletionError extends Error {
  readonly step: AccountDeletionStep
  constructor(step: AccountDeletionStep, options?: ErrorOptions) {
    super(`deleting the account failed at: ${step}`, options)
    this.name = 'AccountDeletionError'
    this.step = step
  }
}

/**
 * Deletes the signed-in user's account for good (Decision 2026-11-05). The order is the point: Storage files can only be
 * removed through the Storage API, from the browser, so every piece the user owns goes first (deletePiece removes its rows
 * and its files), and only then does the database function delete the account, which refuses while a piece is left. Pieces
 * the user only joined are not touched; the PDFs staged for a split or a suggested name (deleteStagedFiles) go after the pieces; their membership goes with the account. Every owned piece is checked for a running
 * job before the first delete, because deletePiece refuses a piece that is still being prepared and would otherwise fail
 * with half the pieces gone. Rejects with an AccountDeletionError. Does not sign out: the caller does.
 */
export async function deleteAccountWithPieces(data: DataClient): Promise<void> {
  let owned
  try {
    owned = (await data.listPieces()).filter((piece) => piece.role === 'owner')
  } catch (error) {
    throw new AccountDeletionError('check', { cause: error })
  }
  if (owned.some((piece) => piece.job?.status === 'queued' || piece.job?.status === 'running')) throw new AccountDeletionError('busy')
  try {
    for (const piece of owned) await data.deletePiece(piece.id)
  } catch (error) {
    throw new AccountDeletionError('pieces', { cause: error })
  }
  try {
    // The staged PDFs sit in the user's own folder, outside every piece: nothing else would ever remove them.
    await data.deleteStagedFiles()
  } catch (error) {
    throw new AccountDeletionError('files', { cause: error })
  }
  try {
    await data.deleteAccount()
  } catch (error) {
    throw new AccountDeletionError('account', { cause: error })
  }
}
