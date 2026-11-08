# Let's Practice Design System

> Generated from `src/design/tokens.ts` by `npm run tokens`. Do not edit by hand.

Let's Practice looks like a bold dark "C Midnight" app: a deep navy background, teal as the single main action, and DM Sans throughout. The aurora gradient appears only in brand moments. Every functional colour has exactly one role, so a colour on screen always tells the player the same thing. The score always stays white paper, in both themes. Problem colours (rose) exist only in the editor and never appear while practising.

**Rule: components never hold raw colours. Use the CSS variables below (for example `var(--lp-primary)`); the only place a colour value is written is `src/design/tokens.ts`.**

## Colour roles: dark (default)

Dark is the default theme and lives in `:root`.

| Role | Value | CSS variable | Usage |
| --- | --- | --- | --- |
| `background` | `#0A1220` | `--lp-background` | App background behind everything. |
| `surface` | `#111B2E` | `--lp-surface` | Cards, panels and the main surfaces on the background. |
| `surface2` | `#172338` | `--lp-surface-2` | Raised surfaces: popovers, secondary buttons, inputs. |
| `surface3` | `#1B2840` | `--lp-surface-3` | Waveform tracks, done chips, hover and pressed fills. |
| `border` | `#24324A` | `--lp-border` | Hairlines and dividers. |
| `borderStrong` | `#2B3B57` | `--lp-border-strong` | Input outlines and stronger dividers. |
| `text` | `#E8EEF8` | `--lp-text` | Primary text. |
| `textSoft` | `#B5C2D6` | `--lp-text-soft` | Secondary text and icons. |
| `textMuted` | `#8FA0BA` | `--lp-text-muted` | Hints, captions and disabled-looking text. |
| `primary` | `#5EEAD4` | `--lp-primary` | The main action as a fill (Practice, play, confirm, primary buttons). In light it is a pastel: never use it for text, icons or thin lines there. |
| `onPrimary` | `#05201C` | `--lp-on-primary` | Text and icons on the primary colour. |
| `primaryStrong` | `#5EEAD4` | `--lp-primary-strong` | The primary colour as text, an icon or a thin line on a surface: links, Add part, the avatar letter, Speed and Count-in, progress and switches, the focus ring. Dark teal in light, the same as primary in dark. |
| `edit` | `#A78BFA` | `--lp-edit` | The Edit map button and the Edit side of the Practice / Edit switch. Not the loop: the loop keeps its violet. |
| `onEdit` | `#0A1220` | `--lp-on-edit` | Label and icon on the Edit map button. |
| `loop` | `#A78BFA` | `--lp-loop` | The practice loop: its bars on the score and its handles in the waveform. |
| `loopSoft` | `#C4B5FD` | `--lp-loop-soft` | Loop text and labels on the dark background. |
| `loopTint` | `rgba(167,139,250,0.18)` | `--lp-loop-tint` | Translucent fill behind the looped bars. |
| `loopHandle` | `#8B5CF6` | `--lp-loop-handle` | The drag handles at the loop ends. |
| `selected` | `#FBBF24` | `--lp-selected` | The selected bar in the editor. |
| `selectedChipBg` | `#3A2E0E` | `--lp-selected-chip-bg` | Background of the selected-bar chip. |
| `selectedChipText` | `#FDE68A` | `--lp-selected-chip-text` | Text of the selected-bar chip. |
| `anchor` | `#34D399` | `--lp-anchor` | Confirmed or resolved: anchored bars, done states, and the green text "Ready to practice". Readable as text in both themes. |
| `onAnchor` | `#05201C` | `--lp-on-anchor` | Text and icons on a solid anchor fill (a done step). |
| `problem` | `#FDA4AF` | `--lp-problem` | A bar that needs fixing. Editor only, never in Practice. |
| `problemBg` | `#3A1A22` | `--lp-problem-bg` | Background of problem rows and chips. Editor only. |
| `problemBorder` | `#5B2B38` | `--lp-problem-border` | Border of problem rows and chips. Editor only. |
| `danger` | `#E11D48` | `--lp-danger` | Solid red buttons that do something hard to undo (Reset link, Remove). Same in both themes. |
| `onDanger` | `#FFFFFF` | `--lp-on-danger` | Text and icons on the danger colour. |
| `dangerBright` | `#F43F5E` | `--lp-danger-bright` | Edit piece structure switch when on, the member trash icon and their tints, the muted music icon. |
| `share` | `#F9A8D4` | `--lp-share` | The pink Share button of the piece hub. |
| `onShare` | `#0A1220` | `--lp-on-share` | Label and icon on the Share button. |
| `moved` | `#5EEAD4` | `--lp-moved` | A bar the player moved by hand in the editor. |
| `movedBg` | `#0F3A36` | `--lp-moved-bg` | Background of moved-bar rows and chips. |
| `movedText` | `#99F6E4` | `--lp-moved-text` | Text of moved-bar rows and chips. |
| `warningBg` | `#2A2310` | `--lp-warning-bg` | Hub "needs review" banner background. |
| `warningBorder` | `#5C4A12` | `--lp-warning-border` | Hub "needs review" banner border. |
| `warningText` | `#FDE68A` | `--lp-warning-text` | Hub "needs review" banner text. |
| `warningTextSoft` | `#D9C58A` | `--lp-warning-text-soft` | Hub "needs review" banner secondary text. |
| `paper` | `#FAFAF7` | `--lp-paper` | The score page. The score stays white paper in every theme. |
| `ink` | `#1A1A1A` | `--lp-ink` | Notation and text printed on the paper. |
| `paperCursor` | `#14B8A6` | `--lp-paper-cursor` | The bar box and the gliding line on the paper. |
| `paperAnchor` | `#059669` | `--lp-paper-anchor` | Anchored-bar mark on the paper (darker, readable on white). |
| `paperSelected` | `#D97706` | `--lp-paper-selected` | Selected-bar box and handles on the paper (darker, readable on white). |
| `paperMoved` | `#0D9488` | `--lp-paper-moved` | Moved-bar box and mark on the paper (darker, readable on white). |

