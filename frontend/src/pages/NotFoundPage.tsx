import { Link } from 'react-router'
import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

/** No route matches. Public: a signed-out visitor who follows the link lands on the landing page through the guard. */
export function NotFoundPage() {
  return (
    <PageColumn width="narrow">
      <ErrorState
        title={strings.common.notFoundTitle}
        text={strings.common.notFoundText}
        actions={
          <Link to="/library" className={cn(buttonVariants({ size: 'xl' }))}>
            <ActionIcon action="library" />
            {strings.common.goToLibrary}
          </Link>
        }
      />
    </PageColumn>
  )
}
