import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { SuggestionNote, SuggestNameButton } from '@/components/hub/SuggestNameButton'
import { useNameSuggestion } from '@/components/hub/useNameSuggestion'
import { AudioPicker } from '@/components/newpiece/AudioPicker'
import { partErrorText } from '@/components/newpiece/partErrorText'
import { PartsPicker } from '@/components/newpiece/PartsPicker'
import { typedName, usePartRows } from '@/components/newpiece/usePartRows'
import { useSplitChoice } from '@/components/newpiece/useSplitChoice'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { EmptyState } from '@/components/shell/StateCards'
import { TopBar } from '@/components/shell/TopBar'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFeatures } from '@/lib/useFeatures'
import { SPLIT_EXPIRED } from '@/domain/splitEdits'
import { validateNewPiece, validateSplitParts, type NewPieceError, type NewPieceForm } from '@/domain/newPiece'
import { useClients } from '@/lib/clients'
import { readAudioSeconds } from '@/lib/audioDuration'
import { usePlan, usePlanGate } from '@/lib/plan'
import { sentenceOf } from '@/lib/processorClient'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const t = strings.newPiece

// The boards set no line height, so their text takes the font's own (about 1.3), not Tailwind's 1.5.
const labelClass = 'text-sm leading-[1.3] font-semibold uppercase tracking-[0.04em] text-text-soft'
// The input component's own height, size and (from 768 px) smaller text are overridden here to match the board.
const fieldClass = 'h-13 rounded-lg bg-surface px-4 py-0 dark:bg-surface'

function errorText(code: NewPieceError): string {
  switch (code) {
    case 'title-missing':
      return t.errors.titleMissing
    case 'recording-missing':
      return t.errors.recordingMissingFile
    case 'parts-missing':
    case 'part-not-pdf':
      return partErrorText(code) ?? ''
  }
}

/** New piece, where the deployment takes uploads (every signed-in user may; their plan sets how many pieces, parts and pages). Elsewhere the message here and the Library's button. */
export function NewPiecePage() {
  const { profile } = useSession()
  const features = useFeatures()
  if (profile === null || !features.upload) {
    return (
      <PageColumn width="narrow">
        <TopBar />
        <div>
          <BackLink />
        </div>
        <EmptyState
          title={strings.limited.title}
          text={strings.limited.text}
          action={
            <Link to="/library" className={cn(buttonVariants({ size: 'xl' }))}>
              <ActionIcon action="library" />
              {strings.common.goToLibrary}
            </Link>
          }
        />
      </PageColumn>
    )
  }
  return <NewPieceForm />
}

