import { useRef, useState } from 'react'
import { type UserSettings } from '@/lib/dataClient'

/**
 * Saves each change at once. The screen shows the change straight away and puts it back if the save fails.
 *
 * - Saves go one after the other, in the order the changes were made, so a slow older save can never land after a
 *   newer one and undo it. Each change is made on top of the ones before it, so the newest save carries them all.
 * - Only the newest change decides what happens next: when it is saved, what is shown is what the session holds;
 *   when it fails, the change is taken back and `failedIn` names where it was made. An older failed change is
 *   skipped, because a newer save has carried it along.
 */
export function useSettingsSaver<Area extends string>(
  saved: UserSettings,
  save: (settings: UserSettings) => Promise<void>,
) {
  const [pending, setPending] = useState<UserSettings | null>(null)
  const [failedIn, setFailedIn] = useState<Area | null>(null)
  const newest = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const shown = pending ?? saved

  function change(area: Area, update: (settings: UserSettings) => UserSettings) {
    const next = update(shown)
    const ticket = ++newest.current
    setPending(next)
    setFailedIn(null)
    queue.current = queue.current.then(async () => {
      try {
        await save(next)
        if (ticket === newest.current) setPending(null)
      } catch {
        if (ticket !== newest.current) return
        setPending(null)
        setFailedIn(area)
      }
    })
  }

  return { settings: shown, change, failedIn }
}
