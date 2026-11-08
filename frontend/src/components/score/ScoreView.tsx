import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type BarBox, type BarNumber, type PageLayer } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { type PageImage } from '@/lib/dataClient'
import { strings } from '@/strings'
import { type BarState } from './BarOverlay'
import { pageScale } from './pageScale'
import { anchoredScroll, pinchZoom } from './pinch'
import { ScorePage, type ScorePointerEvent } from './ScorePage'

export type { BarState } from './BarOverlay'
export type { ScorePointerEvent } from './ScorePage'

/** A request to bring a bar into view; each request is a new object, so the same bar can be asked for twice. */
export interface BarFocus { bar: BarNumber }

/**
 * A request to scroll the view so that a point of a page sits at a share of the column's height from its top (Practice
 * keeps the playing line there); each request is a new object, so the same point can be asked for twice.
 */
export interface ScrollRequest {
  pageIndex: number
  /** In image pixels from the top of the page. */
  y: number
  /** 0 = the top of the column, 0.25 = a quarter of the way down. */
  at: number
}

export interface ScoreViewProps {
  pages: PageImage[]
  page: PageLayer
  barStates: ReadonlyMap<BarNumber, BarState>
  /** A short line at the foot of a bar, drawn over the page (the moved bars' offsets). */
  barTags?: ReadonlyMap<BarNumber, string>
  /** The selected bar, so a selected moved bar can show both. */
  selectedBar?: BarNumber | null
  /** False hides the bar numbers and the rest ranges (the Bar numbers setting); the boxes stay. Default true. */
  showBarNumbers?: boolean
  /** 1 = fit the width of the score column. */
  zoom: number
  /** Page index shown first; the view scrolls it into view when it changes. */
  currentPage: number
  onPageInView(pageIndex: number): void
  /** Scrolls the bar's box to the middle of the column (its page comes into view and is reported through onPageInView). */
  focusBar?: BarFocus | null
  /** Scrolls smoothly (at once for a user who asks for less motion) to a point of a page; for Practice's following. */
  scrollTo?: ScrollRequest | null
  /** Pointer events in image pixels, so the Edit sheet can hit-test lines and bars. */
  onPointer?(event: ScorePointerEvent): void
  /**
   * An extra layer in image pixels on every page, or one chosen per page with the page's scale (the Edit sheet draws
   * its hover line here and uses the scale to keep handles and tags the same size on screen at every zoom).
   */
  overlay?: ReactNode | ((pageIndex: number, scale: number) => ReactNode)
  /** Between the page line and the status: the editor's hint (what the mode does, or why an edit was refused), in one muted line. */
  hint?: string
  /** False leaves the "Page 2 of 4 · bars 33-48" label out (Practice); the hint and the status still show. Default true. */
  showPageLabel?: boolean
  /** At the end of the page line ("Page 2 of 4 · bars 33–48"): the editor's status. */
  statusLine?: ReactNode
  /** Between the page line and the pages: the editor's Edit sheet. */
  toolbar?: ReactNode
  /**
   * Two fingers on the score zoom it (Practice): the pages scale on the screen while the fingers move, and this gets the
   * zoom they end on, between 50 and 200 %. Without it two fingers do nothing here (the editor).
   */
  onPinchZoom?(zoom: number): void
}

interface Point { x: number; y: number }
/** A pinch: where it started (the scroll, the content's size and the point between the fingers, in the view) and where it is. */
interface Pinch { left: number; top: number; width: number; height: number; distance: number; zoom: number; from: Point; to: Point; next: number }

// Space around the stack of pages inside the scroll container, in px.
const COLUMN_PADDING = 16
// Used until the column has been measured.
const FALLBACK_COLUMN_WIDTH = 800

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The part's pages stacked in one scrolling column, left to right whatever the page direction, with the bar boxes on
 * top and "Page 2 of 4 · bars 33-48" above for the page most in view. The page is always paper (night score is for
 * Practice only).
 */
