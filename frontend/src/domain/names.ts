/** The longest a part's name may be (score_files.name). */
export const MAX_PART_NAME = 80
/** The longest a recording's name may be (audio_sources.name, migration 0005). */
export const MAX_RECORDING_NAME = 120
/** The longest a piece's title may be: the rename dialog and the data clients refuse more (the database has no limit of its own). */
export const MAX_PIECE_TITLE = 200

export type NameProblem = 'empty' | 'too-long'

/** A name as a rename saves it: trimmed, 1 to `max` characters. */
export function checkName(raw: string, max: number): { name: string } | { problem: NameProblem } {
  const name = raw.trim()
  if (name === '') return { problem: 'empty' }
  return name.length > max ? { problem: 'too-long' } : { name }
}

/** The trimmed name, or an Error that says why a rename was refused (what a database check would do): for the data clients. */
export function requireName(raw: string, max: number): string {
  const checked = checkName(raw, max)
  if ('problem' in checked) throw new Error(checked.problem === 'empty' ? 'name is empty' : 'name is too long')
  return checked.name
}

/** "Los Banditos 2019.mp3" → "Los Banditos 2019": what an uploaded recording is called until it is renamed. */
export function recordingNameFromFile(fileName: string): string {
  return fileName.replace(/(?<=.)\.[A-Za-z0-9]{1,5}$/, '').trim().slice(0, MAX_RECORDING_NAME)
}
