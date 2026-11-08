/** Hands a text to the browser as a file: a Blob behind a temporary link that is clicked once. Tests replace this module. */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // The browser has taken the file by the next tick.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
