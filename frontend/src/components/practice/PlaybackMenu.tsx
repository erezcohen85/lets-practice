import { SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import { COUNT_IN_FADES } from '@/domain/countInFade'
import { type PlaybackSettings } from '@/lib/dataClient'
import { strings } from '@/strings'
import { MenuChoice, ToolbarMenu } from './ToolbarMenu'

const text = strings.practice

/**
 * The Playback button of the toolbar and its panel: how the music fades in on a count-in. It lives in the profile (it used
 * to be on the Settings page); each change is saved at once by the page, which also says here when a save failed. The
 * count on the score is in the count-in menu.
 */
export function PlaybackMenu({
  playback,
  onChange,
  failed,
}: {
  playback: PlaybackSettings
  onChange(update: Partial<PlaybackSettings>): void
  failed: boolean
}) {
  const fadeId = useId()
  return (
    <ToolbarMenu
      label={
        <>
          <SlidersHorizontal className="size-5 text-text-soft" aria-hidden="true" />
          {text.playback}
        </>
      }
      panelLabel={text.playbackMenu}
      panelRole="dialog"
      chevron={false}
      className="w-auto"
      panelClassName="w-80 max-w-[calc(100vw-2rem)] gap-3 p-3"
    >
      <div className="flex flex-col gap-1">
        <p id={fadeId} className="px-3 text-sm font-medium text-text-soft">
          {text.countInFade}
        </p>
        <div role="radiogroup" aria-labelledby={fadeId} className="flex flex-col">
          {COUNT_IN_FADES.map((fade) => (
            <MenuChoice key={fade} role="radio" checked={fade === playback.countInFade} onChoose={() => onChange({ countInFade: fade })}>
              {text.countInFades[fade]}
            </MenuChoice>
          ))}
        </div>
      </div>
      {failed && (
        <p role="alert" className="px-3 text-[15px] text-problem">
          {text.saveFailed}
        </p>
      )}
    </ToolbarMenu>
  )
}
