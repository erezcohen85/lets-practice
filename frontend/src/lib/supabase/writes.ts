import { MAX_PART_NAME, MAX_PIECE_TITLE, MAX_RECORDING_NAME, requireName } from '@/domain/names'
import { type DataClient, type User } from '@/lib/dataClient'
import { SentenceError } from '@/lib/processorClient'
import { fail, listAllFiles, removeFiles, type SupabasePort } from '@/lib/supabase/port'
import { pageToArgs, timingToArgs } from '@/lib/supabase/rows'
import { strings } from '@/strings'

/** The owner's writes. RLS is what stops anyone else; a write it stops changes no row and gives no error, so those are checked. */
export function createWrites(port: SupabasePort, requireUser: () => Promise<User>) {
  /** Updates the rows where `column` is `id` (and every `also` filter holds); rejects when none changed, which is what RLS does to a non-owner. */
  async function update(table: string, id: string, values: Record<string, unknown>, what: string, column = 'id', also: Record<string, string> = {}): Promise<void> {
    await requireUser()
    let query = port.from(table).update(values).eq(column, id)
    for (const [name, value] of Object.entries(also)) query = query.eq(name, value)
    const { data, error } = await query.select('id')
    fail(error)
    if ((data ?? []).length === 0) throw new Error(`${what} not found`)
  }

  /** Deletes the rows where `id` matches; rejects when none went (RLS, or already gone). */
  async function remove(table: string, id: string, what: string): Promise<void> {
    const { data, error } = await port.from(table).delete().eq('id', id).select('id')
    fail(error)
    if ((data ?? []).length === 0) throw new Error(`${what} not found`)
  }

  async function requireIdle(pieceId: string): Promise<void> {
    const { data, error } = await port.from('jobs').select<{ id: string }>('id').eq('piece_id', pieceId).in('status', ['queued', 'running'])
    fail(error)
    if ((data ?? []).length > 0) throw new SentenceError(strings.realServices.stillPreparing)
  }

  async function requireOwner(pieceId: string, userId: string): Promise<string> {
    const { data, error } = await port.from('pieces').select<{ owner_id: string }>('owner_id').eq('id', pieceId).maybeSingle()
    fail(error)
    if (data?.owner_id !== userId) throw new Error('piece not found')
    return data.owner_id
  }

  return {
    async saveTiming(pieceId, timing) {
      await requireUser()
      fail((await port.rpc('save_timing', timingToArgs(pieceId, timing))).error)
    },

    async savePageLayer(pieceId, page) {
      await requireUser()
      const { data, error } = await port.from('score_files').select<{ id: string }>('id').eq('id', page.partId).eq('piece_id', pieceId).maybeSingle()
      fail(error)
      if (data === null) throw new Error('part not found')
      fail((await port.rpc('save_page_layer', pageToArgs(page))).error)
    },

    saveStructureSetAt: async (pieceId, at) => update('pieces', pieceId, { structure_set_at: at }, 'piece'),
    renamePiece: async (id, title) => update('pieces', id, { title: requireName(title, MAX_PIECE_TITLE) }, 'piece'),
    renamePart: async (pieceId, partId, name) => update('score_files', partId, { name: requireName(name, MAX_PART_NAME), name_source: 'user' }, 'part', 'id', { piece_id: pieceId }),
    renameRecording: async (pieceId, name) => update('audio_sources', pieceId, { name: requireName(name, MAX_RECORDING_NAME) }, 'recording', 'piece_id'),

    async deletePart(pieceId, partId) {
      const user = await requireUser()
      const owner = await requireOwner(pieceId, user.id)
      await requireIdle(pieceId)
      const { data, error } = await port.from('score_files').select<{ id: string; storage_path: string }>('id, storage_path').eq('piece_id', pieceId).order('position')
      fail(error)
      const parts = data ?? []
      const part = parts.find((row) => row.id === partId)
      if (part === undefined) throw new Error('part not found')
      if (parts.length === 1) throw new Error('a piece needs at least one part')
      // What is really in the part's folder, not what the rows name: a part the processor never finished has pictures and no rows. Listed before anything is deleted, so a failed listing changes nothing.
      const paths = [...new Set([part.storage_path, ...(await listAllFiles(port.storage.from('pieces'), `${owner}/${pieceId}/${partId}`))])]
      await remove('score_files', partId, 'part')
      // From here the part is gone: the rest is attempted and cannot make the delete fail.
      let unnumbered = 0
      for (const [position, row] of parts.filter((other) => other.id !== partId).entries()) {
        try {
          fail((await port.from('score_files').update({ position }).eq('id', row.id)).error)
        } catch {
          unnumbered += 1
        }
      }
      if (unnumbered > 0) console.warn(`A part delete left ${unnumbered} parts with their old positions.`)
      await removeFiles(port.storage.from('pieces'), paths, 'A delete')
    },

    /** Only the database function: the browser deletes the pieces (and their files) first, lib/accountDeletion.ts. The function refuses an owner of a piece and the admin. */
    async deleteAccount() {
      await requireUser()
      fail((await port.rpc('delete_account')).error)
    },

    /** Everything under `{user}/staging`: listed first, so a failed listing changes nothing; a file that will not go is a warning, like a piece's. */
    async deleteStagedFiles() {
      const user = await requireUser()
      const bucket = port.storage.from('pieces')
      await removeFiles(bucket, await listAllFiles(bucket, `${user.id}/staging`), 'A delete')
    },

    async deletePiece(id) {
      const user = await requireUser()
      const owner = await requireOwner(id, user.id)
      await requireIdle(id)
      const [parts, audio] = await Promise.all([
        port.from('score_files').select<{ storage_path: string }>('storage_path').eq('piece_id', id),
        port.from('audio_sources').select<{ kind: string; url_or_path: string; stored_path: string | null }>('kind, url_or_path, stored_path').eq('piece_id', id),
      ])
      fail(parts.error)
      fail(audio.error)
      // Everything under the piece's folder, as Storage has it; the rows add what they name, which sits there too. Listed before the row goes, so a failed listing changes nothing.
      const paths = new Set([
        ...(await listAllFiles(port.storage.from('pieces'), `${owner}/${id}`)),
        ...(parts.data ?? []).map((row) => row.storage_path),
        ...(audio.data ?? []).flatMap((row) => [...(row.kind === 'file' ? [row.url_or_path] : []), ...(row.stored_path === null ? [] : [row.stored_path])]),
      ])
      await remove('pieces', id, 'piece')
      await removeFiles(port.storage.from('pieces'), [...paths], 'A delete')
    },
  } satisfies Pick<DataClient, 'saveTiming' | 'savePageLayer' | 'saveStructureSetAt' | 'renamePiece' | 'renamePart' | 'renameRecording' | 'deletePart' | 'deletePiece' | 'deleteAccount' | 'deleteStagedFiles'>
}