## Colour roles: light (approved 2026-11-06)

The light theme was approved by Erez on 2026-11-06, with palette A1 ("Soft aurora, with glow") for the buttons, the waveform and the glow. Light applies under `[data-theme="light"]`, which the app sets on the `<html>` element from the signed-in user's "Light mode" setting (the landing page, the terms and the demo are always dark). The paper roles are the same in both themes.

| Role | Value | CSS variable | Usage |
| --- | --- | --- | --- |
| `background` | `#F6F8FC` | `--lp-background` | App background behind everything. |
| `surface` | `#FFFFFF` | `--lp-surface` | Cards, panels and the main surfaces on the background. |
| `surface2` | `#EEF2F8` | `--lp-surface-2` | Raised surfaces: popovers, secondary buttons, inputs. |
| `surface3` | `#E2E8F2` | `--lp-surface-3` | Waveform tracks, done chips, hover and pressed fills. |
| `border` | `#D5DEEC` | `--lp-border` | Hairlines and dividers. |
| `borderStrong` | `#B5C2D6` | `--lp-border-strong` | Input outlines and stronger dividers. |
| `text` | `#0A1220` | `--lp-text` | Primary text. |
| `textSoft` | `#2B3B57` | `--lp-text-soft` | Secondary text and icons. |
| `textMuted` | `#5B6B85` | `--lp-text-muted` | Hints, captions and disabled-looking text. |
| `primary` | `#79E0D2` | `--lp-primary` | The main action as a fill (Practice, play, confirm, primary buttons). In light it is a pastel: never use it for text, icons or thin lines there. |
| `onPrimary` | `#0A1220` | `--lp-on-primary` | Text and icons on the primary colour. |
| `primaryStrong` | `#0F766E` | `--lp-primary-strong` | The primary colour as text, an icon or a thin line on a surface: links, Add part, the avatar letter, Speed and Count-in, progress and switches, the focus ring. Dark teal in light, the same as primary in dark. |
| `edit` | `#BDAAF7` | `--lp-edit` | The Edit map button and the Edit side of the Practice / Edit switch. Not the loop: the loop keeps its violet. |
| `onEdit` | `#0A1220` | `--lp-on-edit` | Label and icon on the Edit map button. |
| `loop` | `#7C3AED` | `--lp-loop` | The practice loop: its bars on the score and its handles in the waveform. |
| `loopSoft` | `#6D28D9` | `--lp-loop-soft` | Loop text and labels on the dark background. |
| `loopTint` | `rgba(124,58,237,0.14)` | `--lp-loop-tint` | Translucent fill behind the looped bars. |
| `loopHandle` | `#7C3AED` | `--lp-loop-handle` | The drag handles at the loop ends. |
| `selected` | `#B45309` | `--lp-selected` | The selected bar in the editor. |
| `selectedChipBg` | `#FEF3C7` | `--lp-selected-chip-bg` | Background of the selected-bar chip. |
| `selectedChipText` | `#78350F` | `--lp-selected-chip-text` | Text of the selected-bar chip. |
| `anchor` | `#047857` | `--lp-anchor` | Confirmed or resolved: anchored bars, done states, and the green text "Ready to practice". Readable as text in both themes. |
| `onAnchor` | `#FFFFFF` | `--lp-on-anchor` | Text and icons on a solid anchor fill (a done step). |
| `problem` | `#E11D48` | `--lp-problem` | A bar that needs fixing. Editor only, never in Practice. |
| `problemBg` | `#FFE4E6` | `--lp-problem-bg` | Background of problem rows and chips. Editor only. |
| `problemBorder` | `#FECDD3` | `--lp-problem-border` | Border of problem rows and chips. Editor only. |
| `danger` | `#E11D48` | `--lp-danger` | Solid red buttons that do something hard to undo (Reset link, Remove). Same in both themes. |
| `onDanger` | `#FFFFFF` | `--lp-on-danger` | Text and icons on the danger colour. |
| `dangerBright` | `#F43F5E` | `--lp-danger-bright` | Edit piece structure switch when on, the member trash icon and their tints, the muted music icon. |
| `share` | `#F7B4D6` | `--lp-share` | The pink Share button of the piece hub. |
| `onShare` | `#0A1220` | `--lp-on-share` | Label and icon on the Share button. |
| `moved` | `#0D9488` | `--lp-moved` | A bar the player moved by hand in the editor. |
| `movedBg` | `#CCFBF1` | `--lp-moved-bg` | Background of moved-bar rows and chips. |
| `movedText` | `#115E59` | `--lp-moved-text` | Text of moved-bar rows and chips. |
| `warningBg` | `#FEF3C7` | `--lp-warning-bg` | Hub "needs review" banner background. |
| `warningBorder` | `#FCD34D` | `--lp-warning-border` | Hub "needs review" banner border. |
| `warningText` | `#78350F` | `--lp-warning-text` | Hub "needs review" banner text. |
| `warningTextSoft` | `#92400E` | `--lp-warning-text-soft` | Hub "needs review" banner secondary text. |
| `paper` | `#FAFAF7` | `--lp-paper` | The score page. The score stays white paper in every theme. |
| `ink` | `#1A1A1A` | `--lp-ink` | Notation and text printed on the paper. |
| `paperCursor` | `#14B8A6` | `--lp-paper-cursor` | The bar box and the gliding line on the paper. |
| `paperAnchor` | `#059669` | `--lp-paper-anchor` | Anchored-bar mark on the paper (darker, readable on white). |
| `paperSelected` | `#D97706` | `--lp-paper-selected` | Selected-bar box and handles on the paper (darker, readable on white). |
| `paperMoved` | `#0D9488` | `--lp-paper-moved` | Moved-bar box and mark on the paper (darker, readable on white). |

