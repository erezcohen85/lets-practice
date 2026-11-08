import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'
import { strings } from '@/strings'

/** "Zoom  -  100%  +" at the end of the Edit bar lines row. */
export function ZoomControls({ percent, onZoomIn, onZoomOut }: { percent: number; onZoomIn(): void; onZoomOut(): void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-text-soft @max-[1018px]:sr-only">{strings.score.zoomLabel}</span>
      <Hint text={strings.score.zoomOut}>
        <Button variant="outline" size="icon" aria-label={strings.score.zoomOut} onClick={onZoomOut}>
          <Minus />
        </Button>
      </Hint>
      <span className="min-w-10 text-center text-sm font-medium tabular-nums">{strings.score.zoomPercent(percent)}</span>
      <Hint text={strings.score.zoomIn}>
        <Button variant="outline" size="icon" aria-label={strings.score.zoomIn} onClick={onZoomIn}>
          <Plus />
        </Button>
      </Hint>
    </div>
  )
}
