// The quiet look of the hub's secondary actions (Rename, Delete, Edit map when nothing needs review): a 1 px border on the
// page background in the soft text colour, as the Rename button of the board. Merged over the outline button variant.
export const quietActionClass =
  'border-border bg-transparent text-text-soft hover:bg-surface-2 hover:text-foreground dark:border-border dark:bg-transparent dark:hover:bg-surface-2'

// The icon-only Practice and Edit links of a part row: 44 px squares with a 1.5 px outline and a faint tint of their own
// colour (Practice teal, Edit violet), as the board draws them. The icon is the cue, so each carries a title and a name.
const partIconLinkBase =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-lg border-[1.5px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50'
export const partPracticeLinkClass = `${partIconLinkBase} border-primary-strong bg-primary-strong/8 text-primary-strong hover:bg-primary-strong/16`
export const partEditLinkClass = `${partIconLinkBase} border-loop bg-loop/8 text-loop hover:bg-loop/16`