## Review Queue flag chips

Chips in the editor Review Queue. Editor only. The light values are approved (2026-11-06).

| Flag | Dark background | Dark text | Light background | Light text | CSS variables |
| --- | --- | --- | --- | --- | --- |
| Crowded bar (`crowded`) | `#3A1A22` | `#FDA4AF` | `#FFE4E6` | `#BE123C` | `--lp-flag-crowded-bg`, `--lp-flag-crowded-text` |
| Beat count (`beatCount`) | `#231B3D` | `#C4B5FD` | `#EDE9FE` | `#6D28D9` | `--lp-flag-beat-count-bg`, `--lp-flag-beat-count-text` |
| Weak downbeat (`weakDownbeat`) | `#173347` | `#7DD3FC` | `#E0F2FE` | `#0369A1` | `--lp-flag-weak-downbeat-bg`, `--lp-flag-weak-downbeat-text` |
| Stretched bar (`stretched`) | `#3A2E0E` | `#FDE68A` | `#FEF3C7` | `#92400E` | `--lp-flag-stretched-bg`, `--lp-flag-stretched-text` |

## Waveform

The waveform colour follows the amplitude (0 to 1): low below 0.35, mid from 0.35 up to 0.7, high from 0.7 up. Dark has the pastel trio, light the deeper trio of palette A1. The part not yet played is drawn at opacity 0.4.

| Level | Dark | Light | CSS variable |
| --- | --- | --- | --- |
| Low | `#5EEAD4` | `#2B9E90` | `--lp-wave-low` |
| Mid | `#A78BFA` | `#8A6FE8` | `--lp-wave-mid` |
| High | `#F9A8D4` | `#DB5F9F` | `--lp-wave-high` |

