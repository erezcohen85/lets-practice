// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_PRACTICE_MEMORY } from '@/domain/types'
import { createSharing } from '@/lib/supabase/sharing'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-00000000000a'
const MEMBER = '00000000-0000-4000-8000-00000000000b'
const OTHER = '00000000-0000-4000-8000-00000000000c'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PART = '00000000-0000-4000-8000-0000000000f2'

let db: PGlite
let sharing: ReturnType<typeof createSharing>
let currentUser = OWNER

beforeAll(async () => {
  db = await databaseWithMigrations()
  const sb = pgliteSupabase(db)
  sharing = createSharing(sb.port, async () => {
    sb.signIn(currentUser)
    return { id: currentUser, email: 'x@example.com', name: 'X' }
  })
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values ('${OWNER}', 'o@example.com', now()), ('${MEMBER}', 'm@example.com', now()), ('${OTHER}', 'c@example.com', now());
    insert into public.admins (user_id) values ('${OWNER}');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude');
    insert into public.score_files (id, piece_id, storage_path, sha256, name) values ('${PART}', '${PIECE}', 'x', 'x', 'Part');
  `)
})

describe('the share link', () => {
  it('makes a link once, off; turning it on needs the rights confirmation, once; a reset keeps the switch and the time', async () => {
    currentUser = OWNER
    const first = await sharing.getShare(PIECE)
    expect(first).toMatchObject({ enabled: false, rightsConfirmedAt: null })
    expect(first.token).toHaveLength(24)
    expect(await sharing.getShare(PIECE)).toEqual(first)

    await expect(sharing.setShareEnabled(PIECE, true)).rejects.toThrow(/confirm the rights/)
    expect((await sharing.getShare(PIECE)).enabled).toBe(false)
    await sharing.setShareEnabled(PIECE, true, true)
    const on = await sharing.getShare(PIECE)
    expect(on.enabled).toBe(true)
    expect(on.rightsConfirmedAt).not.toBeNull()

    await sharing.setShareEnabled(PIECE, false)
    const reset = await sharing.resetShareLink(PIECE)
    expect(reset.token).not.toBe(first.token)
    expect(reset).toMatchObject({ enabled: false, rightsConfirmedAt: on.rightsConfirmedAt })
    await sharing.setShareEnabled(PIECE, true) // confirmed once for the piece: no second confirmation
    expect((await sharing.getShare(PIECE)).enabled).toBe(true)
  })

  it('refuses anyone but the owner', async () => {
    currentUser = MEMBER
    await expect(sharing.getShare(PIECE)).rejects.toThrow()
    await expect(sharing.resetShareLink(PIECE)).rejects.toThrow()
  })
})

describe('joining and leaving', () => {
  it('walks the join statuses', async () => {
    currentUser = OWNER
    const { token } = await sharing.getShare(PIECE)
    expect(await sharing.joinPiece(token)).toEqual({ pieceId: PIECE, status: 'owner' })
    currentUser = MEMBER
    expect(await sharing.joinPiece(token)).toEqual({ pieceId: PIECE, status: 'joined' })
    expect(await sharing.joinPiece(token)).toEqual({ pieceId: PIECE, status: 'already_member' })
    expect(await sharing.joinPiece('nothing')).toEqual({ pieceId: null, status: 'not_found' })
  })

  it('lists members for the owner in the app shape, and [] for anyone else', async () => {
    currentUser = OWNER
    expect((await sharing.listMembers(PIECE))[0]).toMatchObject({ userId: MEMBER, email: 'm@example.com', displayName: null })
    currentUser = MEMBER
    expect(await sharing.listMembers(PIECE)).toEqual([])
  })

  it('refuses a removal by anyone but the owner and leaves the member in place', async () => {
    currentUser = OWNER
    const { token } = await sharing.getShare(PIECE)
    currentUser = MEMBER
    await sharing.joinPiece(token)
    await expect(sharing.removeMember(PIECE, MEMBER)).rejects.toThrow('not your piece')
    currentUser = OTHER
    await expect(sharing.removeMember(PIECE, MEMBER)).rejects.toThrow('not your piece')
    await expect(sharing.removeMember('00000000-0000-4000-8000-0000000000aa', MEMBER)).rejects.toThrow('not your piece')
    currentUser = OWNER
    expect((await sharing.listMembers(PIECE)).map((m) => m.userId)).toEqual([MEMBER])
    await sharing.removeMember(PIECE, MEMBER)
  })

  it('lets the owner remove a member and a member leave', async () => {
    currentUser = OWNER
    const { token } = await sharing.getShare(PIECE)
    await sharing.removeMember(PIECE, MEMBER)
    expect(await sharing.listMembers(PIECE)).toEqual([])
    currentUser = MEMBER
    await sharing.joinPiece(token)
    await sharing.leavePiece(PIECE)
    expect(await asUser(db, MEMBER, 'select 1 from public.piece_members')).toEqual([])
  })
})

describe('practice memory', () => {
  it('a member writes their own and the owner keeps theirs', async () => {
    currentUser = OWNER
    const { token } = await sharing.getShare(PIECE)
    await sharing.savePracticeMemory(PIECE, { ...DEFAULT_PRACTICE_MEMORY, speed: 1 })
    await sharing.setCountInBars(PIECE, 2)
    currentUser = MEMBER
    await sharing.joinPiece(token)
    await sharing.savePracticeMemory(PIECE, { ...DEFAULT_PRACTICE_MEMORY, speed: 0.5 })
    await sharing.setCountInBars(PIECE, 4)
    await sharing.setLastPart(PIECE, PART)
    const row = (id: string) => asUser<{ practice: { speed: number }; count_in_bars: number }>(db, id, 'select practice, count_in_bars from public.piece_practice where piece_id = $1 and user_id = $2', [PIECE, id])
    expect((await row(OWNER))[0]).toMatchObject({ count_in_bars: 2, practice: { speed: 1 } })
    expect((await row(MEMBER))[0]).toMatchObject({ count_in_bars: 4, practice: { speed: 0.5 } })
  })

  it('refuses someone who cannot read the piece, and a part of another piece', async () => {
    currentUser = OTHER
    await expect(sharing.setCountInBars(PIECE, 1)).rejects.toThrow()
    currentUser = MEMBER
    await expect(sharing.setLastPart(PIECE, '00000000-0000-4000-8000-0000000000aa')).rejects.toThrow('part not found')
  })
})

/** The member limit is the owner's plan's numbers (migration 0015); the owner here is the admin, on the Unlimited plan. Set as the admin hub's save would. */
async function setLimits(perPiece: number, perPart: number): Promise<void> {
  await db.query('update public.plans set members_per_piece = $1, members_per_part = $2 where id = $3', [perPiece, perPart, 'unlimited'])
}

describe('the member limit', () => {
  it('a full piece says full; a lowered limit puts the newest joiner on hold, and both sides see it', async () => {
    currentUser = OWNER
    const { token } = await sharing.getShare(PIECE)
    currentUser = MEMBER
    await sharing.joinPiece(token)
    currentUser = OWNER
    expect(await sharing.getMemberLimit(PIECE)).toEqual({ limit: 30, count: 1 }) // the owner's plan (the admin is on Unlimited): 30 per piece
    await setLimits(1, 0)
    expect(await sharing.getMemberLimit(PIECE)).toEqual({ limit: 1, count: 1 })

    currentUser = OTHER
    expect(await sharing.joinPiece(token)).toEqual({ pieceId: null, status: 'full' })

    currentUser = OWNER
    await setLimits(2, 0)
    currentUser = OTHER
    expect((await sharing.joinPiece(token)).status).toBe('joined')
    currentUser = OWNER
    await setLimits(1, 0)

    expect(await sharing.getMemberLimit(PIECE)).toEqual({ limit: 1, count: 2 })
    expect((await sharing.listMembers(PIECE)).map((member) => [member.userId, member.onHold])).toEqual([
      [OTHER, true],
      [MEMBER, false],
    ])
    currentUser = OTHER
    const held = await sharing.listHeldPieces()
    expect(held).toMatchObject([{ id: PIECE, title: 'Etude', ownerName: null }])
    expect(Number.isNaN(Date.parse(held[0]!.joinedAt))).toBe(false)
    currentUser = MEMBER
    expect(await sharing.listHeldPieces()).toEqual([])
  })

  it('refuses the limit to anyone but the owner', async () => {
    currentUser = MEMBER
    await expect(sharing.getMemberLimit(PIECE)).rejects.toThrow()
  })
})
