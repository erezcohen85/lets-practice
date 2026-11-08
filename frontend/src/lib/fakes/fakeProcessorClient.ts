import { partNameFromFile } from '@/domain/newPiece'
import { recordingNameFromFile } from '@/domain/names'
import { type JobKind } from '@/domain/types'
import { type DataClient } from '@/lib/dataClient'
import { claimFakeSample } from '@/lib/fakes/fakeSample'
import { fakeProposal } from '@/lib/fakes/fakeSplit'
import { addJob, fillTiming, partsOf, planRowOf, planStateOf, recordUsage, requireAllowed, requireOwnPiece, requireUser, type FakeStore } from '@/lib/fakes/store'
import { PlanLimitError } from '@/lib/processorClient'
import { type NameSuggestion, type ProcessorClient } from '@/lib/processorClient'

/** The fakes' stand-in for the AI: the name from what there is, as the real fallback does, said to come from the model. */
const NO_KEY_NOTE = 'There is no Anthropic API key. Used the audio file\'s name instead.'

/** The processor client on the in-memory store: it starts jobs that the reads of the data client then move on. */
export function createFakeProcessorClient(store: FakeStore, data: DataClient): ProcessorClient {
  function startJob(pieceId: string, kind: JobKind) {
    requireOwnPiece(store, requireUser(store), pieceId)
    return { ...addJob(store, pieceId, kind).job }
  }

  return {
    async processPiece(pieceId) {
      const user = requireUser(store)
      const piece = requireOwnPiece(store, user, pieceId)
      const parts = partsOf(store, pieceId)
      const plan = planRowOf(store, user)
      const ticked = parts.filter((part) => part.boxCheck === true)
      try {
        // What the processor checks before any tool runs, with what the fake knows by now (a part's pages and the recording's length are known only after a first reading).
        if (!planStateOf(store, user).is_admin) {
          if (plan.pages_per_part_max !== null && parts.some((part) => part.pageCount > plan.pages_per_part_max!)) throw new PlanLimitError('pages_per_part_max')
          if (piece.durationSec !== null) requireAllowed(store, user, { type: 'recording', seconds: piece.durationSec })
          if (ticked.length > 0) requireAllowed(store, user, { type: 'advancedReading', parts: ticked.length })
        }
      } catch (error) {
        // A refused first processing gives the piece slot back (ruling 1 of the plan).
        if (error instanceof PlanLimitError) for (const event of store.usageEvents) if (event.kind === 'piece_created' && event.pieceId === pieceId) event.voidedAt ??= new Date().toISOString()
        throw error
      }
      // The ticked parts are Advanced Reading parts the month counts (the processor records them as the job starts).
      for (const part of ticked) recordUsage(store, user, 'advanced_reading_part', pieceId, part.id)
      return startJob(pieceId, 'process-piece')
    },

    async realign(pieceId) {
      const user = requireUser(store)
      requireOwnPiece(store, user, pieceId)
      requireAllowed(store, user, { type: 'realign' }, pieceId)
      recordUsage(store, user, 'realign', pieceId)
      return startJob(pieceId, 'realign')
    },

    async fillEmptyBars(pieceId, timing) {
      requireOwnPiece(store, requireUser(store), pieceId)
      return fillTiming(store, pieceId, timing)
    },

    async addParts(pieceId, parts) {
      const user = requireUser(store)
      requireOwnPiece(store, user, pieceId)
      // The files go in through the data client, as the real processor client uploads them before it calls the service.
      const before = new Set(partsOf(store, pieceId).map((part) => part.id))
      if (parts.length > 0) await data.storeParts(pieceId, parts)
      const ticked = partsOf(store, pieceId).filter((part) => !before.has(part.id) && part.boxCheck === true)
      if (ticked.length > 0) requireAllowed(store, user, { type: 'advancedReading', parts: ticked.length })
      for (const part of ticked) recordUsage(store, user, 'advanced_reading_part', pieceId, part.id)
      return startJob(pieceId, 'add-parts')
    },

    async reprocessPart(pieceId, partId, { boxCheck }) {
      const user = requireUser(store)
      requireOwnPiece(store, user, pieceId)
      const part = store.parts.get(partId)
      if (part?.pieceId !== pieceId) throw new Error('part not found')
      requireAllowed(store, user, { type: 'readAgain', partId }, pieceId)
      if (boxCheck) requireAllowed(store, user, { type: 'advancedReading', parts: 1 })
      recordUsage(store, user, 'read_again', pieceId, partId)
      if (boxCheck) recordUsage(store, user, 'advanced_reading_part', pieceId, partId)
      // The part is read again: its pages and bar boxes go, and the add-parts job gives it new ones. Its id, name and place stay.
      store.maps.get(pieceId)?.pages.delete(partId)
      store.pageImages.delete(partId)
      part.pageCount = 0
      store.reprocessed.push({ pieceId, partId, boxCheck })
      return startJob(pieceId, 'add-parts')
    },

    async readPartName(pdf) {
      requireUser(store)
      return pdf.name.includes('unreadable') ? null : partNameFromFile(pdf.name)
    },

    async proposeSplit(pdf) {
      requireAllowed(store, requireUser(store), { type: 'splitPdf' })
      return fakeProposal(store, pdf)
    },

    async claimSamplePiece() {
      return claimFakeSample(store, requireUser(store))
    },

    async suggestPieceName(pieceId) {
      const user = requireUser(store)
      const piece = requireOwnPiece(store, user, pieceId)
      requireAllowed(store, user, { type: 'suggestName' })
      return fakeSuggestion(piece.title, store.recordings.get(pieceId)?.kind === 'file' ? `${piece.title}.mp3` : null)
    },

    async suggestNewPieceName({ recording, firstPart }) {
      requireAllowed(store, requireUser(store), { type: 'suggestName' })
      const fileName = recording?.kind === 'file' ? recording.file.name : (firstPart?.name ?? null)
      return fakeSuggestion(null, fileName)
    },
  }
}

/** A name made as the real suggestion's fallback does (a file name read as words); a name with "nokey" in it is told to be the fallback. */
function fakeSuggestion(current: string | null, fileName: string | null): NameSuggestion {
  const name = fileName === null ? (current ?? '') : recordingNameFromFile(fileName).replace(/[_-]+/g, ' ').trim()
  if (name === '') return { name: '', source: 'fallback', note: 'There was no title or file name to use.' }
  return name.includes('nokey') ? { name, source: 'fallback', note: NO_KEY_NOTE } : { name, source: 'claude', note: null }
}