Unplayed opacity: `0.4` (`--lp-wave-unplayed-opacity`).

## Glow

The filled coloured buttons (Practice, Edit map, Share, the Practice / Edit switch) glow in their own colour. Smaller buttons set a smaller reach of their own; these are the defaults of the big ones.

| Theme | Strength | Strength on hover | Reach | CSS variables |
| --- | --- | --- | --- | --- |
| dark | 25% | 38% | 40px | `--lp-glow-alpha`, `--lp-glow-alpha-hover`, `--lp-glow-reach` |
| light | 70% | 85% | 28px | `--lp-glow-alpha`, `--lp-glow-alpha-hover`, `--lp-glow-reach` |

## Cursor colours

The three choices a player has for the box around the playing bar and for the gliding line inside it (Settings). Each is taken from an existing role. The Settings swatches paint with these variables.

| Name | Value | CSS variable |
| --- | --- | --- |
| `teal` | `#14B8A6` | `--lp-cursor-teal` |
| `amber` | `#FBBF24` | `--lp-cursor-amber` |
| `pink` | `#F9A8D4` | `--lp-cursor-pink` |
| `blue` | `#3B82F6` | `--lp-cursor-blue` |

## Aurora

A four-colour gradient for brand moments only (splash, empty states, the start of a piece). Never behind text a player has to read while practising.

| Stop | Value | CSS variable |
| --- | --- | --- |
| 1 | `#5EEAD4` | `--lp-aurora-1` |
| 2 | `#34D399` | `--lp-aurora-2` |
| 3 | `#8B5CF6` | `--lp-aurora-3` |
| 4 | `#D946EF` | `--lp-aurora-4` |

## Typography

Font: `"DM Sans Variable", "DM Sans", system-ui, sans-serif` (CSS variable `--lp-font-sans`). Weights: 400, 500, 600, 700.

| Step | Value | CSS variable |
| --- | --- | --- |
| `xs` | 12px | `--lp-text-xs` |
| `sm` | 14px | `--lp-text-sm` |
| `base` | 16px | `--lp-text-base` |
| `lg` | 18px | `--lp-text-lg` |
| `xl` | 20px | `--lp-text-xl` |
| `2xl` | 28px | `--lp-text-2xl` |
| `3xl` | 36px | `--lp-text-3xl` |
| `4xl` | 56px | `--lp-text-4xl` |

## Radius

| Step | Value | CSS variable |
| --- | --- | --- |
| `sm` | 8px | `--lp-radius-sm` |
| `md` | 12px | `--lp-radius-md` |
| `lg` | 16px | `--lp-radius-lg` |
| `pill` | 9999px | `--lp-radius-pill` |

## Spacing

A 4px base grid.

| Step | Value | CSS variable |
| --- | --- | --- |
| `1` | 4px | `--lp-space-1` |
| `2` | 8px | `--lp-space-2` |
| `3` | 12px | `--lp-space-3` |
| `4` | 16px | `--lp-space-4` |
| `5` | 20px | `--lp-space-5` |
| `6` | 24px | `--lp-space-6` |
| `8` | 32px | `--lp-space-8` |
| `10` | 40px | `--lp-space-10` |
| `12` | 48px | `--lp-space-12` |
| `16` | 64px | `--lp-space-16` |

## Touch targets

Minimum size of anything the player taps or clicks.

| Target | Value | CSS variable |
| --- | --- | --- |
| `ipad` | 44px | `--lp-touch-ipad` |
| `desktop` | 36px | `--lp-touch-desktop` |

## Motion

Easing `cubic-bezier(0.2, 0, 0, 1)`. With `prefers-reduced-motion: reduce` all three durations become 0ms.

| Speed | Value | CSS variable |
| --- | --- | --- |
| `fast` | 120ms | `--lp-motion-fast` |
| `base` | 200ms | `--lp-motion-base` |
| `slow` | 320ms | `--lp-motion-slow` |

Easing variable: `--lp-motion-easing`.

## Rules

- Components never hold raw colours; use the `--lp-*` variables.
- Every functional colour has one role; do not reuse a role colour for decoration.
- The score stays white paper (`paper`, `ink`) in every theme.
- Problem colours (`problem`, `problemBg`, `problemBorder`, the flag chips) are editor only.
- The aurora is for brand moments only.
- Touch targets are at least 44px on iPad and 36px on desktop.
