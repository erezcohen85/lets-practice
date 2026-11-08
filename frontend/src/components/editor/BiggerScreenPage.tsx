import { Link } from 'react-router'
import { PageColumn } from '@/components/shell/PageColumn'
import { EmptyState } from '@/components/shell/StateCards'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.editor.phone

/**
 * What the editor's address shows on a phone (a bookmark, a link, an iPad Split View shrunk to phone size): the editor needs a
 * bigger screen, with the way to Practice the same part and back to the piece hub.
 */
export function BiggerScreenPage({ pieceId, partId }: { pieceId: string; partId: string | null }) {
  return (
    <PageColumn width="narrow">
      <EmptyState
        title={text.title}
        text={text.text}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link to={`/pieces/${pieceId}/practice${partId === null ? '' : `?part=${partId}`}`} className={cn(buttonVariants({ size: 'xl' }))}>
              {text.practice}
            </Link>
            <Link to={`/pieces/${pieceId}`} className={cn(buttonVariants({ variant: 'outline', size: 'xl' }))}>
              {text.pieceHub}
            </Link>
          </div>
        }
      />
    </PageColumn>
  )
}
