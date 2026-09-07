// Create / edit dialog, shared by the pages that write things.
//
// It uses the core's `Modal`, which portals to the document body: that is what
// lets a dialog escape the container Daguito hands the panel, and it is why the
// panel can afford modals at all instead of inline forms.
//
// Errors stay inside the dialog with the values intact — a failed create that
// wipes what the operator typed is the fastest way to lose their trust.
//
// Editing is the same dialog with `initial` filled in. Pages that edit mount it
// only while it is open, so it always opens on the record as it is NOW instead
// of on whatever it was the first time the page rendered.
import { useState } from 'react'
import { XStack, YStack } from 'tamagui'
import { errorMessage } from '../lib/api'
import type { translator } from '../lib/i18n'
import { ErrorNote } from './PageShell'
import { ContactField } from './ContactField'
import { DateField, MoneyField, SelectField, ToggleField } from './fields'
import { Button, FormField, Modal } from './ui'

/** The sentinel the `combo` select carries; never a stored value. */
const OTHER = '__other'

export type FieldSpec = {
  name: string
  label: string
  required?: boolean
  type?: 'text' | 'number' | 'money' | 'date' | 'select' | 'combo' | 'contact' | 'toggle'
  placeholder?: string
  /** `select` / `combo`. The first option is the default the dialog opens with. */
  options?: { value: string; label: string }[]
  /** `toggle` only: the line under the label explaining what the flag does. */
  hint?: string
  /** `combo` only: the copy for the escape hatch and for the field it reveals. */
  otherLabel?: string
  otherFieldLabel?: string
  /**
   * Take the whole row rather than half of it. Toggles do it on their own — a
   * flag and the sentence explaining it do not read in a narrow column.
   */
  full?: boolean
}

