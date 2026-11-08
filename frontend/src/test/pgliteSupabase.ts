// frontend/src/test/pgliteSupabase.ts
import { type PGlite } from '@electric-sql/pglite'
import { type BucketPort, type PortResult, type SelectQuery, type SupabasePort, type TablePort, type WriteQuery } from '@/lib/supabase/port'
import { asUser } from '@/test/supabaseStandIn'

const NAME = /^[a-z_][a-z0-9_]*$/
/** PostgREST's default Max Rows: a read with no range stops here, without saying so. */
const MAX_ROWS = 1000

function name(text: string): string {
  if (!NAME.test(text)) throw new Error(`adapter: bad name ${text}`)
  return text
}

function columns(text: string): string {
  if (text.trim() === '*') return '*'
  // Embedded selects are not supported, on purpose: the real client's reads are flat (see port.ts).
  return text.split(',').map((column) => name(column.trim())).join(', ')
}

function failure(error: unknown): PortResult<never> {
  const { message, code } = error as { message: string; code?: string }
  return { data: null, error: { message, code } }
}

/**
 * The real client code on a real schema under real RLS, with no network. The same statements PostgREST would run, as the
 * signed-in user. Calls run one at a time: asUser sets and resets the role, so two overlapping calls would run one of them
 * as the superuser, which would hide an RLS failure.
 */