export function ScoreView({ pages, page, barStates, barTags, selectedBar, showBarNumbers = true, zoom, currentPage, onPageInView, focusBar = null, scrollTo = null, onPointer, overlay, showPageLabel = true, hint, statusLine, toolbar, onPinchZoom }: ScoreViewProps) {
  const names = useBarNames()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const [columnWidth, setColumnWidth] = useState(FALLBACK_COLUMN_WIDTH)
  // True once the column has been measured at least once: a bar asked for before that would be placed with the fallback width.
  const [measured, setMeasured] = useState(false)

  // The page the label names: what the observer last reported, or what the parent asked for.
  const [seenCurrent, setSeenCurrent] = useState(currentPage)
  const [viewPage, setViewPage] = useState(currentPage)
  if (seenCurrent !== currentPage) {
    setSeenCurrent(currentPage)
    setViewPage(currentPage)
  }

  // A bar asked for names its page in the label at once, before the scroll and the observer catch up.
  const [seenFocus, setSeenFocus] = useState<BarFocus | null>(null)
  if (seenFocus !== focusBar) {
    setSeenFocus(focusBar)
    const box = focusBar === null ? undefined : page.bars.find((candidate) => candidate.bar === focusBar.bar)
    if (box !== undefined) setViewPage(box.pageIndex)
  }

  const boxesByPage = useMemo(() => {
    const byPage = new Map<number, BarBox[]>()
    for (const box of page.bars) byPage.set(box.pageIndex, [...(byPage.get(box.pageIndex) ?? []), box])
    return byPage
  }, [page.bars])

  // Latest callback and the page last reported, for the observer and the scroll effect (which must not fight).
  const onPageInViewRef = useRef(onPageInView)
  const reportedRef = useRef<number | null>(null)
  useEffect(() => {
    onPageInViewRef.current = onPageInView
  })

  // Measure the column; ResizeObserver is missing in jsdom, where the fallback width stays.
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const measure = () => {
      const width = scroll.clientWidth - 2 * COLUMN_PADDING
      if (width > 0) setColumnWidth(width)
    }
    measure()
    setMeasured(true)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])

  // The latest zoom and callbacks, for the touch listeners, which are added once.
  const zoomRef = useRef(zoom)
  const onPinchZoomRef = useRef(onPinchZoom)
  const onPointerRef = useRef(onPointer)
  useEffect(() => {
    zoomRef.current = zoom
    onPinchZoomRef.current = onPinchZoom
    onPointerRef.current = onPointer
  })
  // A pinch that has ended, for the zoom effect below: it keeps the point between the fingers between them.
  const endedPinch = useRef<Pinch | null>(null)
  const pinchable = onPinchZoom !== undefined
  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!pinchable || !scroll || !content) return
    let pinch: Pinch | null = null
    const fingers = (touches: TouchList) => {
      const rect = scroll.getBoundingClientRect()
      const [a, b] = [touches[0], touches[1]]
      return { distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), at: { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top } }
    }
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      const { distance, at } = fingers(event.touches)
      const start = zoomRef.current
      pinch = { left: scroll.scrollLeft, top: scroll.scrollTop, width: scroll.scrollWidth, height: scroll.scrollHeight, distance, zoom: start, from: at, to: at, next: start }
      content.style.transformOrigin = `${pinch.left + at.x}px ${pinch.top + at.y}px`
      // The first finger's press is neither a tap nor a long press.
      onPointerRef.current?.({ type: 'leave', pageIndex: -1, x: 0, y: 0, shiftKey: false })
    }
    const onMove = (event: TouchEvent) => {
      if (pinch === null || event.touches.length < 2) return
      // Neither the page zoom nor a scroll: the fingers move the score themselves.
      event.preventDefault()
      const { distance, at } = fingers(event.touches)
      pinch.next = pinchZoom(pinch.zoom, pinch.distance, distance)
      pinch.to = at
      content.style.transform = `translate(${at.x - pinch.from.x}px, ${at.y - pinch.from.y}px) scale(${pinch.next / pinch.zoom})`
    }
    const onEnd = (event: TouchEvent) => {
      if (pinch === null || event.touches.length >= 2) return
      const ended = pinch
      pinch = null
      if (ended.next === ended.zoom) {
        content.style.transform = ''
        return
      }
      endedPinch.current = ended
      onPinchZoomRef.current?.(ended.next)
    }
    scroll.addEventListener('touchstart', onStart, { passive: true })
    scroll.addEventListener('touchmove', onMove, { passive: false })
    scroll.addEventListener('touchend', onEnd)
    scroll.addEventListener('touchcancel', onEnd)
    return () => {
      scroll.removeEventListener('touchstart', onStart)
      scroll.removeEventListener('touchmove', onMove)
      scroll.removeEventListener('touchend', onEnd)
      scroll.removeEventListener('touchcancel', onEnd)
    }
  }, [pinchable])

  // Zoom around the centre of the column: the point in the middle of the view stays in the middle. After a pinch, the
  // point between the fingers stays between them instead, and the pages lose the scale they had on the screen.
  const scrollRect = useRef({ left: 0, top: 0, width: 0, height: 0 })
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const pinch = endedPinch.current
    endedPinch.current = null
    if (pinch !== null && contentRef.current) contentRef.current.style.transform = ''
    if (scroll && pinch !== null && pinch.width > 0 && pinch.height > 0) {
      scroll.scrollLeft = anchoredScroll(pinch.left, pinch.from.x, pinch.to.x, scroll.scrollWidth / pinch.width)
      scroll.scrollTop = anchoredScroll(pinch.top, pinch.from.y, pinch.to.y, scroll.scrollHeight / pinch.height)
      return
    }
    const before = scrollRect.current
    if (!scroll || before.width === 0 || before.height === 0) return
    const centreX = scroll.clientWidth / 2
    const centreY = scroll.clientHeight / 2
    scroll.scrollLeft = (before.left + centreX) * (scroll.scrollWidth / before.width) - centreX
    scroll.scrollTop = (before.top + centreY) * (scroll.scrollHeight / before.height) - centreY
  }, [zoom, columnWidth])
  // After every render, remember the size of the content and where the user has scrolled to.
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    scrollRect.current = { left: scroll.scrollLeft, top: scroll.scrollTop, width: scroll.scrollWidth, height: scroll.scrollHeight }
  })

  // Scroll a page the parent asked for to the top; not one the observer just reported (it is already in view).
  useEffect(() => {
    if (reportedRef.current === currentPage) return
    const scroll = scrollRef.current
    const target = pageRefs.current.get(currentPage)
    if (scroll && target) scroll.scrollTop = target.offsetTop - COLUMN_PADDING
  }, [currentPage, pages])

  // Scroll a bar the parent asked for to the middle of the column. It runs after the page scroll above, so a bar wins.
  // On mount too: the editor opens on a bar named in the address.
  useEffect(() => {
    if (focusBar === null || !measured) return
    const box = page.bars.find((candidate) => candidate.bar === focusBar.bar)
    const scroll = scrollRef.current
    const target = box === undefined ? undefined : pageRefs.current.get(box.pageIndex)
    const image = box === undefined ? undefined : pages.find((candidate) => candidate.pageIndex === box.pageIndex)
    if (!scroll || !box || !target || !image) return
    const scale = pageScale(image, columnWidth, zoom)
    scroll.scrollTop = Math.max(0, target.offsetTop + (box.y + box.h / 2) * scale - scroll.clientHeight / 2)
    scroll.scrollLeft = Math.max(0, target.offsetLeft + (box.x + box.w / 2) * scale - scroll.clientWidth / 2)
    if (reportedRef.current !== box.pageIndex) {
      reportedRef.current = box.pageIndex
      onPageInViewRef.current(box.pageIndex)
    }
    // Only a new request scrolls; a later zoom or edit of the boxes keeps the view where the user left it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBar, measured])

  // Scroll to a point a request names, smoothly. Only a new request scrolls; a later zoom keeps the view where it is.
  useEffect(() => {
    if (scrollTo === null || !measured) return
    const scroll = scrollRef.current
    const target = pageRefs.current.get(scrollTo.pageIndex)
    const image = pages.find((candidate) => candidate.pageIndex === scrollTo.pageIndex)
    if (!scroll || !target || !image) return
    const top = Math.max(0, target.offsetTop + scrollTo.y * pageScale(image, columnWidth, zoom) - scrollTo.at * scroll.clientHeight)
    if (typeof scroll.scrollTo !== 'function') scroll.scrollTop = top
    else scroll.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo, measured])

  // The page with the largest visible share is the one in view (the lower page wins a tie). No observer, no reports.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || typeof IntersectionObserver === 'undefined') return
    const ratios = new Map<number, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(Number((entry.target as HTMLElement).dataset.pageIndex), entry.intersectionRatio)
        let best = -1
        let bestRatio = 0
        for (const [index, ratio] of [...ratios].sort(([a], [b]) => a - b)) {
          if (ratio > bestRatio) {
            best = index
            bestRatio = ratio
          }
        }
        if (best < 0 || best === reportedRef.current) return
        reportedRef.current = best
        setViewPage(best)
        onPageInViewRef.current(best)
      },
      { root: scroll, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const element of pageRefs.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [pages])

  const shown = pages.find((image) => image.pageIndex === viewPage) ?? pages[0]
  const shownBars = shown ? (boxesByPage.get(shown.pageIndex) ?? []) : []
  const label = shown && showPageLabel
    ? strings.score.pageLabel(
        shown.pageIndex + 1,
        pages.length,
        shownBars.length > 0 ? names.label(Math.min(...shownBars.map((box) => box.bar))) : null,
        shownBars.length > 0 ? names.label(Math.max(...shownBars.map((box) => box.bar))) : null,
      )
    : null

  return (
    <section aria-label={strings.score.region} className="flex min-h-0 flex-1 flex-col gap-2">
      {(label !== null || hint !== undefined || statusLine != null) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 lg:flex-nowrap">
          {label !== null && (
            <div data-slot="page-label" className="text-sm text-text-soft" aria-live="polite">
              {label}
            </div>
          )}
          {hint !== undefined && <EditHint hint={hint} />}
          {statusLine != null && <div className="ms-auto">{statusLine}</div>}
        </div>
      )}
      {toolbar}
      <div ref={scrollRef} dir="ltr" data-slot="score-scroll" className="min-h-0 flex-1 overflow-auto">
        <div ref={contentRef} className="relative flex w-max min-w-full flex-col items-center gap-4" style={{ padding: COLUMN_PADDING }}>
          {pages.map((image) => {
            const scale = pageScale(image, columnWidth, zoom)
            return (
              <ScorePage
                key={image.pageIndex}
                image={image}
                total={pages.length}
                scale={scale}
                boxes={boxesByPage.get(image.pageIndex) ?? []}
                barStates={barStates}
                barTags={barTags}
                selectedBar={selectedBar}
                showBarNumbers={showBarNumbers}
                onPointer={onPointer}
                overlay={typeof overlay === 'function' ? overlay(image.pageIndex, scale) : overlay}
                pageRef={(element) => {
                  if (element) pageRefs.current.set(image.pageIndex, element)
                  else pageRefs.current.delete(image.pageIndex)
                }}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** The editor's hint in the page line: one muted line that is cut short only when the window is narrow; the whole text is its title. */
export function EditHint({ hint }: { hint: string }) {
  return (
    <p role="status" data-slot="edit-hint" title={hint} className="min-w-0 flex-1 truncate text-center text-sm text-text-muted max-lg:order-last max-lg:basis-full">
      {hint}
    </p>
  )
}
