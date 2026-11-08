import { SPLIT_EXPIRED } from '@/domain/splitEdits'
import { parseLimitError } from '@/domain/planLimits'
import { PlanLimitError, SampleFailedError, SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'

export interface ProcessorHttpOptions {
  baseUrl: string
  /** The signed-in user's access token, or null. */
  token: () => Promise<string | null>
  fetchFn?: typeof fetch
}

export interface ProcessorHttp {
  /** POSTs JSON (or nothing) with the bearer token. The token goes in the Authorization header only: never in an address, a body or a message. */
  post(path: string, body?: unknown): Promise<Response>
  /** The error for a refused route: a sentence for the refusals a user can act on, a plain failure (without the body) for the rest. */
  refusal(response: Response): Promise<Error>
  /** Like `refusal`, for the split and name routes, whose 400 and 410 answers are sentences of the processor's own (a PDF it cannot read, a split that has expired). */
  splitRefusal(response: Response): Promise<Error>
}

/** The calls to the processor on Railway, shared by the job routes and the split and name routes. */
export function createProcessorHttp({ baseUrl, token, fetchFn = (input, init) => fetch(input, init) }: ProcessorHttpOptions): ProcessorHttp {
  const base = baseUrl.replace(/\/+$/, '')

  async function post(path: string, body?: unknown): Promise<Response> {
    const access = await token()
    if (access === null) throw new Error('not signed in')
    const headers: Record<string, string> = { Authorization: `Bearer ${access}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return fetchFn(`${base}${path}`, { method: 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }

  /** The `detail` of an error answer: a sentence, or the object of a plan refusal. */
  async function rawDetailOf(response: Response): Promise<unknown> {
    return response.json().then(
      (body: unknown) => (typeof body === 'object' && body !== null && 'detail' in body ? body.detail : ''),
      () => '',
    )
  }

  async function detailOf(response: Response): Promise<string> {
    const detail = await rawDetailOf(response)
    return typeof detail === 'object' && detail !== null ? '' : String(detail)
  }

  /** The limit a 403 {"detail": {"code": "plan_limit", "limit": "<key>"}} names, or null. */
  function planLimitOf(detail: unknown): PlanLimitError | null {
    if (typeof detail !== 'object' || detail === null || !('code' in detail) || detail.code !== 'plan_limit' || !('limit' in detail)) return null
    const limit = parseLimitError(`plan_limit:${String(detail.limit)}`)
    return limit === null ? null : new PlanLimitError(limit)
  }

  /** True for a 503 {"detail": {"code": "sample_failed"}}. */
  function isSampleFailed(detail: unknown): boolean {
    return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'sample_failed'
  }

  async function refusal(response: Response): Promise<Error> {
    const raw = await rawDetailOf(response)
    if (response.status === 403) {
      const refused = planLimitOf(raw)
      if (refused !== null) return refused
    }
    if (response.status === 401) return new SentenceError(strings.realServices.notAccepted)
    if (response.status === 409) return new SentenceError(strings.realServices.stillPreparing)
    if (response.status === 503 && isSampleFailed(raw)) return new SampleFailedError()
    if (response.status === 503) return new SentenceError(strings.realServices.cannotStart)
    return new Error(`The processor answered ${response.status}.`)
  }

  async function splitRefusal(response: Response): Promise<Error> {
    // The processor words these itself, in one plain sentence, and never with a path or a value of the user's.
    if (response.status === 410) return new SentenceError(SPLIT_EXPIRED)
    if (response.status === 400) {
      const detail = await detailOf(response)
      if (detail !== '') return new SentenceError(detail)
    }
    return refusal(response)
  }

  return { post, refusal, splitRefusal }
}
