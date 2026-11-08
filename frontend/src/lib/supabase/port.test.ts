import { listAllFiles, type BucketPort } from '@/lib/supabase/port'

type Entry = { name: string; id: string | null }

/** A bucket that lists `tree[folder]` in pages of at most `serves` entries, whatever limit is asked (a server may cap a page below the limit). */
function bucketOf(tree: Record<string, Entry[]>, serves: number) {
  const calls: Array<[string, number]> = []
  const list: BucketPort['list'] = async (folder, { limit, offset }) => {
    calls.push([folder, offset])
    return { data: (tree[folder] ?? []).slice(offset, offset + Math.min(limit, serves)), error: null }
  }
  return { bucket: { list } as unknown as BucketPort, calls }
}

const file = (name: string): Entry => ({ name, id: `id-${name}` })

describe('listAllFiles', () => {
  it('goes on past a page that is shorter than the limit, and stops at an empty one', async () => {
    const names = Array.from({ length: 7 }, (_, index) => `f${index}.webp`)
    const { bucket, calls } = bucketOf({ root: names.map(file) }, 3)

    const all = await listAllFiles(bucket, 'root')

    expect(all).toEqual(names.map((name) => `root/${name}`))
    expect(calls.map(([, offset]) => offset)).toEqual([0, 3, 6, 7])
  })

  it('walks into an entry with no id as it does into one whose id is null', async () => {
    const { bucket } = bucketOf(
      {
        root: [file('a.json'), { name: 'null-folder', id: null }, { name: 'bare-folder' } as unknown as Entry],
        'root/null-folder': [file('b.json')],
        'root/bare-folder': [file('c.json')],
      },
      100,
    )

    expect((await listAllFiles(bucket, 'root')).sort()).toEqual(['root/a.json', 'root/bare-folder/c.json', 'root/null-folder/b.json'])
  })

  it('rejects with the message when a list fails', async () => {
    const bucket = { list: async () => ({ data: null, error: { message: 'storage is down' } }) } as unknown as BucketPort

    await expect(listAllFiles(bucket, 'root')).rejects.toThrow('storage is down')
  })
})
