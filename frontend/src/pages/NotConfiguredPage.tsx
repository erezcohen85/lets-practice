import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState } from '@/components/shell/StateCards'
import { strings } from '@/strings'

/** Shown by main.tsx when no clients are configured: the real backend comes in Phase 9. */
export function NotConfiguredPage() {
  return (
    <PageColumn width="narrow">
      <ErrorState title={strings.common.notConfiguredTitle} text={strings.common.notConfiguredText} />
    </PageColumn>
  )
}
