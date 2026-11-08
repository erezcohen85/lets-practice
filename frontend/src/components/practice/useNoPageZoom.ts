import { useEffect } from 'react'

const stop = (event: Event) => event.preventDefault()

/**
 * While Practice is open, two fingers zoom the score only (its own pinch), never the whole page. The screen's
 * `touch-action: pan-x pan-y` stops the browser's pinch and double-tap zoom; iOS Safari also sends its own gesture events,
 * which are stopped here as a second guard. Other screens keep the page zoom.
 */
export function useNoPageZoom(): void {
  useEffect(() => {
    document.addEventListener('gesturestart', stop, { passive: false })
    document.addEventListener('gesturechange', stop, { passive: false })
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
    }
  }, [])
}
