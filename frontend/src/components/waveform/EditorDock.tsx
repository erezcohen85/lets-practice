import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocatorEdits } from '@/components/waveform/useLocatorEdits'
import { type FollowClock } from '@/components/practice/followClock'
import { Skeleton } from '@/components/ui/skeleton'
import { type DockFilter, type SlotRef, WaveformDock } from '@/components/waveform/WaveformDock'
import { RenumberSwitch } from '@/components/editor/RenumberSwitch'
import { filledSlots } from '@/domain/fillBars'
import { type DetectedBeat } from '@/domain/beats'
import { type EditorDoc, type EditResult, type EditRefusal } from '@/domain/pieceEdits'
import { CURSOR_SLACK_SEC } from '@/domain/practice'
import { reviewItems } from '@/domain/reviewQueue'
import { type ClickMode } from '@/domain/types'
import { useClients } from '@/lib/clients'
import { type ContinueMode } from '@/lib/dataClient'
import { useBeats } from '@/lib/useBeats'
import { type Player } from '@/lib/player/player'
import { useOwnedPlayer } from '@/lib/useOwnedPlayer'
import { useTransport } from '@/lib/useTransport'
import { strings } from '@/strings'

const text = strings.dock

const NO_MOVES: NonNullable<EditorDoc['moved']> = []

interface Media { peaks: number[] | null; url: string | null }

/** What the DataClient has for the dock: the waveform peaks and a URL the player can load. undefined while loading, 'failed' when it could not be read. */
function useMedia(pieceId: string): Media | 'failed' | undefined {
  const { data } = useClients()
  const [state, setState] = useState<{ pieceId: string; media: Media | 'failed' } | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    Promise.all([data.getPeaks(pieceId), data.getAudioUrl(pieceId)]).then(
      ([peaks, url]) => {
        if (!cancelled) setState({ pieceId, media: { peaks, url } })
      },
      () => {
        if (!cancelled) setState({ pieceId, media: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, pieceId])
  return state?.pieceId === pieceId ? state.media : undefined
}

/** A request to move the playhead to a time. */
export interface SeekRequest { timeSec: number }

export interface EditorDockProps {
  pieceId: string
  partId: string
  doc: EditorDoc
  /** The recording's length from the piece, used until the player knows it. */
  recordingSec: number | null
  selected: SlotRef | null
  onSelect(slot: SlotRef): void
  /** Every selected locator when several are (the page's bars on the score follow it); empty: just `selected`. */
  group?: readonly SlotRef[]
  /** The dock chose several locators, or cleared the selection (an empty list). */
  onSelectGroup?(slots: SlotRef[]): void
  /** Written with the playhead's time on every change, so the page can pick the pass nearest it when a bar is clicked on the score. */
  playheadRef?: { current: number | null }
  /** Written with the playhead's time (plus Practice's cursor slack) on every change, for the follow box on the score. */
  clock?: FollowClock
  /** Called when the recording starts or stops playing, for the score's follow scroll. */
  onPlayingChange?(playing: boolean): void
  /** The page asks the playhead to move (a Review Queue card was opened); each request is a new object, so the same time can be asked twice. */
  seekTo?: SeekRequest | null
  /** The "Renumber the bars after" switch: Add and Delete on the waveform move the later bars when it is 'ripple'; Shift does the other one. */
  barLineMode: ClickMode
  /** Changes the Renumber setting; with it, the dock shows the switch in its toolbar. */
  onBarLineModeChange?(mode: ClickMode): void
  /** Settings > Editing > "Continue from my bars": what the dock does once 3 bars in a row are checked by ear. Left out: 'button' (nothing by itself). */
  continueMode?: ContinueMode
  /** The piece's detected beats when the page already holds them (the Wrong beat card needs them too); left out, the dock reads them itself. null: none, or not read yet. */
  beats?: DetectedBeat[] | null
  /** Records and saves an edit of the doc; gives the reason back when it was refused. */
  onApply(result: EditResult): EditRefusal | null
}

/** The waveform dock of the Editor with what it needs from the app: the piece's peaks and recording, one player, the Review Queue's items, and the dock's own view state (filter, beat lines). */
export function EditorDock(props: EditorDockProps) {
  const media = useMedia(props.pieceId)
  const player = useOwnedPlayer()
  if (media === undefined || player === null) {
    return (
      <div role="status" aria-label={strings.common.loading} className="px-6 pb-3">
        <Skeleton className="h-44 w-full bg-surface-3 motion-reduce:animate-none" />
      </div>
    )
  }
  if (media === 'failed') return <DockNote text={text.loadFailed} />
  if (media.peaks === null) return <DockNote text={text.noWaveform} />
  return <LoadedDock {...props} player={player} peaks={media.peaks} url={media.url} />
}

function DockNote({ text: note }: { text: string }) {
  return (
    <section aria-label={text.region} className="border-t border-border px-6 py-4">
      <p className="text-sm text-text-muted">{note}</p>
    </section>
  )
}

function LoadedDock({
  pieceId,
  doc,
  partId,
  recordingSec,
  selected,
  onSelect,
  group,
  onSelectGroup,
  playheadRef,
  clock,
  onPlayingChange,
  seekTo = null,
  onApply,
  barLineMode,
  onBarLineModeChange,
  continueMode,
  beats: givenBeats,
  player,
  peaks,
  url,
}: EditorDockProps & { player: Player; peaks: number[]; url: string | null }) {
  const transport = useTransport(player, url)
  const { timeSec } = transport
  useEffect(() => {
    if (playheadRef) playheadRef.current = timeSec
  }, [playheadRef, timeSec])
  useLayoutEffect(() => clock?.set(timeSec + CURSOR_SLACK_SEC))
  const { playing } = transport
  useEffect(() => {
    onPlayingChange?.(playing)
  }, [onPlayingChange, playing])
  // A request that was already there when the dock mounted is not new.
  const handledSeek = useRef(seekTo)
  const { seek } = transport
  useEffect(() => {
    if (seekTo === null || seekTo === handledSeek.current) return
    handledSeek.current = seekTo
    seek(seekTo.timeSec)
  }, [seekTo, seek])
  const [filter, setFilter] = useState<DockFilter>('all')
  const [beatLines, setBeatLines] = useState(false)
  const items = useMemo(() => reviewItems(doc, partId), [doc, partId])
  const readBeats = useBeats(pieceId, givenBeats === undefined)
  const beats = givenBeats === undefined ? readBeats : givenBeats
  const { onEdit, refusal } = useLocatorEdits(doc, onApply, barLineMode)
  const moved = doc.moved ?? NO_MOVES
  const filled = useMemo(() => filledSlots(doc), [doc])
  return (
    <WaveformDock
      peaks={peaks}
      durationSec={transport.durationSec ?? recordingSec ?? 0}
      timing={doc.timing}
      beats={beats}
      items={items}
      moved={moved}
      filled={filled}
      transport={transport}
      selected={selected}
      onSelect={onSelect}
      group={group}
      onSelectGroup={onSelectGroup}
      filter={filter}
      onFilterChange={setFilter}
      beatLines={beatLines}
      onBeatLinesChange={setBeatLines}
      renumberSwitch={onBarLineModeChange === undefined ? undefined : <RenumberSwitch mode={barLineMode} onChange={onBarLineModeChange} dock />}
      onEdit={onEdit}
      continueMode={continueMode}
      refusal={refusal}
      unavailable={url === null}
    />
  )
}
