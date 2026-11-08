import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { allowed, type PlanAction, type PlanState } from '@/domain/planLimits'
import { useClients } from '@/lib/clients'
import { usePlanGate } from '@/lib/plan'

export interface PiecePlan {
  /** The plan with this piece's usage (parts, realigns, reads again), or null until it is read. */
  state: PlanState | null
  /** False when the plan does not allow the action on this piece: the prompt is open. True when it does, and when the plan is not known. */
  check(action: PlanAction): boolean
  /**
   * Checks (when there is an action), then does the work. Resolves true when the work was done, false when the plan refused it
   * (the prompt is open, here or by the server's answer); any other error is thrown. The piece's usage is read again after.
   */
  attempt(action: PlanAction | null, work: () => Promise<void>): Promise<boolean>
  /** Reads the piece's usage again (after something that counts changed). */
  reload(): Promise<void>
}

/**
 * The signed-in user's plan with one piece's usage, for the actions that count per piece (read a part again, realign): the
 * plan context's own state has no piece block. Like the rest of the gates it only shows the prompt early; the server decides.
 */
export function usePiecePlan(pieceId: string): PiecePlan {
  const { data } = useClients()
  const gate = usePlanGate()
  const [state, setState] = useState<PlanState | null>(null)
  // Each read takes a ticket; only the newest may write.
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const next = await data.myPlan(pieceId)
      if (ticket === latest.current) setState(next)
    } catch {
      // The plan stays as it was; the server decides anyway.
    }
  }, [data, pieceId])

  // Read once when the piece opens (and when another piece does). The answer is dropped if the piece has changed or the page has left.
  useEffect(() => {
    const ticket = ++latest.current
    data.myPlan(pieceId).then(
      (next) => {
        if (ticket === latest.current) setState(next)
      },
      () => {
        // The plan stays as it was; the server decides anyway.
      },
    )
    return () => {
      latest.current += 1
    }
  }, [data, pieceId])

  return useMemo<PiecePlan>(() => {
    const check = (action: PlanAction): boolean => {
      if (state === null) return true
      const verdict = allowed(state, action)
      if (verdict.ok) return true
      gate.show(verdict.limit)
      return false
    }
    const attempt = async (action: PlanAction | null, work: () => Promise<void>): Promise<boolean> => {
      if (action !== null && !check(action)) return false
      const done = await gate.run(null, async () => {
        await work()
        return true
      })
      // What was counted (or refused as stale) is read again, so the lines and the next check catch up.
      void reload()
      return done === true
    }
    return { state, check, attempt, reload }
  }, [state, gate, reload])
}
