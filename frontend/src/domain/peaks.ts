/**
 * Reduces peaks (0..1) to at most `count` bars by keeping the loudest peak of each group, so a short loud sound still
 * shows. Groups are as even as they can be; a list that is not longer than `count` comes back as a copy.
 */
export function resamplePeaks(peaks: readonly number[], count: number): number[] {
  if (count <= 0) return []
  if (peaks.length <= count) return [...peaks]
  return Array.from({ length: count }, (_, index) => {
    const from = Math.floor((index * peaks.length) / count)
    const to = Math.floor(((index + 1) * peaks.length) / count)
    return Math.max(...peaks.slice(from, to))
  })
}
