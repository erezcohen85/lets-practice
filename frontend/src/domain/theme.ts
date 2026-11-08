/** The two looks of the app. Dark is the default; light is a per-user choice in Settings (UX polish, Erez 2026-11-06). */
export type Theme = 'dark' | 'light'
export const THEMES: readonly Theme[] = ['dark', 'light']

// The pages that are always dark: the landing page, the terms and the public demo, whoever is looking at them.
const ALWAYS_DARK = ['/', '/terms', '/demo']

/** The theme a page is shown in. `userTheme` is the signed-in user's own setting, or null when nobody is signed in. */
export function themeFor(pathname: string, userTheme: Theme | null): Theme {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (ALWAYS_DARK.some((dark) => path === dark || (dark !== '/' && path.startsWith(`${dark}/`)))) return 'dark'
  return userTheme ?? 'dark'
}