function NewPieceForm() {
  const { data, processor } = useClients()
  const features = useFeatures()
  const navigate = useNavigate()
  const gate = usePlanGate()
  const { state: planState, refresh: refreshPlan } = usePlan()
  const ids = useId()
  const formRef = useRef<HTMLFormElement>(null)

  const [title, setTitle] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const rows = usePartRows((pdf) => processor.readPartName(pdf))
  const split = useSplitChoice((pdf) => processor.proposeSplit(pdf))
  const { parts } = rows
  const clues = {
    recording: audioFile === null ? null : { kind: 'file' as const, file: audioFile },
    // The PDF with all the parts starts with the first part, which is what the title is looked for in.
    firstPart: split.active ? split.file : (parts[0]?.file ?? null),
  }
  const suggestion = useNameSuggestion(
    () => processor.suggestNewPieceName(clues),
    (name) => setTitle(name),
  )

  // A recording is checked against the plan once its length is read from the file; the file is kept at once and put back if refused.
  async function chooseAudio(file: File | null) {
    const before = audioFile
    setAudioFile(file)
    if (file === null) return
    const seconds = await readAudioSeconds(file)
    // A length that cannot be read is not checked here; the processor checks it again.
    if (seconds !== null && !gate.check({ type: 'recording', seconds })) setAudioFile((now) => (now === file ? before : now))
  }

  const [attempted, setAttempted] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [startFailed, setStartFailed] = useState(false)
  // The sentence of a refusal (the local server's), shown in place of the generic text.
  const [startSentence, setStartSentence] = useState<string | null>(null)

  const busy = useRef(false)
  // The piece a failed start has already created, and the form it was made from: a retry of the same form starts that
  // piece instead of making a second one; a changed form makes a new one.
  const created = useRef<{ id: string; signature: string } | null>(null)

  const form: NewPieceForm = {
    title,
    recording: { kind: 'file', fileName: audioFile?.name ?? null },
    parts: split.active ? [] : parts.map((part) => ({ fileName: part.file.name, name: part.name })),
  }
  // Several parts from one PDF count once the split is confirmed (the split's own check, not the PDF rows').
  const validate = () => validateNewPiece(form, split.active ? validateSplitParts(split.stage === 'confirmed', split.parts) : undefined)
  // Once a start has been tried, the errors follow the form: each one goes as soon as its field is put right.
  const errors = attempted ? validate() : {}

  const titleErrorId = `${ids}-title-error`
  const recordingErrorId = `${ids}-recording-error`
  const recordingLabelId = `${ids}-recording-label`
  const partsLabelId = `${ids}-parts-label`

  useEffect(() => {
    if (focusRequest === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusRequest])

  function signature(): string {
    const recording = `${audioFile?.name}|${audioFile?.size}|${audioFile?.lastModified}`
    const chosen = split.upload()
    const partsKey = chosen === undefined ? parts.map((part) => [part.key, typedName(part), rows.boxChecks.has(part.key)]) : [chosen.splitId, chosen.parts, chosen.boxChecks ?? []]
    return JSON.stringify([title.trim(), recording, partsKey])
  }

  async function start() {
    // The form is checked before a start, so a recording is always there.
    if (audioFile === null) return
    busy.current = true
    setSubmitting(true)
    // The piece this try made, so a first reading the plan refuses can take it back.
    let madeNow: string | null = null
    try {
      const chosen = split.upload()
      const now = signature()
      // The plan may refuse at the database (the piece) or at the processor (its first reading): either opens the prompt and stays here.
      const started = await gate.run(null, async () => {
        let pieceId = created.current?.signature === now ? created.current.id : undefined
        if (pieceId === undefined) {
          const piece = await data.createPiece({
            title: title.trim(),
            recording: { kind: 'file' as const, file: audioFile },
            parts: chosen === undefined ? parts.map((part) => ({ file: part.file, name: typedName(part), ...(rows.boxChecks.has(part.key) ? { boxCheck: true } : {}) })) : [],
            ...(chosen === undefined ? {} : { split: chosen }),
          })
          created.current = { id: piece.id, signature: now }
          madeNow = piece.id
          pieceId = piece.id
        }
        await processor.processPiece(pieceId)
        void refreshPlan()
        await navigate(`/pieces/${pieceId}/processing`)
        return true
      })
      if (started === undefined) {
        // Refused: a piece made by this try that cannot be read is no use to the user, and would take one of the pieces stored.
        if (madeNow !== null) {
          created.current = null
          await data.deletePiece(madeNow).catch(() => undefined)
        }
        setSubmitting(false)
      }
    } catch (error) {
      const sentence = sentenceOf(error)
      if (sentence === SPLIT_EXPIRED) split.expire()
      else {
        setStartSentence(sentence)
        setStartFailed(true)
      }
      setSubmitting(false)
    } finally {
      busy.current = false
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy.current) return
    setStartFailed(false)
    setAttempted(true)
    const pending = split.active && split.stage !== 'confirmed' && split.stage !== 'idle'
    if (pending || Object.keys(validate()).length > 0) {
      setFocusRequest((count) => count + 1)
      return
    }
    void start()
  }

  const recordingError = errors.recording === undefined ? undefined : errorText(errors.recording)

  return (
    <PageColumn width="narrow" className="min-h-[calc(100dvh-4rem)]">
      <TopBar />
      <div>
        <BackLink />
      </div>
      <h1 className="text-4xl leading-[1.3] font-bold tracking-[-0.01em]">{t.title}</h1>

      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-1 flex-col gap-7">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${ids}-title`} className={labelClass}>
              {t.titleLabel}
            </Label>
            {features.suggestName && (
              <SuggestNameButton
                busy={suggestion.busy}
                disabled={clues.recording === null && clues.firstPart === null}
                onClick={() => void suggestion.suggest()}
                className="-my-2"
              />
            )}
          </div>
          <Input
            id={`${ids}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoComplete="off"
            aria-invalid={errors.title === undefined ? undefined : true}
            aria-describedby={errors.title === undefined ? undefined : titleErrorId}
            className={`${fieldClass} border-border-strong text-lg md:text-lg`}
          />
          {errors.title !== undefined && (
            <p id={titleErrorId} className="text-sm text-problem">
              {errorText(errors.title)}
            </p>
          )}
          <SuggestionNote note={suggestion.note} />
        </div>

        <div role="group" aria-labelledby={recordingLabelId} className="flex flex-col gap-3">
          <span id={recordingLabelId} className={labelClass}>
            {t.recordingLabel}
          </span>
          <AudioPicker
            file={audioFile}
            onChange={(file) => void chooseAudio(file)}
            invalid={recordingError !== undefined}
            errorId={recordingError === undefined ? undefined : recordingErrorId}
          />
          {recordingError !== undefined && (
            <p id={recordingErrorId} className="text-sm text-problem">
              {recordingError}
            </p>
          )}
          {planState !== null && !planState.is_admin && planState.plan.recording_minutes_max !== null && (
            <p className="text-[13px] leading-[1.3] text-text-muted">{strings.plans.recordingHint(planState.plan.name, planState.plan.recording_minutes_max)}</p>
          )}
        </div>

        <div role="group" aria-labelledby={partsLabelId} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span id={partsLabelId} className={labelClass}>
              {t.partsLabel}
            </span>
            <span className="text-[13px] leading-[1.3] text-text-muted">{split.active ? strings.split.hint : t.partsHint}</span>
          </div>
          <PartsPicker rows={rows} split={split} errors={errors} attempted={attempted} />
        </div>

        <div className="mt-auto flex flex-col gap-3">
          {startFailed && (
            <p role="alert" className="rounded-lg border border-problem-border bg-problem-bg px-4 py-3 text-sm text-problem">
              {startSentence ?? t.startFailed}
            </p>
          )}
          <Button type="submit" size="xl" disabled={submitting} className="h-14 w-full text-lg">
            <ActionIcon action="upload" />
            {submitting ? t.starting : t.start}
          </Button>
          <p className="text-center text-sm leading-[1.3] text-text-muted">{t.startNote}</p>
        </div>
      </form>
    </PageColumn>
  )
}
