/** What the Edit sheet shows on a page under the pointer, in image pixels; the hook decides, this draws. */
export type EditHover =
  | { kind: 'handle'; pageIndex: number; x: number; y: number; h: number; dragging: boolean }
  | { kind: 'add'; pageIndex: number; x: number; y: number; h: number; pointerY: number }
  | { kind: 'delete'; pageIndex: number; x: number; y: number; h: number }

// Sizes in screen pixels: the layer is scaled with the page, so each is divided by the scale to stay the same size.
const HANDLE_WIDTH = 6
const GRIP_WIDTH = 10
const GRIP_HEIGHT = 36
const LINE_WIDTH = 2
const HIGHLIGHT_WIDTH = 4

/**
 * The hover feedback of the Edit sheet inside a page's overlay layer (which is in image pixels and does not take the
 * pointer): the drag handle, the dashed line with its tag, or the highlighted bar line. `scale` is the page's scale.
 * The handle takes the pointer only to show the resize cursor; its events reach the page like any other.
 */
export function EditLayerOverlay({ hover, scale, addHere, moveHandle }: { hover: EditHover; scale: number; addHere: string; moveHandle: string }) {
  const px = (screenPixels: number) => screenPixels / scale

  if (hover.kind === 'handle') {
    return (
      <div
        data-slot="edit-handle"
        data-dragging={hover.dragging}
        title={moveHandle}
        className="pointer-events-auto absolute cursor-ew-resize rounded-full bg-paper-moved"
        style={{ left: hover.x - px(HANDLE_WIDTH / 2), top: hover.y, width: px(HANDLE_WIDTH), height: hover.h }}
      >
        <span
          aria-hidden
          className="absolute rounded-full bg-paper-moved"
          style={{ left: '50%', top: '50%', width: px(GRIP_WIDTH), height: px(GRIP_HEIGHT), transform: 'translate(-50%, -50%)' }}
        />
      </div>
    )
  }

  if (hover.kind === 'delete') {
    return (
      <div
        data-slot="edit-delete-line"
        className="absolute bg-problem"
        style={{ left: hover.x - px(HIGHLIGHT_WIDTH / 2), top: hover.y, width: px(HIGHLIGHT_WIDTH), height: hover.h }}
      />
    )
  }

  return (
    <>
      <div
        data-slot="edit-add-line"
        className="absolute border-paper-cursor"
        style={{
          left: hover.x,
          top: hover.y,
          height: hover.h,
          borderInlineStart: `${px(LINE_WIDTH)}px dashed`,
        }}
      />
      {/* The tag is drawn at normal size by undoing the layer's scale, from the pointer's corner. */}
      <div className="absolute" style={{ left: hover.x, top: hover.pointerY, transform: `scale(${1 / scale})`, transformOrigin: '0 0' }}>
        <span className="ms-3 mt-3 block w-max rounded-md bg-ink px-2 py-1 text-xs font-semibold whitespace-nowrap text-paper">{addHere}</span>
      </div>
    </>
  )
}
