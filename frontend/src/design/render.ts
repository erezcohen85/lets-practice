// Pure renderers from the token source to the generated files. No file access here:
// scripts/generate-tokens.ts writes the results, tokens.test.ts checks they have not drifted.
import type { ColorRoles, FlagName, ThemeName, Tokens } from './tokens.ts'

// surface2 -> surface-2, borderStrong -> border-strong, beatCount -> beat-count
function kebab(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-z])(\d)/g, '$1-$2')
    .toLowerCase()
}

// Also used by TokenShowcase to name the variable behind each swatch.
export const varName = (...parts: string[]): string => `--lp-${parts.map(kebab).join('-')}`

const flagNames = (t: Tokens): FlagName[] => Object.keys(t.flags.dark) as FlagName[]

type Declaration = [name: string, value: string]

const px = (value: number): string => `${value}px`

function colourDeclarations(t: Tokens, theme: ThemeName): Declaration[] {
  return Object.entries(t.color[theme]).map(([key, value]) => [varName(key), value])
}

function flagDeclarations(t: Tokens, theme: ThemeName): Declaration[] {
  return flagNames(t).flatMap((flag): Declaration[] => [
    [varName('flag', flag, 'bg'), t.flags[theme][flag].bg],
    [varName('flag', flag, 'text'), t.flags[theme][flag].text],
  ])
}

function waveDeclarations(t: Tokens, theme: ThemeName): Declaration[] {
  return (['low', 'mid', 'high'] as const).map((level): Declaration => [varName('wave', level), t.wave[level][theme]])
}

// The glow of the big coloured buttons: strength and hover strength as a percentage, reach as a length.
function glowDeclarations(t: Tokens, theme: ThemeName): Declaration[] {
  const glow = t.glow[theme]
  return [
    [varName('glow', 'alpha'), `${glow.strength}%`],
    [varName('glow', 'alpha', 'hover'), `${glow.hoverStrength}%`],
    [varName('glow', 'reach'), px(glow.reach)],
  ]
}

function cursorDeclarations(t: Tokens): Declaration[] {
  return Object.entries(t.cursorColours).map(([name, value]): Declaration => [varName('cursor', name), value])
}

const ms = (value: number): string => `${value}ms`

function block(selector: string, groups: { title: string; declarations: Declaration[] }[]): string {
  const body = groups
    .map(({ title, declarations }) =>
      [`  /* ${title} */`, ...declarations.map(([name, value]) => `  ${name}: ${value};`)].join('\n'),
    )
    .join('\n\n')
  return `${selector} {\n${body}\n}`
}

