// The single design source. Every colour, size and duration the app uses is defined here.
// `npm run tokens` renders this file into tokens.css (CSS variables) and DESIGN.md.
// Components never hold raw colours: they use the --lp-* variables from tokens.css.

export type ThemeName = 'dark' | 'light'

export type ColorRoles = {
  background: string
  surface: string
  surface2: string
  surface3: string
  border: string
  borderStrong: string
  text: string
  textSoft: string
  textMuted: string
  primary: string
  onPrimary: string
  primaryStrong: string
  edit: string
  onEdit: string
  loop: string
  loopSoft: string
  loopTint: string
  loopHandle: string
  selected: string
  selectedChipBg: string
  selectedChipText: string
  anchor: string
  onAnchor: string
  problem: string
  problemBg: string
  problemBorder: string
  danger: string
  onDanger: string
  dangerBright: string
  share: string
  onShare: string
  moved: string
  movedBg: string
  movedText: string
  warningBg: string
  warningBorder: string
  warningText: string
  warningTextSoft: string
  paper: string
  ink: string
  paperCursor: string
  paperAnchor: string
  paperSelected: string
  paperMoved: string
}

export type FlagChip = { bg: string; text: string }

export type FlagName = 'crowded' | 'beatCount' | 'weakDownbeat' | 'stretched'

// The choices for the box around the playing bar and the gliding line (Decision 2026-10-28). The names are the ones
// stored in the user's settings (CursorColour in lib/dataClient.ts).
export type CursorColourName = 'teal' | 'amber' | 'pink' | 'blue'

// The glow of a filled coloured button (palette A1): its own colour at `strength` percent, spread by `reach` px, and
// `hoverStrength` percent while the pointer is on it. Smaller buttons set their own reach in the button classes.
export type Glow = { strength: number; hoverStrength: number; reach: number }

export type Tokens = {
  color: Record<ThemeName, ColorRoles>
  flags: Record<ThemeName, Record<FlagName, FlagChip>>
  wave: {
    low: Record<ThemeName, string>
    mid: Record<ThemeName, string>
    high: Record<ThemeName, string>
    midFrom: number
    highFrom: number
    unplayedOpacity: number
  }
  glow: Record<ThemeName, Glow>
  cursorColours: Record<CursorColourName, string>
  aurora: readonly string[]
  font: {
    family: string
    weights: readonly number[]
    size: Record<'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl', number>
  }
  radius: Record<'sm' | 'md' | 'lg' | 'pill', number>
  space: Record<'1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16', number>
  touch: { ipad: number; desktop: number }
  motion: { fast: number; base: number; slow: number; easing: string }
}

