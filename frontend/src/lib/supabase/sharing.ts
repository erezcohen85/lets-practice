import { normalizePracticeMemory } from '@/domain/practice'
import { type DataClient, type HeldPiece, type JoinResult, type JoinStatus, type PieceMember, type ShareLink, type User } from '@/lib/dataClient'
import { fail, isUuid, type SupabasePort } from '@/lib/supabase/port'

/** Sharing and each user's own practice memory: thin calls over the functions of migrations 0007, 0013 and 0014, and RLS. */
export function createSharing(port: SupabasePort, requireUser: () => Promise<User>) {
  async function call<T>(name: string, args?: Record<string, unknown>): Promise<T | null> {
    const { data, error } = await port.rpc<T>(name, args)
    fail(error)
    return data
  }

  async function share(pieceId: string): Promise<ShareLink> {
    const rows = await call<Array<{ token: string; enabled: boolean; rights_confirmed_at: string | null }>>('create_or_get_share', { target_piece: pieceId })
    const row = rows?.[0]
    if (row === undefined) throw new Error('share not found')
    return { token: row.token, enabled: row.enabled, rightsConfirmedAt: row.rights_confirmed_at }
  }

  async function remember(pieceId: string, values: Record<string, unknown>): Promise<void> {
    const user = await requireUser()
    const { error } = await port.from('piece_practice').upsert({ user_id: user.id, piece_id: pieceId, updated_at: new Date().toISOString(), ...values }, { onConflict: 'user_id,piece_id' })
    fail(error)
  }

  return {
    async getShare(pieceId) {
      await requireUser()
      return share(pieceId)
    },
    async setShareEnabled(pieceId, on, rightsConfirmed = false) {
      await requireUser()
      await call('set_share_enabled', { target_piece: pieceId, is_on: on, rights_confirmed: rightsConfirmed })
    },
    async resetShareLink(pieceId) {
      await requireUser()
      // reset_share_token returns only the token; the switch stays as it was, so read both back.
      await call('reset_share_token', { target_piece: pieceId })
      return share(pieceId)
    },
    async listMembers(pieceId) {
      await requireUser()
      const rows = await call<Array<{ user_id: string; display_name: string | null; email: string; joined_at: string; on_hold: boolean }>>('list_members', { target_piece: pieceId })
      return (rows ?? []).map((row): PieceMember => ({ userId: row.user_id, displayName: row.display_name, email: row.email, joinedAt: row.joined_at, onHold: row.on_hold }))
    },
    async getMemberLimit(pieceId) {
      await requireUser()
      const rows = await call<Array<{ member_limit: number; member_count: number }>>('share_member_limit', { target_piece: pieceId })
      const row = rows?.[0]
      if (row === undefined) throw new Error('piece not found')
      return { limit: row.member_limit, count: row.member_count }
    },
    async removeMember(pieceId, userId) {
      const user = await requireUser()
      // RLS lets a delete that matches nobody through without an error, so the owner is checked first, as the fake does.
      const owned = isUuid(pieceId) ? await port.from('pieces').select<{ id: string }>('id').eq('id', pieceId).eq('owner_id', user.id).maybeSingle() : { data: null, error: null }
      fail(owned.error)
      if (owned.data === null) throw new Error('not your piece')
      const { error } = await port.from('piece_members').delete().eq('piece_id', pieceId).eq('user_id', userId)
      fail(error)
    },
    async joinPiece(token) {
      await requireUser()
      const rows = await call<Array<{ piece_id: string | null; status: JoinStatus }>>('join_piece', { share_token: token })
      const row = rows?.[0]
      if (row === undefined) throw new Error('join failed')
      const result: JoinResult = { pieceId: row.piece_id, status: row.status }
      return result
    },
    async leavePiece(pieceId) {
      await requireUser()
      await call('leave_piece', { target_piece: pieceId })
    },
    async listHeldPieces() {
      await requireUser()
      const rows = await call<Array<{ piece_id: string; title: string; owner_name: string | null; joined_at: string }>>('my_held_pieces')
      return (rows ?? []).map((row): HeldPiece => ({ id: row.piece_id, title: row.title, ownerName: row.owner_name, joinedAt: row.joined_at }))
    },
    setCountInBars: (id, bars) => remember(id, { count_in_bars: bars }),
    async setLastPart(pieceId, partId) {
      await requireUser()
      const known = isUuid(partId) ? await port.from('score_files').select<{ id: string }>('id').eq('id', partId).eq('piece_id', pieceId).maybeSingle() : { data: null, error: null }
      fail(known.error)
      if (known.data === null) throw new Error('part not found')
      await remember(pieceId, { last_part_id: partId })
    },
    savePracticeMemory: (pieceId, memory) => remember(pieceId, { practice: normalizePracticeMemory(memory) }),
  } satisfies Pick<DataClient, 'getShare' | 'setShareEnabled' | 'resetShareLink' | 'listMembers' | 'getMemberLimit' | 'removeMember' | 'joinPiece' | 'leavePiece' | 'listHeldPieces' | 'setCountInBars' | 'setLastPart' | 'savePracticeMemory'>
}
