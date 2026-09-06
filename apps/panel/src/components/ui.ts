// The core's components, re-exported from one place so pages import from
// `../components/ui` and never reach into the vendored tree. `src/ui/` mirrors
// `packages/ui/src/` in the core exactly — same folders, same relative imports —
// so the copies compile untouched and scripts/sync-ui.sh is a plain copy.
//
// When `@daguito/ui` is published, this barrel is the only import to rewrite.
export { Badge } from '../ui/components/Badge'
export type { BadgeProps } from '../ui/components/Badge'
// The one component that is NOT a plain re-export: the core's Button hardcodes
// its accent to a single theme, so it is recomposed here. See ./Button.tsx.
export { Button } from './Button'
export type { ButtonProps } from './Button'
export { Card, CardHeader, CardBody, CardFooter } from '../ui/components/Card'
export { DataTable } from '../ui/components/DataTable'
export type { DataColumn } from '../ui/components/DataTable'
export { EmptyState } from '../ui/components/EmptyState'
export { Modal } from '../ui/components/Modal'
export type { ModalProps } from '../ui/components/Modal'
export { Spinner } from '../ui/components/Spinner'
export { InputFrame, FormField, ErrorText, Label } from '../ui/components/Input'
