// One place for "load, show a spinner, show the error" — the shape every page
// repeats. Written by hand rather than pulled from a data library: the panel
// makes a handful of calls and shipping React Query would add more bytes than
// the whole page set.
//
// It also keeps the data fresh on its own. The operator leaves this panel open
// on a screen all day while reservations arrive from the agent and from other
// people's sessions, so a page that loaded once and never looked again is
// showing yesterday's board. Polling (not a push stream) because the whole
// mechanism then lives here, in the panel, with nothing to deploy on the API
// and nothing to keep alive through the tunnel.
import { useCallback, useEffect, useRef, useState } from 'react'

/** Poll interval. Reservations change a few times an hour, not a second. */
export const DEFAULT_REFRESH_MS = 15_000

export type AsyncState<T> = {
  data: T | null
  error: unknown
  loading: boolean
  /**
   * A background refresh is in flight while `data` still holds the previous
   * value. Pages use this for a quiet indicator; `loading` stays false so the
   * table does not collapse into a spinner every 15 seconds.
   */
  refreshing: boolean
  /** Re-runs the loader; pages call it after a mutation. */
  reload: () => void
  /**
   * The same request WITHOUT the spinner: `data` stays on screen and is
   * replaced when the answer lands. What a page wants after a write it has
   * already drawn — a board that blanks itself every time a row is dragged is
   * the reload the operator complains about.
   */
  refresh: () => void
  /**
   * Rewrite what is on screen without asking the server.
   *
   * For OPTIMISTIC edits only: the page applies the move it just made, fires
   * the request, and calls `refresh()` when it answers. On failure it reloads
   * and the server's version wins — this never invents data, it only shows the
   * change a moment before it is confirmed.
   */
  mutate: (update: (current: T) => T) => void
}

export type AsyncOptions = {
  /** Milliseconds between background refreshes. 0 turns polling off. */
  refreshMs?: number
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: AsyncOptions = {},
): AsyncState<T> {
  const { refreshMs = DEFAULT_REFRESH_MS } = options

  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  // The poller must always call the CURRENT loader without the interval being
  // torn down and rebuilt every render.
  const runRef = useRef(run)
  runRef.current = run

  const alive = useRef(true)
  const inFlight = useRef(false)
  // Responses can land out of order — a slow poll finishing after the user
  // changed the filter would put the old rows back. Only the newest request is
  // allowed to write state.
  const seq = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const fetchNow = useCallback(async (background: boolean) => {
    // Never stack polls. A foreground load is NOT skipped: the query itself has
    // changed, so it must run even while a background refresh is in flight.
    if (background && inFlight.current) return

    const id = ++seq.current
    inFlight.current = true
    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
      setError(null)
    }

    try {
      const value = await runRef.current()
      if (!alive.current || id !== seq.current) return
      setData(value)
      setError(null)
    } catch (err) {
      // A failed background refresh keeps the last good data on screen — losing
      // the whole table because one poll timed out is worse than showing data a
      // few seconds stale. The error still surfaces, because an expired session
      // (401) has to be visible rather than silently freezing the panel.
      if (!alive.current || id !== seq.current) return
      setError(err)
    } finally {
      if (id === seq.current) inFlight.current = false
      if (alive.current && id === seq.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  // Foreground load whenever the query changes.
  useEffect(() => {
    void fetchNow(false)
  }, [run, fetchNow])

  // Background refresh: on an interval, and immediately when the operator comes
  // back to the tab. Polling stops while the tab is hidden — an unattended
  // panel should not spend requests (or burn through Daguito's short-lived
  // token) all night.
  useEffect(() => {
    if (!refreshMs) return

    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(() => void fetchNow(true), refreshMs)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchNow(true) // catch up on whatever happened while hidden
        start()
      } else {
        stop()
      }
    }
    const onFocus = () => void fetchNow(true)

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshMs, fetchNow, run])

  const mutate = useCallback((update: (current: T) => T) => {
    setData((current) => (current === null ? current : update(current)))
  }, [])

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => void fetchNow(false),
    refresh: () => void fetchNow(true),
    mutate,
  }
}
