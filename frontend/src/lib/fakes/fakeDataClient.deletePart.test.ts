import { createFakes, type Fakes } from '@/lib/fakes'

const CLARK = 'piece-clark-county'

function demo(): Fakes {
  return createFakes({ seed: 'demo' })
}

describe('the fake data client: deletePart', () => {
  it('removes the part, its pages and its bar boxes, and keeps the others in order', async () => {
    const { data, store } = demo()
    const before = (await data.getPiece(CLARK))!.parts
    const gone = before[1]

    await data.deletePart(CLARK, gone.id)

    const detail = (await data.getPiece(CLARK))!
    expect(detail.parts.map((part) => part.id)).toEqual([before[0].id, before[2].id])
    expect(detail.parts.map((part) => part.position)).toEqual([0, 1])
    expect(store.pageImages.has(gone.id)).toBe(false)
    const map = (await data.getPieceMap(CLARK))!
    expect(map.pages.map((layer) => layer.partId)).toEqual([before[0].id, before[2].id])
    expect(store.maps.get(CLARK)?.pages.has(gone.id)).toBe(false)
  })

  it('takes the rests of the deleted part with it and leaves the rests of the others', async () => {
    const { data } = demo()
    const [clarinet, trumpet] = (await data.getPiece(CLARK))!.parts

    await data.deletePart(CLARK, clarinet.id)

    const map = (await data.getPieceMap(CLARK))!
    expect(map.pages.find((layer) => layer.partId === clarinet.id)).toBeUndefined()
    expect(map.pages.find((layer) => layer.partId === trumpet.id)?.rests).toEqual([33, 34, 35, 36])
    expect(map.timing.marks.map((mark) => mark.kind)).toEqual(['rit', 'rit', 'fermata'])
  })

  it('leaves the recording and the shared timing as they were', async () => {
    const { data } = demo()
    const before = (await data.getPieceMap(CLARK))!
    const first = (await data.getPiece(CLARK))!.parts[0]

    await data.deletePart(CLARK, first.id)

    const after = (await data.getPieceMap(CLARK))!
    expect(after.timing).toEqual(before.timing)
    expect(after.piece.recording).toEqual(before.piece.recording)
  })

  it('forgets the part the piece remembered as last opened', async () => {
    const { data } = demo()
    const [first] = (await data.getPiece(CLARK))!.parts
    await data.setLastPart(CLARK, first.id)

    await data.deletePart(CLARK, first.id)

    expect((await data.getPiece(CLARK))!.piece.lastPartId).toBeNull()
  })

  it('refuses the last part', async () => {
    const { data } = demo()
    const parts = (await data.getPiece(CLARK))!.parts
    await data.deletePart(CLARK, parts[0].id)
    await data.deletePart(CLARK, parts[1].id)

    await expect(data.deletePart(CLARK, parts[2].id)).rejects.toThrow('at least one part')
    expect((await data.getPiece(CLARK))!.parts).toHaveLength(1)
  })

  it('refuses a part that is not in the piece, and a piece that is not the user’s', async () => {
    const { data } = demo()

    await expect(data.deletePart(CLARK, 'part-nope')).rejects.toThrow('part not found')
    await expect(data.deletePart('piece-nope', 'part-nope')).rejects.toThrow('piece not found')
  })

  it('needs a signed-in user', async () => {
    const { data } = createFakes({ seed: 'demo' })
    await data.signOut()

    await expect(data.deletePart(CLARK, 'x')).rejects.toThrow('not signed in')
  })
})
