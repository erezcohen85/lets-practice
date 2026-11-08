import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RecordingScrubber } from '@/components/hub/RecordingScrubber'
import { RenameDialog } from '@/components/hub/RenameDialog'
import { Button } from '@/components/ui/button'
import { PlayRing } from '@/components/practice/PlayRing'
import { Skeleton } from '@/components/ui/skeleton'
import { WaveformStrip } from '@/components/waveform/WaveformStrip'
import { MAX_RECORDING_NAME } from '@/domain/names'
import { formatDuration } from '@/domain/pieceStatus'
import { useClients } from '@/lib/clients'
import { type Player } from '@/lib/player/player'
import { useOwnedPlayer } from '@/lib/useOwnedPlayer'
import { usePoll } from '@/lib/usePoll'
import { useTransport } from '@/lib/useTransport'
import { strings } from '@/strings'

const WAVE_BARS = 80
const WAVE_HEIGHT = 56

/**
 * The recording of the piece: its name (a pencil renames it), a waveform of 80 bars to play and browse, and play / pause. The waveform
 * loads on its own, so the page does not wait for it: a skeleton stands in meanwhile, and a missing or failed waveform says
 * so in a line of text. `durationSec` is the recording's length from the piece, used until the player knows it.
 */
export function RecordingCard({
  pieceId,
  label,
  durationSec,
  onRename,
}: {
  pieceId: string
  label: string | null
  durationSec: number | null
  /** Left out for a member, who cannot rename the recording. */
  onRename?: (name: string) => Promise<void>
}) {
  const { data } = useClients()
  const [renaming, setRenaming] = useState(false)
  // Loaded once: the peaks of a finished piece do not change.
  const { value: peaks, error } = usePoll(() => data.getPeaks(pieceId), { intervalMs: 1000, while: () => false })

  let body
  if (error !== undefined) {
    body = <p className="text-sm text-text-muted">{strings.hub.waveformError}</p>
  } else if (peaks === undefined) {
    body = (
      <div role="status" aria-label={strings.hub.waveformLoading}>
        <Skeleton className="w-full rounded-[2px] bg-surface-3 motion-reduce:animate-none" style={{ height: WAVE_HEIGHT }} />
      </div>
    )
  } else if (peaks === null) {
    body = <p className="text-sm text-text-muted">{strings.hub.waveformMissing}</p>
  } else {
    body = <RecordingPlayback pieceId={pieceId} peaks={peaks} durationSec={durationSec} />
  }

  return (
    <section className="flex flex-col gap-3.5 rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg leading-[1.3] font-semibold">{strings.hub.recording}</h2>
        <div className="flex min-w-0 items-center gap-1">
          {label !== null && (
            <span data-slot="recording-name" title={label} className="min-w-0 truncate text-sm text-text-muted">
              {label}
            </span>
          )}
          {label !== null && onRename !== undefined && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={strings.hub.renameRecording}
              title={strings.hub.rename}
              className="-my-2 size-11 shrink-0 text-text-soft"
              onClick={() => setRenaming(true)}
            >
              <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {body}
      {label !== null && onRename !== undefined && (
        <RenameDialog
          open={renaming}
          onOpenChange={setRenaming}
          value={label}
          max={MAX_RECORDING_NAME}
          texts={strings.hub.renameRecordingTexts}
          onRename={onRename}
        />
      )}
    </section>
  )
}

/** The player of the card: made once per visit and destroyed with the card; until it exists the waveform stands alone. */
function RecordingPlayback(props: { pieceId: string; peaks: readonly number[]; durationSec: number | null }) {
  const player = useOwnedPlayer()
  if (player === null) return <WaveformStrip peaks={props.peaks} bars={WAVE_BARS} height={WAVE_HEIGHT} />
  return <Playback {...props} player={player} />
}

// Where the card is in getting the recording: nothing asked yet, asking for the URL, the URL, or no recording to play.
type Source = { state: 'idle' | 'asking' | 'none' } | { state: 'url'; url: string }

/** What the user asked for before the recording had loaded: play, and a time to be at. */
interface Pending { play: boolean; seekSec: number | null }

function Playback({ pieceId, peaks, durationSec, player }: { pieceId: string; peaks: readonly number[]; durationSec: number | null; player: Player }) {
  const { data } = useClients()
  const [source, setSource] = useState<Source>({ state: 'idle' })
  // What was asked for before the recording had loaded (done once it has), and the time the user asked to be at, to show meanwhile.
  const pending = useRef<Pending | null>(null)
  const [askedSec, setAskedSec] = useState(0)
  const transport = useTransport(player, source.state === 'url' ? source.url : null)
  const { ready, playing, error, toggle, seek } = transport

  // The URL is asked for, and the recording loaded, only once the user first plays or seeks: the hub opens without them.
  useEffect(() => {
    if (source.state !== 'asking') return
    let cancelled = false
    data.getAudioUrl(pieceId).then(
      (url) => {
        if (!cancelled) setSource(url === null ? { state: 'none' } : { state: 'url', url })
      },
      () => {
        if (!cancelled) setSource({ state: 'none' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [source.state, data, pieceId])

  useEffect(() => {
    const todo = pending.current
    if (!ready || todo === null) return
    pending.current = null
    if (todo.seekSec !== null) seek(todo.seekSec)
    if (todo.play) toggle()
  }, [ready, seek, toggle])

  const request = (change: Partial<Pending>) => {
    pending.current = { play: false, seekSec: null, ...pending.current, ...change }
    if (typeof change.seekSec === 'number') setAskedSec(change.seekSec)
    setSource((previous) => (previous.state === 'idle' ? { state: 'asking' } : previous))
  }

  if (source.state === 'none') return <WaveformStrip peaks={peaks} bars={WAVE_BARS} height={WAVE_HEIGHT} />

  const total = transport.durationSec ?? durationSec ?? 0
  const timeSec = ready ? transport.timeSec : askedSec
  const onSeek = (sec: number) => (ready ? seek(sec) : request({ seekSec: sec }))
  const onToggle = () => (ready ? toggle() : request({ play: true }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {/* Practice's ring at its fixed 88 px, lit as far as the recording has played. */}
        <PlayRing
          playing={playing}
          progress={total > 0 ? timeSec / total : 0}
          size="fixed"
          labels={{ play: strings.hub.playRecording, pause: strings.hub.pauseRecording }}
          onToggle={onToggle}
        />
        <span aria-label={strings.dock.timeLabel} role="timer" className="font-semibold tabular-nums">
          <span className="text-lg">{formatDuration(Math.floor(timeSec))}</span>{' '}
          <span className="text-sm text-text-muted">{strings.dock.timeTotal(formatDuration(total))}</span>
        </span>
        {error && <span className="min-w-0 text-sm text-problem">{strings.player.loadFailed}</span>}
      </div>
      <RecordingScrubber peaks={peaks} bars={WAVE_BARS} height={WAVE_HEIGHT} durationSec={total} timeSec={timeSec} onSeek={onSeek} />
    </div>
  )
}
