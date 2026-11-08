import { useRef, useState } from 'react'
import { partNameFromFile } from '@/domain/newPiece'
import { type PartRowData } from '@/components/newpiece/PartRow'

// A part is a PDF; the same extension rule as validateNewPiece, so a row can never fail it later.
export const isPdfFile = (file: File) => /\.pdf$/i.test(file.name)

/**
 * The rows of PDF parts that the New piece page and the hub's Add part dialog both fill: files are added (anything that
 * is not a PDF is skipped and named), each row's name is read from its PDF and stays the user's once they type in it.
 */
export function usePartRows(readPartName: (pdf: File) => Promise<string | null>) {
  const [parts, setParts] = useState<PartRowData[]>([])
  const [skipped, setSkipped] = useState<string[]>([])
  const nextKey = useRef(0)
  // The Advanced box check tick, by row key; off for a new row.
  const [boxChecks, setBoxChecks] = useState<ReadonlySet<number>>(new Set())

  async function readName(key: number, file: File) {
    const fallback = partNameFromFile(file.name)
    let name = fallback
    try {
      const read = (await readPartName(file))?.trim()
      if (read) name = read
    } catch {
      // No name could be read: the one made from the file name stands, and the user can change it.
    }
    // A name the user has typed is never overwritten, and a row removed meanwhile stays removed.
    setParts((current) => current.map((part) => (part.key !== key ? part : { ...part, reading: false, name: part.edited ? part.name : name })))
  }

  function addFiles(files: File[]) {
    const pdfs = files.filter(isPdfFile)
    setSkipped(files.filter((file) => !isPdfFile(file)).map((file) => file.name))
    if (pdfs.length === 0) return
    const rows = pdfs.map((file): PartRowData => ({ key: nextKey.current++, file, name: '', reading: true, edited: false }))
    setParts((current) => [...current, ...rows])
    for (const row of rows) void readName(row.key, row.file)
  }

  function changeName(key: number, name: string) {
    setParts((current) => current.map((part) => (part.key === key ? { ...part, name, reading: false, edited: true } : part)))
  }

  function removePart(key: number) {
    setParts((current) => current.filter((part) => part.key !== key))
    setBoxChecks((current) => new Set([...current].filter((tick) => tick !== key)))
  }

  function toggleBoxCheck(key: number) {
    setBoxChecks((current) => new Set(current.has(key) ? [...current].filter((tick) => tick !== key) : [...current, key]))
  }

  return { parts, skipped, boxChecks, addFiles, changeName, removePart, toggleBoxCheck }
}

export type PartRows = ReturnType<typeof usePartRows>

/**
 * The name the user typed for a row, trimmed; '' when they did not (or cleared it). The name shown from a read or from
 * the file name is only a first guess: the data client names such a part from its file, and the processing from its header.
 */
export function typedName(part: PartRowData): string {
  return part.edited ? part.name.trim() : ''
}
