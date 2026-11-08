import { Pencil, PencilRuler, Play, RotateCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { EditorLink } from '@/components/editor/EditorLink'
import { DeletePartDialog } from '@/components/hub/DeletePartDialog'
import { RenameDialog } from '@/components/hub/RenameDialog'
import { ReprocessPartDialog } from '@/components/hub/ReprocessPartDialog'
import { partEditLinkClass, partPracticeLinkClass } from '@/components/hub/styles'
import { MoreMenu } from '@/components/ui/more-menu'
import { MAX_PART_NAME } from '@/domain/names'
import { partReviewState, type PartReviewState } from '@/domain/partStatus'
import { type PartSummary } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

// Amber while bars wait to be checked (the selected role), muted before anything is checked, green (the anchor role)
// when all are. Parts have no colours of their own.
const STATUS_COLOUR: Record<PartReviewState, string> = {
  'partly-reviewed': 'text-selected',
  'not-reviewed': 'text-text-muted',
  'all-checked': 'text-anchor',
}

function statusText(part: PartSummary, state: PartReviewState): string {
  const { partStatus } = strings.hub
  switch (state) {
    case 'partly-reviewed':
      return partStatus.reviewed(part.review.checked, part.review.total)
    case 'not-reviewed':
      return partStatus.notReviewed
    case 'all-checked':
      return partStatus.allChecked
  }
}

/**
 * One part of the piece: its name, how far it has been reviewed, and at the end icon-only links to practice or edit just
 * that part and a three-dot menu. The menu renames the part (`onRename` gets the trimmed new name and rejects when it could
 * not be saved), reads it again from its PDF after a confirmation (`onReprocess` gets the box check tick and rejects when the
 * job could not be started), and deletes it for good after a confirmation (`onDelete` rejects when it could not be deleted;
 * the piece's last part cannot be deleted, `isLast`).
 */
export function PartRow({
  pieceId,
  part,
  isLast,
  onRename,
  onDelete,
  onReprocess,
  reprocessPlan,
}: {
  pieceId: string
  part: PartSummary
  isLast: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  /** Left out when the owner may no longer upload: reading the part again is an upload's work. Resolves false when the plan refused it. */
  onReprocess?: (boxCheck: boolean) => Promise<void | false>
  /**
   * What the plan says about reading this part again: `check` asks before the question opens (false: the prompt is open), `left`
   * is the line under the part's status, and `confirm` the line in the question. Left out for a plan without that limit.
   */
  reprocessPlan?: { check: () => boolean; left: string | null; confirm: string }
}) {
  const state = partReviewState(part.review)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-surface px-5 py-4">
      <div className="min-w-0 flex-1">
        <div data-slot="part-name" className="min-w-0 text-[17px] leading-snug font-semibold break-words">
          {part.name}
        </div>
        <div className={cn('mt-0.5 text-sm', STATUS_COLOUR[state])}>{statusText(part, state)}</div>
        {reprocessPlan?.left != null && <div className="mt-0.5 text-sm text-text-muted">{reprocessPlan.left}</div>}
      </div>
      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        value={part.name}
        max={MAX_PART_NAME}
        texts={strings.hub.renamePartTexts}
        onRename={onRename}
      />
      {onReprocess !== undefined && (
        <ReprocessPartDialog open={reprocessing} onOpenChange={setReprocessing} name={part.name} note={reprocessPlan?.confirm} onReprocess={onReprocess} />
      )}
      <DeletePartDialog open={deleting} onOpenChange={setDeleting} name={part.name} isLast={isLast} onDelete={onDelete} />
      <div className="flex shrink-0 items-center gap-3">
        <Link
          to={`/pieces/${pieceId}/practice?part=${part.id}`}
          aria-label={strings.hub.practicePart(part.name)}
          title={strings.hub.practice}
          className={partPracticeLinkClass}
        >
          <Play className="size-5 fill-current" aria-hidden="true" />
        </Link>
        <EditorLink to={`/pieces/${pieceId}/edit?part=${part.id}`} aria-label={strings.hub.editPart(part.name)} title={strings.hub.edit} className={partEditLinkClass}>
          <PencilRuler className="size-5" aria-hidden="true" />
        </EditorLink>
        <MoreMenu
          label={strings.hub.moreFor(part.name)}
          items={[
            { label: strings.hub.rename, icon: Pencil, onSelect: () => setRenaming(true) },
            ...(onReprocess === undefined
              ? []
              : [
                  {
                    label: strings.partReprocess.submit,
                    icon: RotateCw,
                    // The plan is asked before the question: a part with no reads left opens the prompt instead.
                    onSelect: () => {
                      if (reprocessPlan === undefined || reprocessPlan.check()) setReprocessing(true)
                    },
                  },
                ]),
            { label: strings.hub.delete, icon: Trash2, danger: true, onSelect: () => setDeleting(true) },
          ]}
        />
      </div>
    </li>
  )
}
