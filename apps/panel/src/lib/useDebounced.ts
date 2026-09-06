// A value that lags behind what is being typed.
//
// Server-side search needs this and client-side filtering does not: the
// reservations list filters rows it already holds, so it can react on every
// keystroke, while the product finder asks the API and would otherwise fire a
// request per character — and answers would land out of order.
//
// The delay is deliberately short. 250ms is under the ~300ms where a pause
// starts to read as lag, and long enough that a typed word is one request.
import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    // Every keystroke cancels the previous timer, so only the last one fires.
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}