export const tokens: Tokens = {
  color: {
    // Dark is the default theme (C Midnight canvas).
    dark: {
      background: '#0A1220',
      surface: '#111B2E',
      surface2: '#172338',
      surface3: '#1B2840',
      border: '#24324A',
      borderStrong: '#2B3B57',
      text: '#E8EEF8',
      textSoft: '#B5C2D6',
      textMuted: '#8FA0BA',
      primary: '#5EEAD4',
      onPrimary: '#05201C',
      primaryStrong: '#5EEAD4',
      edit: '#A78BFA',
      onEdit: '#0A1220',
      loop: '#A78BFA',
      loopSoft: '#C4B5FD',
      loopTint: 'rgba(167,139,250,0.18)',
      loopHandle: '#8B5CF6',
      selected: '#FBBF24',
      selectedChipBg: '#3A2E0E',
      selectedChipText: '#FDE68A',
      anchor: '#34D399',
      onAnchor: '#05201C',
      problem: '#FDA4AF',
      problemBg: '#3A1A22',
      problemBorder: '#5B2B38',
      danger: '#E11D48',
      onDanger: '#FFFFFF',
      dangerBright: '#F43F5E',
      share: '#F9A8D4',
      onShare: '#0A1220',
      moved: '#5EEAD4',
      movedBg: '#0F3A36',
      movedText: '#99F6E4',
      warningBg: '#2A2310',
      warningBorder: '#5C4A12',
      warningText: '#FDE68A',
      warningTextSoft: '#D9C58A',
      paper: '#FAFAF7',
      ink: '#1A1A1A',
      paperCursor: '#14B8A6',
      paperAnchor: '#059669',
      paperSelected: '#D97706',
      paperMoved: '#0D9488',
    },
    light: {
      background: '#F6F8FC',
      surface: '#FFFFFF',
      surface2: '#EEF2F8',
      surface3: '#E2E8F2',
      border: '#D5DEEC',
      borderStrong: '#B5C2D6',
      text: '#0A1220',
      textSoft: '#2B3B57',
      textMuted: '#5B6B85',
      // Palette A1 (Erez, 2026-11-06): soft pastel buttons with a dark label and a glow of their own colour. Pastel is
      // too pale for text, icons and thin lines on a light surface: those use primaryStrong.
      primary: '#79E0D2',
      onPrimary: '#0A1220',
      primaryStrong: '#0F766E',
      edit: '#BDAAF7',
      onEdit: '#0A1220',
      loop: '#7C3AED',
      loopSoft: '#6D28D9',
      loopTint: 'rgba(124,58,237,0.14)',
      loopHandle: '#7C3AED',
      selected: '#B45309',
      selectedChipBg: '#FEF3C7',
      selectedChipText: '#78350F',
      anchor: '#047857', // readable as text on white (5.5 to 1); the A1 review found #059669 at 3.8
      onAnchor: '#FFFFFF',
      problem: '#E11D48',
      problemBg: '#FFE4E6',
      problemBorder: '#FECDD3',
      danger: '#E11D48',
      onDanger: '#FFFFFF',
      dangerBright: '#F43F5E',
      share: '#F7B4D6', // palette A1
      onShare: '#0A1220',
      moved: '#0D9488',
      movedBg: '#CCFBF1',
      movedText: '#115E59',
      warningBg: '#FEF3C7',
      warningBorder: '#FCD34D',
      warningText: '#78350F',
      warningTextSoft: '#92400E',
      paper: '#FAFAF7',
      ink: '#1A1A1A',
      paperCursor: '#14B8A6',
      paperAnchor: '#059669',
      paperSelected: '#D97706',
      paperMoved: '#0D9488',
    },
  },
  flags: {
    dark: {
      crowded: { bg: '#3A1A22', text: '#FDA4AF' },
      beatCount: { bg: '#231B3D', text: '#C4B5FD' },
      weakDownbeat: { bg: '#173347', text: '#7DD3FC' },
      stretched: { bg: '#3A2E0E', text: '#FDE68A' },
    },
    light: {
      crowded: { bg: '#FFE4E6', text: '#BE123C' },
      beatCount: { bg: '#EDE9FE', text: '#6D28D9' },
      weakDownbeat: { bg: '#E0F2FE', text: '#0369A1' },
      stretched: { bg: '#FEF3C7', text: '#92400E' },
    },
  },
  // Dark keeps the pastel trio; light has the deeper trio of palette A1 (the pastels vanish on a light page).
  wave: {
    low: { dark: '#5EEAD4', light: '#2B9E90' },
    mid: { dark: '#A78BFA', light: '#8A6FE8' },
    high: { dark: '#F9A8D4', light: '#DB5F9F' },
    midFrom: 0.35,
    highFrom: 0.7,
    unplayedOpacity: 0.4,
  },
  glow: {
    dark: { strength: 25, hoverStrength: 38, reach: 40 },
    light: { strength: 70, hoverStrength: 85, reach: 28 },
  },
  // Taken from existing roles (tokens.test.ts checks it): teal is the paper cursor, amber the selected bar, pink the
  // loud end of the waveform. Blue (the prototype's #3B82F6) is a swatch only, no role. The Settings swatches paint with them.
  cursorColours: { teal: '#14B8A6', amber: '#FBBF24', pink: '#F9A8D4', blue: '#3B82F6' },
  aurora: ['#5EEAD4', '#34D399', '#8B5CF6', '#D946EF'],
  font: {
    family: '"DM Sans Variable", "DM Sans", system-ui, sans-serif',
    weights: [400, 500, 600, 700],
    size: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 28, '3xl': 36, '4xl': 56 },
  },
  radius: { sm: 8, md: 12, lg: 16, pill: 9999 },
  space: { '1': 4, '2': 8, '3': 12, '4': 16, '5': 20, '6': 24, '8': 32, '10': 40, '12': 48, '16': 64 },
  touch: { ipad: 44, desktop: 36 },
  motion: { fast: 120, base: 200, slow: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
}

// Waveform colour by amplitude (0 to 1): low below midFrom, mid below highFrom, high from there up.
export function waveColor(amplitude: number, theme: ThemeName = 'dark'): string {
  if (amplitude >= tokens.wave.highFrom) return tokens.wave.high[theme]
  if (amplitude >= tokens.wave.midFrom) return tokens.wave.mid[theme]
  return tokens.wave.low[theme]
}
