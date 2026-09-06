import { useMedia } from 'tamagui'

export interface UseIsMobileApi {
  /** Viewport is too narrow for the desktop shell (sidebar + side-by-side panes). */
  isMobile: boolean
  /** Primary input is a finger, not a mouse. Orthogonal to `isMobile`. */
  isTouch: boolean
}

/**
 * Single answer to "should this render the phone layout?", so surfaces stop
 * improvising their own breakpoint. Reads the `md` / `pointerCoarse` media
 * queries from the shared tamagui config.
 *
 * `isMobile` uses `md` (≤980px) rather than a phone-sized breakpoint: that is
 * where the 250px sidebar plus a side-by-side pane stops fitting, which
 * includes tablet portrait.
 *
 * `isTouch` is deliberately separate — a touchscreen laptop is touch but not
 * mobile, and an emulated phone is mobile but may not be touch.
 */
export function useIsMobile(): UseIsMobileApi {
  const media = useMedia()
  // Tamagui reports a media key as undefined until it has matched once; for a
  // layout decision that is the same answer as false.
  return { isMobile: Boolean(media.md), isTouch: Boolean(media.pointerCoarse) }
}
