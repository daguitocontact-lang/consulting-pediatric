/**
 * The contact form this custom works with, expressed as Daguito custom fields.
 *
 * A Daguito contact carries `name`, `email`, `phone`, `tags` and `notes`
 * natively — those never go here, they would be a second copy of a column that
 * already exists. What goes here is everything the client's form asks for and
 * the CRM has no column for.
 *
 * Beware one trap: `contacts.address` in Daguito is the address ON A CHANNEL
 * (the WhatsApp number), NOT a postal address. A street belongs in a custom
 * field of your own.
 *
 * LABELS ARE THE CONTRACT. Daguito derives the storage key from the label
 * (keyFromLabel below mirrors its rule), so renaming one here creates a SECOND
 * field instead of renaming the existing one — the old values stay under the
 * old key. Change a label only together with a migration of the values.
 */
export type CustomFieldType = 'text' | 'number' | 'select' | 'date' | 'boolean'

export type ContactFieldSpec = {
  label: string
  type: CustomFieldType
  /** Required (and only allowed) when `type` is 'select'. */
  options?: readonly string[]
  required?: boolean
}

/**
 * Empty: a new custom lists the fields ITS client's form needs. In spec order —
 * Daguito files each new field at `position = existing.length`, so this order is
 * the order the form is read in. For example:
 *
 *   { label: 'Tipo documento', type: 'select', options: ['CC', 'CE', 'PP'], required: true },
 *   { label: 'Documento', type: 'text', required: true },
 *   { label: 'Dirección', type: 'text' },
 */
export const CONTACT_FIELDS: readonly ContactFieldSpec[] = []

/**
 * The key Daguito will store this field under.
 *
 * Copied from `keyFromLabel` in Daguito's custom-fields route: lowercase, strip
 * accents, everything else to underscores. We need it here to tell an already
 * registered field from a missing one WITHOUT relying on the label, which the
 * operator can edit in the CRM — the key is what survives that.
 */
export function keyFromLabel(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'field'
  )
}