export function CreateForm({
  i18n,
  title,
  fields,
  orgId,
  open,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  i18n: ReturnType<typeof translator>
  title: string
  fields: FieldSpec[]
  /** Required only when a field is `type: 'contact'` — it scopes the search
   *  to this org's directory in Daguito. */
  orgId?: string
  open: boolean
  /** Values the dialog opens with — this is what turns it into an edit form. */
  initial?: Record<string, string>
  submitLabel?: string
  onSubmit: (values: Record<string, string>) => Promise<void>
  onClose: () => void
}) {
  const { t } = i18n
  // A select is never empty on screen, so it must never be empty in state
  // either — otherwise the first option submits as "" unless the operator
  // touches the field.
  const defaults = () => ({
    ...(Object.fromEntries(
      fields.flatMap((f) =>
        (f.type === 'select' || f.type === 'combo') && f.options?.[0]
          ? [[f.name, f.options[0].value]]
          : [],
      ),
    ) as Record<string, string>),
    ...initial,
  })

  /**
   * A `combo` opens in free-text mode when the value it is given is not one of
   * its options — editing a room called "Domo geodésico" must show that text,
   * not silently rewrite it to the first type in the list on save.
   */
  const freeTextDefaults = () =>
    Object.fromEntries(
      fields.flatMap((f) => {
        const value = initial?.[f.name]
        return f.type === 'combo' && value && !f.options?.some((o) => o.value === value)
          ? [[f.name, true]]
          : []
      }),
    ) as Record<string, boolean>

  const [values, setValues] = useState<Record<string, string>>(defaults)
  // Which `combo` fields are typing a value of their own. Kept apart from the
  // values: picking "Otro…" clears the field, and a cleared field is
  // indistinguishable from "nothing picked yet" by its value alone.
  const [freeText, setFreeText] = useState<Record<string, boolean>>(freeTextDefaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const missing = fields.some((f) => f.required && !values[f.name]?.trim())

  function close() {
    setFreeText(freeTextDefaults())
    // Reset on close, not on open: reopening after a cancel should start from
    // the defaults, and resetting on open would wipe a retry after a failed
    // submit.
    setValues(defaults())
    setError(null)
    onClose()
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(values)
      setValues(defaults())
      setFreeText(freeTextDefaults())
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      // Wide enough for two columns: at 380 the dialog was a narrow strip down
      // the middle of a desktop screen, and a form that fits in one glance
      // needed scrolling instead.
      size="lg"
      // A stray backdrop click must not throw away a half-typed room.
      closeOnBackdrop={false}
      footer={
        <XStack gap="$0.75" justifyContent="flex-end">
          <Button size="sm" variant="ghost" disabled={busy} onPress={close}>
            {t('form.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || missing}
            onPress={() => void submit()}
          >
            {busy ? t('form.saving') : (submitLabel ?? t('form.save'))}
          </Button>
        </XStack>
      }
    >
      <YStack gap="$1">
        {/* Two columns on a desktop, one on a phone. Eight short fields stacked
            in a single strip is mostly scrolling, and the width was already
            there for the taking. */}
        <XStack gap="$1" flexWrap="wrap">
          {fields.map((field) => (
            <YStack
              key={field.name}
              // No flexGrow on the half-width ones: a field left alone at the
              // end of a row would stretch to full width and sit under a
              // half-width one, which reads as a mistake rather than a column.
              flexGrow={field.type === 'toggle' || field.full ? 1 : 0}
              flexBasis={field.type === 'toggle' || field.full ? '100%' : '48%'}
              minWidth={220}
              $sm={{ flexBasis: '100%', minWidth: 0 }}
            >
              {field.type === 'toggle' ? (
                <ToggleField
                  key={field.name}
                  label={field.label}
                  hint={field.hint}
                  // Held as 'yes' / '' so the dialog's Record<string, string> stays
                  // one type; anything non-empty is true.
                  value={Boolean(values[field.name])}
                  onChange={(next) => setValues({ ...values, [field.name]: next ? 'yes' : '' })}
                />
              ) : field.type === 'date' ? (
                // A date picker, not a free-text YYYY-MM-DD: reception types dates
                // all day and a typo would come back as a 400 they cannot read.
                <DateField
                  key={field.name}
                  label={field.label}
                  value={values[field.name] ?? ''}
                  onChange={(value) => setValues({ ...values, [field.name]: value })}
                />
              ) : field.type === 'money' ? (
                // Pesos, grouped as they are typed. The dialog keeps the plain
                // number, so what reaches the API is unchanged.
                <MoneyField
                  key={field.name}
                  label={field.label}
                  placeholder={field.placeholder}
                  value={values[field.name] ?? ''}
                  onChange={(value) => setValues({ ...values, [field.name]: value })}
                />
              ) : field.type === 'contact' ? (
                // Stores the contact uuid, but the operator only ever sees names.
                <ContactField
                  key={field.name}
                  label={field.label}
                  orgId={orgId ?? ''}
                  i18n={i18n}
                  value={values[field.name] ?? ''}
                  // The picked contact's NAME travels beside its id, under
                  // `<field>_label`. A form that only reports the uuid forces
                  // every caller that needs a readable name to ask for it in a
                  // second field — and a dialog with "Paciente" and "Nombre del
                  // paciente" one beside the other is two questions for one
                  // answer. Callers that do not want it simply ignore the key.
                  onChange={(id, contact) =>
                    setValues({
                      ...values,
                      [field.name]: id,
                      [`${field.name}_label`]: contact?.label ?? '',
                    })
                  }
                />
              ) : field.type === 'combo' ? (
                // A picker with a way out: the list covers what a property normally
                // has, and "Otro…" still allows the one it does not.
                <YStack key={field.name} gap="$0.75">
                  <SelectField
                    label={field.label}
                    // A REAL select, never the typeahead. `SelectField` turns
                    // itself into one past ten options, and a combo is the one
                    // place that must not happen: eleven room types tipped it
                    // over, so the control looked like a picker and behaved
                    // like a text box. Typing already has its own door here —
                    // «Otro…» — and two ways to type into one field is how you
                    // get a room called "Sencilla " that matches nothing.
                    searchable={false}
                    value={freeText[field.name] ? OTHER : (values[field.name] ?? '')}
                    options={[
                      ...(field.options ?? []),
                      { value: OTHER, label: field.otherLabel ?? OTHER },
                    ]}
                    onChange={(value) => {
                      const other = value === OTHER
                      setFreeText({ ...freeText, [field.name]: other })
                      // Cleared on the way in, so the typed value starts empty and
                      // `required` still catches an operator who picks and skips.
                      setValues({ ...values, [field.name]: other ? '' : value })
                    }}
                  />
                  {freeText[field.name] ? (
                    <FormField
                      label={field.otherFieldLabel ?? field.label}
                      inputSize="md"
                      autoFocus
                      placeholder={field.placeholder}
                      value={values[field.name] ?? ''}
                      onChangeText={(value: string) =>
                        setValues({ ...values, [field.name]: value })
                      }
                    />
                  ) : null}
                </YStack>
              ) : field.type === 'select' ? (
                <SelectField
                  key={field.name}
                  label={field.label}
                  value={values[field.name] ?? ''}
                  options={field.options ?? []}
                  onChange={(value) => setValues({ ...values, [field.name]: value })}
                />
              ) : (
                <FormField
                  key={field.name}
                  label={field.label}
                  inputSize="md"
                  placeholder={field.placeholder}
                  keyboardType={field.type === 'number' ? 'numeric' : undefined}
                  value={values[field.name] ?? ''}
                  onChangeText={(value: string) => setValues({ ...values, [field.name]: value })}
                />
              )}
            </YStack>
          ))}
        </XStack>
        {error ? (
          <ErrorNote>{t('form.error', { detail: errorMessage(error, i18n) })}</ErrorNote>
        ) : null}
      </YStack>
    </Modal>
  )
}
