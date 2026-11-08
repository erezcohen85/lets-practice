import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { type PlanState } from '@/domain/planLimits'
import { strings } from '@/strings'

const t = strings.plans.yourPlan

/** The rows of the dialog: one per limit that applies, with the usage where it applies. A limit left empty reads "No limit". */
function planRows(state: PlanState): { label: string; value: string }[] {
  const { plan, usage } = state
  // A count of zero means the plan does not include the thing at all.
  const count = (max: number | null, text: (max: number) => string) => (max === null ? t.noLimit : max === 0 ? t.values.notIncluded : text(max))
  const advanced = !plan.advanced_reading
    ? t.values.notIncluded
    : plan.advanced_reading_parts_per_month === null
      ? t.values.included
      : t.values.advancedMonthly(usage.advanced_reading_parts_this_month, plan.advanced_reading_parts_per_month)
  return [
    { label: t.rows.pieces, value: count(plan.pieces_created_max, (max) => t.values.made(usage.pieces_created, max)) },
    { label: t.rows.parts, value: plan.parts_per_piece_max === null ? t.noLimit : t.values.partsPerPiece(plan.parts_per_piece_max) },
    { label: t.rows.sharedPieces, value: count(plan.shared_pieces_max, (max) => t.values.sharedOf(usage.shared_pieces, max)) },
    { label: t.rows.advancedReading, value: advanced },
    { label: t.rows.splitPdf, value: plan.split_pdf ? t.values.included : t.values.notIncluded },
    { label: t.rows.readAgain, value: count(plan.read_again_per_part_max, t.values.perPart) },
    { label: t.rows.recording, value: plan.recording_minutes_max === null ? t.noLimit : t.values.upToMinutes(plan.recording_minutes_max) },
    { label: t.rows.pdf, value: plan.pages_per_part_max === null ? t.noLimit : t.values.upToPages(plan.pages_per_part_max) },
  ]
}

/**
 * "Your plan: Trial" (the account menu's Plan): what the plan includes with usage where it applies, the upgrade line, OK.
 * The admin has no limits to list. Later the Plan item leads to a plans and upgrade screen instead.
 */
export function YourPlanDialog({ state, open, onOpenChange }: { state: PlanState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const name = state.is_admin ? t.adminName : state.plan.name
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-5 rounded-card p-6 sm:max-w-md">
        <DialogTitle className="text-xl leading-tight font-semibold">{t.title(name)}</DialogTitle>
        {state.is_admin ? (
          <DialogDescription className="text-[15px] text-text-soft">{t.noLimits}</DialogDescription>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col border-t border-border-strong p-0">
              {planRows(state).map((row) => (
                <li key={row.label} className="flex justify-between gap-4 border-b border-border-strong py-2.5 text-[15px] leading-snug">
                  <span className="text-text-soft">{row.label}</span>
                  <span className="text-end font-medium">{row.value}</span>
                </li>
              ))}
            </ul>
            <DialogDescription className="text-[15px] text-text-soft">{strings.plans.upgrade}</DialogDescription>
          </>
        )}
        <div className="flex justify-end">
          <Button size="touch" className="min-w-24 px-6" onClick={() => onOpenChange(false)}>
            {t.ok}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