export function renderCss(t: Tokens): string {
  const root = block(':root', [
    { title: 'Colour roles (dark, the default theme)', declarations: colourDeclarations(t, 'dark') },
    { title: 'Review Queue flag chips (dark)', declarations: flagDeclarations(t, 'dark') },
    {
      title: 'Waveform',
      declarations: [
        ...waveDeclarations(t, 'dark'),
        [varName('wave', 'unplayedOpacity'), String(t.wave.unplayedOpacity)],
      ],
    },
    { title: 'Glow of the big coloured buttons', declarations: glowDeclarations(t, 'dark') },
    {
      title: 'Cursor colours (the choices for the bar box and the gliding line)',
      declarations: cursorDeclarations(t),
    },
    {
      title: 'Aurora (brand moments only)',
      declarations: t.aurora.map((value, i): Declaration => [`--lp-aurora-${i + 1}`, value]),
    },
    { title: 'Font family', declarations: [['--lp-font-sans', t.font.family]] },
    {
      title: 'Type scale',
      declarations: Object.entries(t.font.size).map(([key, value]): Declaration => [`--lp-text-${key}`, px(value)]),
    },
    {
      title: 'Radius',
      declarations: Object.entries(t.radius).map(([key, value]): Declaration => [`--lp-radius-${key}`, px(value)]),
    },
    {
      title: 'Spacing (4px base)',
      declarations: Object.entries(t.space).map(([key, value]): Declaration => [`--lp-space-${key}`, px(value)]),
    },
    {
      title: 'Touch targets',
      declarations: Object.entries(t.touch).map(([key, value]): Declaration => [`--lp-touch-${key}`, px(value)]),
    },
    {
      title: 'Motion',
      declarations: [
        [varName('motion', 'fast'), ms(t.motion.fast)],
        [varName('motion', 'base'), ms(t.motion.base)],
        [varName('motion', 'slow'), ms(t.motion.slow)],
        [varName('motion', 'easing'), t.motion.easing],
      ],
    },
  ])

  const light = block('[data-theme="light"]', [
    { title: `Colour roles (light, approved 2026-11-06)`, declarations: colourDeclarations(t, 'light') },
    { title: `Review Queue flag chips (light, approved 2026-11-06)`, declarations: flagDeclarations(t, 'light') },
    { title: 'Waveform (light, palette A1)', declarations: waveDeclarations(t, 'light') },
    { title: 'Glow of the big coloured buttons (light, palette A1)', declarations: glowDeclarations(t, 'light') },
  ])

  const reducedMotion = [
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    '    --lp-motion-fast: 0ms;',
    '    --lp-motion-base: 0ms;',
    '    --lp-motion-slow: 0ms;',
    '  }',
    '}',
  ].join('\n')

  const header = [
    '/* GENERATED FILE. Do not edit by hand.',
    ' * Source: src/design/tokens.ts. Regenerate with `npm run tokens` (run from frontend/). */',
  ].join('\n')

  return `${header}\n\n${root}\n\n${light}\n\n${reducedMotion}\n`
}

// Where each colour role is used. Documentation only: values live in tokens.ts.
const roleUsage: Record<keyof ColorRoles, string> = {
  background: 'App background behind everything.',
  surface: 'Cards, panels and the main surfaces on the background.',
  surface2: 'Raised surfaces: popovers, secondary buttons, inputs.',
  surface3: 'Waveform tracks, done chips, hover and pressed fills.',
  border: 'Hairlines and dividers.',
  borderStrong: 'Input outlines and stronger dividers.',
  text: 'Primary text.',
  textSoft: 'Secondary text and icons.',
  textMuted: 'Hints, captions and disabled-looking text.',
  primary: 'The main action as a fill (Practice, play, confirm, primary buttons). In light it is a pastel: never use it for text, icons or thin lines there.',
  onPrimary: 'Text and icons on the primary colour.',
  primaryStrong:
    'The primary colour as text, an icon or a thin line on a surface: links, Add part, the avatar letter, Speed and Count-in, progress and switches, the focus ring. Dark teal in light, the same as primary in dark.',
  edit: 'The Edit map button and the Edit side of the Practice / Edit switch. Not the loop: the loop keeps its violet.',
  onEdit: 'Label and icon on the Edit map button.',
  loop: 'The practice loop: its bars on the score and its handles in the waveform.',
  loopSoft: 'Loop text and labels on the dark background.',
  loopTint: 'Translucent fill behind the looped bars.',
  loopHandle: 'The drag handles at the loop ends.',
  selected: 'The selected bar in the editor.',
  selectedChipBg: 'Background of the selected-bar chip.',
  selectedChipText: 'Text of the selected-bar chip.',
  anchor: 'Confirmed or resolved: anchored bars, done states, and the green text "Ready to practice". Readable as text in both themes.',
  onAnchor: 'Text and icons on a solid anchor fill (a done step).',
  problem: 'A bar that needs fixing. Editor only, never in Practice.',
  problemBg: 'Background of problem rows and chips. Editor only.',
  problemBorder: 'Border of problem rows and chips. Editor only.',
  danger: 'Solid red buttons that do something hard to undo (Reset link, Remove). Same in both themes.',
  onDanger: 'Text and icons on the danger colour.',
  dangerBright: 'Edit piece structure switch when on, the member trash icon and their tints, the muted music icon.',
  share: 'The pink Share button of the piece hub.',
  onShare: 'Label and icon on the Share button.',
  moved: 'A bar the player moved by hand in the editor.',
  movedBg: 'Background of moved-bar rows and chips.',
  movedText: 'Text of moved-bar rows and chips.',
  warningBg: 'Hub "needs review" banner background.',
  warningBorder: 'Hub "needs review" banner border.',
  warningText: 'Hub "needs review" banner text.',
  warningTextSoft: 'Hub "needs review" banner secondary text.',
  paper: 'The score page. The score stays white paper in every theme.',
  ink: 'Notation and text printed on the paper.',
  paperCursor: 'The bar box and the gliding line on the paper.',
  paperAnchor: 'Anchored-bar mark on the paper (darker, readable on white).',
  paperSelected: 'Selected-bar box and handles on the paper (darker, readable on white).',
  paperMoved: 'Moved-bar box and mark on the paper (darker, readable on white).',
}

