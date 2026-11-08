import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PlanPrompt } from '@/components/plan/PlanPrompt'
import { allowed, parseLimitError, type LimitKey, type PlanAction, type PlanState } from '@/domain/planLimits'
import { useClients } from '@/lib/clients'
import { PlanLimitError } from '@/lib/processorClient'
import { useSession } from '@/lib/session'
import { strings } from '@/strings'

// The plan of the signed-in user and the "Not in your plan" prompt (plans and limits). The server decides; the browser reads the
// plan only to show the prompt before a click is sent, and every refusal that does reach it opens the same prompt.

interface PlanContextValue {
  state: PlanState | null
  refresh(): Promise<void>
  show(limit: LimitKey): void
  /** False outside a PlanProvider: there is no prompt to open, so a refusal must reach the caller. */
  prompting: boolean
}

/** What the hooks give outside a PlanProvider: no plan known, nothing refused early, no prompt to open. */
const NO_PLAN: PlanContextValue = { state: null, refresh: async () => {}, show: () => {}, prompting: false }

const PlanContext = createContext<PlanContextValue>(NO_PLAN)

/** The sentence for a limit, in the user's own plan's name and numbers. */
export function limitSentence(limit: LimitKey, state: PlanState): string {
  return strings.plans.prompt[limit](state.plan)
}

/**
 * The sentence for a job that ended with `plan_limit:<key>` (the processor's refusal), or null for any other error text.
 * Pass the plan (usePlan().state) to name its numbers; without it the sentence is the plain "This is not in your plan."
 */
export function jobErrorSentence(error: string | null, state: PlanState | null = null): string | null {
  if (error === null) return null
  const limit = parseLimitError(error)
  if (limit === null) return null
  if (state === null) return strings.plans.promptGeneric
  // A few sentences describe a click that was refused; a job that did not run needs its own words.
  const own = (strings.plans.jobPrompt as Partial<Record<LimitKey, (plan: PlanState['plan']) => string>>)[limit]
  return own === undefined ? limitSentence(limit, state) : own(state.plan)
}

/**
 * Reads the plan after sign-in and holds the prompt. Inside SessionProvider. A plan that cannot be read leaves `state` null:
 * nothing is refused early then, and the server still refuses.
 */
export function PlanProvider({ children }: { children: ReactNode }) {
  const { data } = useClients()
  const session = useSession()
  const userId = session.user?.id ?? null
  const [state, setState] = useState<PlanState | null>(null)
  const [limit, setLimit] = useState<LimitKey | null>(null)
  // Each read takes a ticket; only the newest may write, and a user who left takes theirs with them.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (userId === null) return
    const ticket = ++latest.current
    try {
      const next = await data.myPlan()
      if (ticket === latest.current) setState(next)
    } catch {
      // The plan stays as it was; the server decides anyway.
    }
  }, [data, userId])

  useEffect(() => {
    latest.current += 1
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a different user starts without the last user's plan
    setState(null)
    setLimit(null)
    void refresh()
    return () => {
      latest.current += 1
    }
  }, [refresh])

  const show = useCallback((next: LimitKey) => setLimit(next), [])
  const value = useMemo<PlanContextValue>(() => ({ state, refresh, show, prompting: true }), [state, refresh, show])
  const prompt =
    limit === null
      ? null
      : {
          title: strings.plans.promptTitle(limit, state?.plan.name ?? ''),
          sentence: state === null ? strings.plans.promptGeneric : limitSentence(limit, state),
        }

  return (
    <PlanContext value={value}>
      {children}
      <PlanPrompt prompt={prompt} onClose={() => setLimit(null)} />
    </PlanContext>
  )
}

/** The signed-in user's plan (null until read, and outside a PlanProvider) and a way to read it again after something changed. */
export function usePlan(): { state: PlanState | null; refresh(): Promise<void> } {
  const { state, refresh } = useContext(PlanContext)
  return useMemo(() => ({ state, refresh }), [state, refresh])
}

export interface PlanGate {
  /** False when the plan does not allow the action: the prompt is open. True when it does, and when the plan is not known. */
  check(action: PlanAction): boolean
  /** Checks (when there is an action), then does the work. A refusal by the server (PlanLimitError) opens the prompt and resolves undefined; any other error is thrown. */
  run<T>(action: PlanAction | null, work: () => Promise<T>): Promise<T | undefined>
  /** Opens the prompt for a limit. */
  show(limit: LimitKey): void
}

export function usePlanGate(): PlanGate {
  const { state, refresh, show, prompting } = useContext(PlanContext)
  return useMemo<PlanGate>(() => {
    const check = (action: PlanAction): boolean => {
      if (state === null) return true
      const verdict = allowed(state, action)
      if (verdict.ok) return true
      show(verdict.limit)
      return false
    }
    const run = async <T,>(action: PlanAction | null, work: () => Promise<T>): Promise<T | undefined> => {
      if (action !== null && !check(action)) return undefined
      try {
        return await work()
      } catch (error) {
        if (!prompting || !(error instanceof PlanLimitError)) throw error
        // The server knows better than the page: show its limit, and read the plan again so the numbers and the page catch up.
        show(error.limit)
        void refresh()
        return undefined
      }
    }
    return { check, run, show }
  }, [state, refresh, show, prompting])
}
