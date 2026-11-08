import { useRef, useState } from 'react'
import {
  mergeWithNext,
  moveBoundary,
  numberDuplicates,
  partsToKeep,
  renameSplitPart,
  setKeep,
  splitAtPage,
  toggleSkipPage,
  SPLIT_EXPIRED,
  keptCount,
  type SplitPart,
  type SplitProposal,
} from '@/domain/splitEdits'
import { type SplitUpload } from '@/lib/dataClient'
import { sentenceOf } from '@/lib/processorClient'
import { strings } from '@/strings'

/**
 * Where the "one PDF with several parts" choice stands: nothing chosen, the pages being read, the split screen open,
 * a full-score PDF refused, or the parts confirmed and back in the form.
 */
export type SplitStage = 'idle' | 'reading' | 'review' | 'full-score' | 'confirmed'

const isPdfFile = (file: File) => /\.pdf$/i.test(file.name)

/**
 * The state of the "one PDF with several parts" choice that New piece and Add part share: the mode switch, the PDF given
 * to the processor to read, and the parts of its proposal as the user edits them. `upload()` is what the form sends once the
 * parts are confirmed.
 */
export function useSplitChoice(propose: (pdf: File) => Promise<SplitProposal>) {
  const [active, setActive] = useState(false)
  const [stage, setStage] = useState<SplitStage>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [proposal, setProposal] = useState<SplitProposal | null>(null)
  const [parts, setParts] = useState<SplitPart[]>([])
  const [error, setError] = useState<string | null>(null)
  // The Advanced box check tick, by index in `parts`; cleared whenever the parts are edited again.
  const [boxChecks, setBoxChecks] = useState<ReadonlySet<number>>(new Set())
  // A PDF chosen while another is being read replaces it: the older answer is dropped when it comes.
  const latest = useRef(0)

  function discard(sentence: string | null = null) {
    latest.current += 1
    setStage('idle')
    setFile(null)
    setProposal(null)
    setParts([])
    setBoxChecks(new Set())
    setError(sentence)
  }

  async function choose(files: File[]) {
    const chosen = files.find(isPdfFile)
    if (chosen === undefined) {
      if (files.length > 0) setError(strings.split.notPdf)
      return
    }
    const mine = ++latest.current
    setError(null)
    setFile(chosen)
    setStage('reading')
    try {
      const read = await propose(chosen)
      if (latest.current !== mine) return
      setProposal(read)
      setParts(numberDuplicates(read.parts.map((part) => ({ ...part, keep: true, skipPages: [] }))))
      setStage(read.fullScore ? 'full-score' : 'review')
    } catch (failure) {
      if (latest.current !== mine) return
      setStage('idle')
      setFile(null)
      setError(sentenceOf(failure) ?? strings.split.readFailed)
    }
  }

  /** Unticking the last kept part of the confirmed parts leaves nothing to send: the choice starts over. */
  function removeConfirmed(index: number) {
    const next = setKeep(parts, index, false)
    if (keptCount(next) === 0) discard()
    else setParts(next)
  }

  const edit = (change: (current: SplitPart[]) => SplitPart[]) => setParts((current) => change(current))

  return {
    active,
    setActive,
    stage,
    file,
    proposal,
    parts,
    error,
    choose,
    // Two parts renamed alike are told apart again before they are sent.
    confirm: () => {
      setParts((current) => numberDuplicates(current))
      setStage('confirmed')
    },
    reopen: () => {
      setBoxChecks(new Set())
      setStage('review')
    },
    boxChecks,
    toggleBoxCheck: (index: number) =>
      setBoxChecks((current) => new Set(current.has(index) ? [...current].filter((tick) => tick !== index) : [...current, index])),
    discard,
    removeConfirmed,
    rename: (index: number, name: string) => edit((current) => renameSplitPart(current, index, name)),
    keep: (index: number, keep: boolean) => edit((current) => setKeep(current, index, keep)),
    move: (index: number, direction: 1 | -1) => edit((current) => moveBoundary(current, index, direction)),
    merge: (index: number) => edit((current) => mergeWithNext(current, index)),
    splitAt: (index: number, page: number) => edit((current) => splitAtPage(current, index, page)),
    /** Drops the page from part `index`, or puts it back. */
    toggleSkip: (index: number, page: number) => edit((current) => toggleSkipPage(current, index, page)),
    /** The staged split has gone (the processor keeps it a day): back to choosing the PDF, with the processor's sentence. */
    expire: () => discard(SPLIT_EXPIRED),
    /** What the form sends, once the parts are confirmed in the several-parts mode; otherwise undefined. */
    upload(): SplitUpload | undefined {
      if (!active || stage !== 'confirmed' || proposal === null || file === null) return undefined
      const boxChecksOfKept = parts.flatMap((part, index) => (part.keep ? [boxChecks.has(index)] : []))
      return {
        splitId: proposal.splitId,
        fileName: file.name,
        parts: partsToKeep(parts),
        ...(boxChecksOfKept.some(Boolean) ? { boxChecks: boxChecksOfKept } : {}),
      }
    },
  }
}

export type SplitChoice = ReturnType<typeof useSplitChoice>
