import { type DataClient, type ShareLink } from '@/lib/dataClient'

/**
 * The piece's share link, turned on the way an owner does it since the music rule (Decision 2026-11-06): a new link starts
 * off, and the first time it is turned on the owner confirms the rights. For tests that need a link people can join by.
 */
export async function shareLinkOn(data: Pick<DataClient, 'getShare' | 'setShareEnabled'>, pieceId: string): Promise<ShareLink> {
  await data.getShare(pieceId)
  await data.setShareEnabled(pieceId, true, true)
  return data.getShare(pieceId)
}
