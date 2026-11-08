/** How long to wait for a file's metadata before giving up on knowing its length. */
const METADATA_WAIT_MS = 5000

/**
 * The length of an audio file in seconds, read from its metadata with an Audio element (no decoding, no dependency). Null when it
 * cannot be read (an unknown format, no metadata in time, or no way to make an object URL): the caller then skips whatever it
 * wanted the length for, and the processor checks the length again.
 */
export function readAudioSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let url: string
    try {
      url = URL.createObjectURL(file)
    } catch {
      resolve(null)
      return
    }
    const audio = new Audio()
    const timer = setTimeout(() => finish(null), METADATA_WAIT_MS)
    const finish = (seconds: number | null) => {
      clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(seconds)
    }
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null), { once: true })
    audio.addEventListener('error', () => finish(null), { once: true })
    audio.src = url
  })
}
