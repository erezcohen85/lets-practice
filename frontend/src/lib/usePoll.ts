import { useCallback, useEffect, useRef, useState } from 'react'

interface PollOptions<T> {
  intervalMs: number
  /** Polling goes on only while this is true for the latest value. */
  while: (value: T) => boolean
  /** Default true. While false nothing loads; when it turns true the first load starts. */
  enabled?: boolean
}

/**
 * Calls load at once, then again intervalMs after each load has finished, for as long as `while` holds for the latest
 * value. It stops on unmount and on an error (the error is kept until reload()). Two loads never run at once.
 * reload() clears the error and loads again; it also starts polling again after `while` had stopped it.
 */
export function usePoll<T>(
  load: () => Promise<T>,
  options: PollOptions<T>,
): { value: T | undefined; error: unknown; reload(): void } {
  const { intervalMs, enabled = true } = options
  const [state, setState] = useState<{ value: T | undefined; error: unknown }>({ value: undefined, error: undefined })
  const [reloads, setReloads] = useState(0)
  // The latest load and condition, so a new function on every render does not restart the polling.
  const loadRef = useRef(load)
  const whileRef = useRef(options.while)
  // The load that is running now, so that a reload waits for it instead of running beside it.
  const running = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    loadRef.current = load
    whileRef.current = options.while
  })

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      await running.current
      if (stopped) return
      running.current = (async () => {
        try {
          const value = await loadRef.current()
          if (stopped) return
          setState({ value, error: undefined })
          if (whileRef.current(value)) timer = setTimeout(() => void tick(), intervalMs)
        } catch (error) {
          if (!stopped) setState((previous) => ({ value: previous.value, error }))
        }
      })()
    }
    void tick()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [enabled, intervalMs, reloads])

  const reload = useCallback(() => {
    setState((previous) => ({ value: previous.value, error: undefined }))
    setReloads((count) => count + 1)
  }, [])

  return { value: state.value, error: state.error, reload }
}
