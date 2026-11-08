import { useSettingsSaver } from '@/components/settings/useSettingsSaver'
import { type ClickMode } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { useSession } from '@/lib/session'

/**
 * The "Renumber the bars after" switch: `profiles.settings.barLineMode`, shown at once when changed, saved through the
 * session, and put back when the save fails (`saveFailed`). 'ripple' is on, the default.
 */
export function useBarLineMode() {
  const session = useSession()
  const { settings, change, failedIn } = useSettingsSaver<'barLineMode'>(session.profile?.settings ?? DEFAULT_SETTINGS, session.saveSettings)
  return {
    barLineMode: settings.barLineMode,
    setBarLineMode: (barLineMode: ClickMode) => change('barLineMode', (current) => ({ ...current, barLineMode })),
    saveFailed: failedIn !== null,
  }
}
