/**
 * The small part of supabase-js the data client uses. Reads are flat (no embedded selects), so tests can run the same code
 * under real RLS on PGlite (src/test/pgliteSupabase.ts), and never touch the network.
 */
import { parseLimitError } from '@/domain/planLimits'
import { PlanLimitError } from '@/lib/processorClient'

export interface PortError { message: string; code?: string }
export interface PortResult<T> { data: T | null; error: PortError | null }

export interface SelectQuery<T> extends PromiseLike<PortResult<T[]>> {
  eq(column: string, value: string | number | boolean): SelectQuery<T>
  in(column: string, values: readonly string[]): SelectQuery<T>
  order(column: string, options?: { ascending: boolean }): SelectQuery<T>
  range(from: number, to: number): SelectQuery<T>
  limit(count: number): SelectQuery<T>
  maybeSingle(): PromiseLike<PortResult<T>>
}

export interface WriteQuery extends PromiseLike<PortResult<null>> {
  eq(column: string, value: string | number | boolean): WriteQuery
  /** The changed rows: an update or delete that RLS stops changes none and gives no error. */
  select(columns: string): PromiseLike<PortResult<Array<Record<string, unknown>>>>
}

export interface TablePort {
  select<T>(columns: string): SelectQuery<T>
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): WriteQuery
  update(values: Record<string, unknown>): WriteQuery
  upsert(values: Record<string, unknown>, options: { onConflict: string }): WriteQuery
  delete(): WriteQuery
}

export interface StoragePortError { message: string; status?: number; statusCode?: string }
export interface BucketPort {
  upload(path: string, body: Blob, options: { contentType: string; upsert?: boolean }): Promise<{ error: StoragePortError | null }>
  remove(paths: string[]): Promise<{ error: StoragePortError | null }>
  /** One level of a folder, by name: a file has an `id`, a folder has none. Storage cuts a list at `limit` (100 by default), so a caller pages. */
  list(folder: string, options: { limit: number; offset: number }): Promise<{ data: Array<{ name: string; id: string | null }> | null; error: StoragePortError | null }>
  download(path: string): Promise<{ data: Blob | null; error: StoragePortError | null }>
  createSignedUrls(paths: string[], expiresIn: number): Promise<{
    data: Array<{ path: string | null; signedUrl: string | null; error: string | null }> | null
    error: StoragePortError | null
  }>
}

export interface SupabasePort {
  from(table: string): TablePort
  rpc<T>(name: string, args?: Record<string, unknown>): PromiseLike<PortResult<T>>
  storage: { from(bucket: 'pieces'): BucketPort }
}

/**
 * Turns a failed call into an Error. A refusal by the user's plan (`plan_limit:<key>`, raised by the database functions of
 * migration 0015) becomes a PlanLimitError that names the limit; anything else keeps its message.
 */
export function fail(error: PortError | StoragePortError | null): void {
  if (error === null) return
  const limit = parseLimitError(error.message)
  if (limit !== null) throw new PlanLimitError(limit)
  throw new Error(error.message)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** PostgREST answers 400 to a malformed uuid. An address like /pieces/xyz must read as "not found", not as a failure. */
export function isUuid(text: string): boolean {
  return UUID.test(text)
}

const PAGE = 500

/**
 * Every row of a query. PostgREST cuts a read at its Max Rows setting without saying so (1000 by default; Los Banditos has
 * 1484 bars), so a read that can be long goes page by page. Ordered by `id`, so a page cannot skip or repeat a row.
 */
export async function selectAll<T>(query: () => SelectQuery<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().order('id').range(from, from + PAGE - 1)
    fail(error)
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) return rows
  }
}

/** The bucket's name for a file that is simply not there. Storage has answered both 404 and 400 with a 404 in the body. */
export function isMissingFile(error: StoragePortError): boolean {
  return error.status === 404 || error.statusCode === '404' || /not.?found/i.test(error.message)
}

const LIST_PAGE = 100

/**
 * Every file under a folder, as full paths: Storage lists one level at a time and a page at a time, so this walks the folders and the pages.
 * A page shorter than the limit does not end the folder (a server may cap a page below what was asked); only an empty page does.
 * An entry with no id is walked into as a folder: listing a file's path gives nothing, so a wrong guess costs one call, not a file.
 */
export async function listAllFiles(bucket: BucketPort, folder: string): Promise<string[]> {
  const files: string[] = []
  for (let offset = 0; ; ) {
    const { data, error } = await bucket.list(folder, { limit: LIST_PAGE, offset })
    fail(error)
    for (const entry of data ?? []) {
      if (entry.id === null || entry.id === undefined) files.push(...(await listAllFiles(bucket, `${folder}/${entry.name}`)))
      else files.push(`${folder}/${entry.name}`)
    }
    if ((data?.length ?? 0) === 0) return files
    // The next page starts after what was received, which may be fewer than the limit.
    offset += data?.length ?? 0
  }
}

/** Storage's bulk delete takes up to 1000 paths in one call. */
const REMOVE_BATCH = 1000

async function tryRemove(bucket: BucketPort, paths: string[]): Promise<boolean> {
  try {
    return (await bucket.remove(paths)).error === null
  } catch {
    return false
  }
}

/**
 * Removes the files once their rows are gone, so a failure here cannot undo what came before: each batch is tried twice, and what
 * is left is warned of as a count (never a path or an id, which hold personal data). A file left behind is not reachable from
 * the app: nothing lists it, and a member's read is tied to a live piece (migration 0007), except an address already signed.
 * `what` names the step in the warning ("A delete", "An upload taken back").
 */
export async function removeFiles(bucket: BucketPort, paths: string[], what: string): Promise<void> {
  let left = 0
  for (let from = 0; from < paths.length; from += REMOVE_BATCH) {
    const batch = paths.slice(from, from + REMOVE_BATCH)
    if (!(await tryRemove(bucket, batch)) && !(await tryRemove(bucket, batch))) left += batch.length
  }
  if (left > 0) console.warn(`${what} left ${left} files in storage.`)
}