export function pgliteSupabase(db: PGlite) {
  let userId = ''
  let tail: Promise<unknown> = Promise.resolve()
  const files = new Map<string, Blob>()

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work)
    tail = next.catch(() => undefined)
    return next
  }
  const run = <T,>(sql: string, params: unknown[] = []) => serial(() => asUser<T>(db, userId, sql, params))
  /** The rows as PostgREST sends them: Postgres encodes the result as JSON, so a timestamp is a string and a numeric a number. */
  const runJson = async <T,>(inner: string, params: unknown[] = [], cte = false) => {
    const sql = cte
      ? `with t as (${inner}) select coalesce(json_agg(t), '[]'::json) as rows from t`
      : `select coalesce(json_agg(t), '[]'::json) as rows from (${inner}) t`
    return (await run<{ rows: T[] }>(sql, params))[0]!.rows
  }

  class Filters {
    protected where: string[] = []
    protected params: unknown[] = []
    protected addEq(column: string, value: unknown) {
      this.params.push(value)
      this.where.push(`${name(column)} = $${this.params.length + this.offset()}`)
    }
    protected offset() {
      return 0
    }
    protected clause() {
      return this.where.length === 0 ? '' : ` where ${this.where.join(' and ')}`
    }
  }

  class Select<T> extends Filters implements SelectQuery<T> {
    private sort = ''
    private from = 0
    private count = MAX_ROWS
    private table: string
    private list: string
    constructor(table: string, list: string) {
      super()
      this.table = table
      this.list = list
    }
    eq(column: string, value: string | number | boolean) {
      this.addEq(column, value)
      return this
    }
    in(column: string, values: readonly string[]) {
      this.params.push(values)
      // Compared as the column's own type, as PostgREST does: a malformed uuid is an error (22P02), not no rows.
      this.where.push(`${name(column)} = any($${this.params.length})`)
      return this
    }
    order(column: string, options?: { ascending: boolean }) {
      this.sort += `${this.sort === '' ? ' order by ' : ', '}${name(column)} ${options?.ascending === false ? 'desc' : 'asc'}`
      return this
    }
    range(from: number, to: number) {
      this.from = from
      this.count = Math.min(to - from + 1, MAX_ROWS)
      return this
    }
    limit(count: number) {
      this.count = Math.min(count, MAX_ROWS)
      return this
    }
    private async rows(): Promise<PortResult<T[]>> {
      try {
        const sql = `select ${this.list} from public.${this.table}${this.clause()}${this.sort} limit ${this.count} offset ${this.from}`
        return { data: await runJson<T>(sql, this.params), error: null }
      } catch (error) {
        return failure(error)
      }
    }
    maybeSingle(): PromiseLike<PortResult<T>> {
      return this.rows().then((result): PortResult<T> => {
        if (result.error !== null) return { data: null, error: result.error }
        // The real client's maybeSingle: none is null, more than one is an error, never the first of several.
        if ((result.data?.length ?? 0) > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
        return { data: result.data?.[0] ?? null, error: null }
      })
    }
    then<A, B>(done?: ((value: PortResult<T[]>) => A | PromiseLike<A>) | null, failed?: ((reason: unknown) => B | PromiseLike<B>) | null) {
      return this.rows().then(done, failed)
    }
  }

  class Write extends Filters implements WriteQuery {
    private build: (clause: string, returning: string) => string
    private leading: unknown[]
    constructor(build: (clause: string, returning: string) => string, leading: unknown[] = []) {
      super()
      this.build = build
      this.leading = leading
    }
    protected override offset() {
      return this.leading.length
    }
    eq(column: string, value: string | number | boolean) {
      this.addEq(column, value)
      return this
    }
    private async go<R>(returning: string): Promise<PortResult<R>> {
      try {
        const params = [...this.leading, ...this.params]
        if (returning === '') {
          await run(this.build(this.clause(), ''), params)
          return { data: null as R, error: null }
        }
        return { data: (await runJson<Record<string, unknown>>(this.build(this.clause(), returning), params, true)) as R, error: null }
      } catch (error) {
        return failure(error)
      }
    }
    select(list: string) {
      return this.go<Array<Record<string, unknown>>>(` returning ${columns(list)}`)
    }
    then<A, B>(done?: ((value: PortResult<null>) => A | PromiseLike<A>) | null, failed?: ((reason: unknown) => B | PromiseLike<B>) | null) {
      return this.go<null>('').then(done, failed)
    }
  }

  function table(raw: string): TablePort {
    const t = name(raw)
    const insertSql = (keys: string[], tail: string) => `insert into public.${t} (${keys.join(', ')}) select ${keys.join(', ')} from jsonb_populate_recordset(null::public.${t}, $1::jsonb)${tail}`
    return {
      select: <T,>(list: string) => new Select<T>(t, columns(list)),
      insert(values) {
        const rows = Array.isArray(values) ? values : [values]
        const keys = Object.keys(rows[0] ?? {}).map(name)
        return new Write((_, returning) => insertSql(keys, returning), [JSON.stringify(rows)])
      },
      update(values) {
        const keys = Object.keys(values).map(name)
        return new Write(
          (clause, returning) => `update public.${t} set (${keys.join(', ')}) = (select ${keys.join(', ')} from jsonb_populate_record(null::public.${t}, $1::jsonb))${clause}${returning}`,
          [JSON.stringify(values)],
        )
      },
      upsert(values, { onConflict }) {
        const keys = Object.keys(values).map(name)
        const conflict = onConflict.split(',').map((column) => name(column.trim()))
        const rest = keys.filter((key) => !conflict.includes(key))
        const action = rest.length === 0 ? 'do nothing' : `do update set ${rest.map((key) => `${key} = excluded.${key}`).join(', ')}`
        return new Write((_, returning) => insertSql(keys, ` on conflict (${conflict.join(', ')}) ${action}${returning}`), [JSON.stringify([values])])
      },
      delete: () => new Write((clause, returning) => `delete from public.${t}${clause}${returning}`),
    }
  }

  const bucket: BucketPort = {
    async upload(path, body, { upsert }) {
      try {
        // The bucket's own limits, read from the database (migration 0009 sets them), as Storage checks them. storage-js sends a Blob with its own type and ignores the `contentType` option; an empty type goes as application/octet-stream.
        const [limits] = await serial(() => db.query<{ size: number | null; types: string[] | null }>(`select file_size_limit::float8 as size, allowed_mime_types as types from storage.buckets where id = 'pieces'`)).then((result) => result.rows)
        const sent = body.type === '' ? 'application/octet-stream' : body.type
        if (limits?.size != null && body.size > limits.size) return { error: { message: 'The object exceeded the maximum allowed size', status: 413, statusCode: '413' } }
        if (limits?.types != null && !limits.types.some((allowed) => allowed === sent || (allowed.endsWith('/*') && sent.startsWith(allowed.slice(0, -1))))) {
          return { error: { message: `mime type ${sent} is not supported`, status: 415, statusCode: '415' } }
        }
        // One statement, so a refused insert cannot lose the row. Without upsert the unique key refuses a second file at a path.
        const conflict = upsert === true ? ' on conflict (bucket_id, name) do update set name = excluded.name' : ''
        await run(`insert into storage.objects (bucket_id, name) values ('pieces', $1)${conflict}`, [path])
        files.set(path, body)
        return { error: null }
      } catch (error) {
        const { message, code } = error as { message: string; code?: string }
        return { error: code === '23505' ? { message: 'The resource already exists', status: 409, statusCode: '409' } : { message, statusCode: '403' } }
      }
    },
    async remove(paths) {
      // One statement for the batch, under the user's own delete policy: what it may not remove stays, without an error, as in Storage.
      const gone = await run<{ name: string }>(`delete from storage.objects where bucket_id = 'pieces' and name = any($1) returning name`, [paths])
      for (const { name } of gone) files.delete(name)
      return { error: null }
    },
    async list(folder, { limit, offset }) {
      try {
        // Under the user's own policy, so a folder they may not read lists as empty, as Storage does. One level: a name with a slash after it is a folder.
        const rows = await run<{ name: string }>(`select name from storage.objects where bucket_id = 'pieces' and starts_with(name, $1) order by name`, [`${folder}/`])
        const level = new Map<string, boolean>()
        for (const { name } of rows) {
          const rest = name.slice(folder.length + 1)
          const slash = rest.indexOf('/')
          level.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1)
        }
        const entries = [...level].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(offset, offset + limit)
        return { data: entries.map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })), error: null }
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } }
      }
    },
    async download(path) {
      const visible = await run(`select 1 from storage.objects where bucket_id = 'pieces' and name = $1`, [path])
      const file = files.get(path)
      return visible.length === 0 || file === undefined ? { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } } : { data: file, error: null }
    },
    async createSignedUrls(paths, expiresIn) {
      const data = []
      for (const path of paths) {
        const visible = await run(`select 1 from storage.objects where bucket_id = 'pieces' and name = $1`, [path])
        data.push(visible.length === 0 ? { path, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' } : { path, signedUrl: `https://signed.test/${path}?e=${expiresIn}`, error: null })
      }
      return { data, error: null }
    },
  }

  const port: SupabasePort = {
    from: table,
    rpc: async <T,>(raw: string, args: Record<string, unknown> = {}): Promise<PortResult<T>> => {
      try {
        const fn = name(raw)
        const kinds = await serial(() => db.query<{ proretset: boolean; typname: string }>(`select p.proretset, t.typname from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1`, [fn]))
        const { proretset, typname } = kinds.rows[0]!
        const keys = Object.keys(args).map(name)
        const list = keys.map((key, index) => `${key} => $${index + 1}`).join(', ')
        const values = keys.map((key) => {
          const value = args[key]
          // A json argument goes as text; an array of integers or of uuids stays an array.
          return Array.isArray(value) && value.every((item) => typeof item === 'number' || typeof item === 'string') && !/^new_(rows|meters|marks|short_bars|locators|bars|box_flags|pages)$/.test(key) ? value : typeof value === 'object' && value !== null ? JSON.stringify(value) : value
        })
        // Encoded as JSON by Postgres, like PostgREST: a set is the array of its rows, a scalar is the value.
        if (proretset) return { data: (await runJson<unknown>(`select * from public.${fn}(${list})`, values)) as T, error: null }
        if (typname === 'void') {
          await run(`select public.${fn}(${list})`, values)
          return { data: null as T, error: null }
        }
        const [row] = await run<{ value: T }>(`select to_json(public.${fn}(${list})) as value`, values)
        return { data: row!.value, error: null }
      } catch (error) {
        return failure(error)
      }
    },
    storage: { from: () => bucket },
  }

  return {
    port,
    signIn(id: string) {
      userId = id
    },
    /** A file as the processor or the import would have stored it: a row in storage.objects and its bytes. */
    async putFile(path: string, body: string) {
      await serial(() => db.query(`insert into storage.objects (bucket_id, name) values ('pieces', $1)`, [path]))
      files.set(path, new Blob([body]))
    },
  }
}