const flagLabel: Record<FlagName, string> = {
  crowded: 'Crowded bar',
  beatCount: 'Beat count',
  weakDownbeat: 'Weak downbeat',
  stretched: 'Stretched bar',
}

const code = (text: string): string => `\`${text}\``

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

function colourTable(t: Tokens, theme: ThemeName): string {
  return table(
    ['Role', 'Value', 'CSS variable', 'Usage'],
    Object.entries(t.color[theme]).map(([key, value]) => [
      code(key),
      code(value),
      code(varName(key)),
      roleUsage[key as keyof ColorRoles],
    ]),
  )
}

function flagTable(t: Tokens): string {
  return table(
    ['Flag', 'Dark background', 'Dark text', 'Light background', 'Light text', 'CSS variables'],
    flagNames(t).map((flag) => [
      `${flagLabel[flag]} (${code(flag)})`,
      code(t.flags.dark[flag].bg),
      code(t.flags.dark[flag].text),
      code(t.flags.light[flag].bg),
      code(t.flags.light[flag].text),
      `${code(varName('flag', flag, 'bg'))}, ${code(varName('flag', flag, 'text'))}`,
    ]),
  )
}

function valueTable(label: string, entries: [key: string, value: number][], cssName: (key: string) => string): string {
  return table(
    [label, 'Value', 'CSS variable'],
    entries.map(([key, value]) => [code(key), `${value}px`, code(cssName(key))]),
  )
}

