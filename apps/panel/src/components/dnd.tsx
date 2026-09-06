/**
 * Dragging a passenger from one group to another, the way the operator does it
 * in the system this panel replaces.
 *
 * Two plain `<div>`s and the browser's own drag events — no library, and no
 * Tamagui in the way. Tamagui's Stack does forward unknown props to the DOM on
 * web, but `draggable`/`onDrop` are not in its prop types, so wiring them there
 * costs a cast at every call site; a typed wrapper costs one file. The panel
 * only ever runs in a browser (it is an ESM remote Daguito imports), so there
 * is no native target to keep happy.
 *
 * The payload travels in `dataTransfer` rather than in React state, so a drag
 * that starts in one card and ends in another survives any re-render in
 * between.
 */
import { useState, type ReactNode } from 'react'

const MIME = 'application/x-pediatric-pax'

/** What can be dragged onto a group. */
export type DragPayload =
  | { kind: 'pending'; reservation_id: string; traveler_id: string | null; route: string }
  | { kind: 'member'; id: string; group_id: string; route: string }

export function DragItem({
  payload,
  disabled,
  children,
}: {
  payload: DragPayload
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(MIME, JSON.stringify(payload))
        // Some browsers refuse a drag with no text/plain flavour.
        event.dataTransfer.setData('text/plain', payload.kind)
        event.dataTransfer.effectAllowed = 'move'
      }}
      style={{ cursor: disabled ? 'default' : 'grab' }}
    >
      {children}
    </div>
  )
}

export function DropZone({
  onDrop,
  accepts,
  children,
}: {
  onDrop: (payload: DragPayload) => void
  /** Say no before the drop: a full group, or the group the pax is already in. */
  accepts?: (payload: DragPayload) => boolean
  children: ReactNode
}) {
  const [over, setOver] = useState(false)

  const read = (event: React.DragEvent): DragPayload | null => {
    const raw = event.dataTransfer.getData(MIME)
    if (!raw) return null
    try {
      return JSON.parse(raw) as DragPayload
    } catch {
      return null
    }
  }

  return (
    <div
      onDragOver={(event) => {
        // `dataTransfer` is write-only during dragover in most browsers, so the
        // zone cannot inspect the payload here — it accepts, and the drop
        // handler is what refuses. Without preventDefault there is no drop at
        // all.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const payload = read(event)
        if (!payload) return
        if (accepts && !accepts(payload)) return
        onDrop(payload)
      }}
      style={{
        // A ring, not a layout change: nothing may shift under the cursor mid
        // drag, or the drop lands on whatever moved into place.
        outline: over ? '2px solid var(--color9)' : 'none',
        outlineOffset: -2,
        borderRadius: 12,
      }}
    >
      {children}
    </div>
  )
}
