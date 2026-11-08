import { type SplitRange } from '@/domain/splitEdits'
import { type User } from '@/lib/dataClient'
import { fail, type SupabasePort } from '@/lib/supabase/port'
import { type ProcessorHttp } from '@/lib/supabase/processorHttp'

/** A kept part as the processor's cut route takes it: the id of the row the browser is about to add, then the range. */
export type CutPart = SplitRange & { id: string }
/** What the processor wrote for a part: its id and the SHA-256 of its PDF. */
export interface CutResult { id: string; sha256: string }
export type CutSplit = (pieceId: string, splitId: string, parts: CutPart[]) => Promise<CutResult[]>

/**
 * Stages a PDF for the processor: it goes into the user's own folder of the pieces bucket, `{user}/staging/{id}.pdf`, with
 * the user's own login (the bucket's policy lets a user write only under their folder). The processor reads it by that id and
 * the user id of the token, so it is never told a path. `check` refuses a file that is not a PDF or is too large, before it moves.
 */
export function createStaging(port: SupabasePort, requireUser: () => Promise<User>, check: (file: File) => void) {
  return {
    async stage(file: File): Promise<string> {
      const user = await requireUser()
      check(file)
      const id = crypto.randomUUID()
      // A slice with the type set is a nameless Blob with the true type (storage-js sends a File as it is, with the browser's guess).
      const body = file.slice(0, file.size, 'application/pdf')
      fail((await port.storage.from('pieces').upload(`${user.id}/staging/${id}.pdf`, body, { contentType: 'application/pdf' })).error)
      return id
    },
  }
}

/** The cut route: the processor writes one PDF per kept part into the piece's folder and says what it wrote; the browser adds the rows. */
export function createCutSplit(http: ProcessorHttp): CutSplit {
  return async (pieceId, splitId, parts) => {
    const response = await http.post(`/splits/${splitId}/cut`, { piece_id: pieceId, parts })
    if (!response.ok) throw await http.splitRefusal(response)
    return ((await response.json()) as { parts: CutResult[] }).parts
  }
}