export function renderDesignMd(t: Tokens): string {
  const lines: string[] = []
  const add = (...parts: string[]) => lines.push(...parts)

  add(
    "# Let's Practice Design System",
    '',
    '> Generated from `src/design/tokens.ts` by `npm run tokens`. Do not edit by hand.',
    '',
    "Let's Practice looks like a bold dark \"C Midnight\" app: a deep navy background, teal as the single main action, " +
      'and DM Sans throughout. The aurora gradient appears only in brand moments. Every functional colour has exactly one ' +
      'role, so a colour on screen always tells the player the same thing. The score always stays white paper, in both ' +
      'themes. Problem colours (rose) exist only in the editor and never appear while practising.',
    '',
    '**Rule: components never hold raw colours. Use the CSS variables below (for example `var(--lp-primary)`); ' +
      'the only place a colour value is written is `src/design/tokens.ts`.**',
    '',
    '## Colour roles: dark (default)',
    '',
    'Dark is the default theme and lives in `:root`.',
    '',
    colourTable(t, 'dark'),
    '',
    '## Colour roles: light (approved 2026-11-06)',
    '',
    'The light theme was approved by Erez on 2026-11-06, with palette A1 ("Soft aurora, with glow") for the buttons, the waveform and ' +
      'the glow. Light applies under `[data-theme="light"]`, which the app sets on the `<html>` element from the signed-in user\'s ' +
      '"Light mode" setting (the landing page, the terms and the demo are always dark). The paper roles are the same in both themes.',
    '',
    colourTable(t, 'light'),
    '',
    '## Review Queue flag chips',
    '',
    'Chips in the editor Review Queue. Editor only. The light values are approved (2026-11-06).',
    '',
    flagTable(t),
    '',
    '## Waveform',
    '',
    `The waveform colour follows the amplitude (0 to 1): low below ${t.wave.midFrom}, mid from ${t.wave.midFrom} up to ` +
      `${t.wave.highFrom}, high from ${t.wave.highFrom} up. Dark has the pastel trio, light the deeper trio of palette A1. ` +
      `The part not yet played is drawn at opacity ${t.wave.unplayedOpacity}.`,
    '',
    table(
      ['Level', 'Dark', 'Light', 'CSS variable'],
      (['low', 'mid', 'high'] as const).map((level) => [
        level[0].toUpperCase() + level.slice(1),
        code(t.wave[level].dark),
        code(t.wave[level].light),
        code(varName('wave', level)),
      ]),
    ),
    '',
    `Unplayed opacity: ${code(String(t.wave.unplayedOpacity))} (${code(varName('wave', 'unplayedOpacity'))}).`,
    '',
    '## Glow',
    '',
    'The filled coloured buttons (Practice, Edit map, Share, the Practice / Edit switch) glow in their own colour. ' +
      'Smaller buttons set a smaller reach of their own; these are the defaults of the big ones.',
    '',
    table(
      ['Theme', 'Strength', 'Strength on hover', 'Reach', 'CSS variables'],
      (['dark', 'light'] as const).map((theme) => [
        theme,
        `${t.glow[theme].strength}%`,
        `${t.glow[theme].hoverStrength}%`,
        `${t.glow[theme].reach}px`,
        `${code(varName('glow', 'alpha'))}, ${code(varName('glow', 'alpha', 'hover'))}, ${code(varName('glow', 'reach'))}`,
      ]),
    ),
    '',
    '## Cursor colours',
    '',
    'The three choices a player has for the box around the playing bar and for the gliding line inside it ' +
      '(Settings). Each is taken from an existing role. The Settings swatches paint with these variables.',
    '',
    table(
      ['Name', 'Value', 'CSS variable'],
      Object.entries(t.cursorColours).map(([name, value]) => [code(name), code(value), code(varName('cursor', name))]),
    ),
    '',
    '## Aurora',
    '',
    'A four-colour gradient for brand moments only (splash, empty states, the start of a piece). ' +
      'Never behind text a player has to read while practising.',
    '',
    table(
      ['Stop', 'Value', 'CSS variable'],
      t.aurora.map((value, i) => [String(i + 1), code(value), code(`--lp-aurora-${i + 1}`)]),
    ),
    '',
    '## Typography',
    '',
    `Font: ${code(t.font.family)} (CSS variable ${code('--lp-font-sans')}). Weights: ${t.font.weights.join(', ')}.`,
    '',
    valueTable('Step', Object.entries(t.font.size), (key) => `--lp-text-${key}`),
    '',
    '## Radius',
    '',
    valueTable('Step', Object.entries(t.radius), (key) => `--lp-radius-${key}`),
    '',
    '## Spacing',
    '',
    'A 4px base grid.',
    '',
    valueTable('Step', Object.entries(t.space), (key) => `--lp-space-${key}`),
    '',
    '## Touch targets',
    '',
    'Minimum size of anything the player taps or clicks.',
    '',
    valueTable('Target', Object.entries(t.touch), (key) => `--lp-touch-${key}`),
    '',
    '## Motion',
    '',
    `Easing ${code(t.motion.easing)}. With \`prefers-reduced-motion: reduce\` all three durations become 0ms.`,
    '',
    table(
      ['Speed', 'Value', 'CSS variable'],
      (['fast', 'base', 'slow'] as const).map((key) => [
        code(key),
        `${t.motion[key]}ms`,
        code(varName('motion', key)),
      ]),
    ),
    '',
    `Easing variable: ${code(varName('motion', 'easing'))}.`,
    '',
    '## Rules',
    '',
    '- Components never hold raw colours; use the `--lp-*` variables.',
    '- Every functional colour has one role; do not reuse a role colour for decoration.',
    '- The score stays white paper (`paper`, `ink`) in every theme.',
    '- Problem colours (`problem`, `problemBg`, `problemBorder`, the flag chips) are editor only.',
    '- The aurora is for brand moments only.',
    '- Touch targets are at least 44px on iPad and 36px on desktop.',
  )

  return `${lines.join('\n')}\n`
}
