// Whitespace and control characters are refused anywhere: browsers strip tabs and newlines from a URL, which would turn
// "/\t/evil.com" into "//evil.com". A backslash is refused anywhere because browsers read it as a slash.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\s\\\u0000-\u001f]/

/** The return path after sign-in, only if it stays on this site; null otherwise, and the app goes to /library. */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.startsWith('//') || UNSAFE.test(raw)) return null
  return raw
}
