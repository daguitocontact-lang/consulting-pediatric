/**
 * Plantillas — the structure a consultation's note is written into.
 *
 * This section exists because a template is not a label. What the doctor writes
 * here reaches the flow as `template_body` in the base_input, and `c_soap`
 * fills THIS document: the markdown comes back exactly as authored with each
 * `[[…]]` swapped for what was said. Before there was a body to write, picking
 * a template on a consultation changed nothing at all — the engine wrote its
 * own generic SOAP note and the picker was decoration.
 *
 * The legacy app spreads the same job over a page, a dock panel and an editor
 * with a preview. This is the half that matters: the list, and the body.
 */
import { useCallback, useEffect, useState } from 'react'
import { FileText, Plus, Trash2 } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage, type MountProps } from '../lib/api'
import { translator } from '../lib/i18n'
import { useAsync } from '../lib/useAsync'
import { PageShell, ErrorNote } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Badge, Button, InputFrame, Spinner } from '../components/ui'
import { TemplateAssistant } from '../components/TemplateAssistant'

export type Template = {
  id: string
  title: string
  body: string
  scope: 'org' | 'personal'
  active: boolean
}

/**
 * The starting point a new template gets.
 *
 * Not empty: a blank editor with "write [[placeholders]]" in a hint is a blank
 * editor, and the one thing a doctor needs to see is what a filled placeholder
 * looks like next to fixed text that survives untouched.
 */
const STARTER = `## Motivo de consulta

[[el motivo por el que consultan, en una frase]]

## Antecedentes

[[antecedentes relevantes: enfermedades, alergias, medicación habitual]]

## Examen físico

[[hallazgos del examen físico]]

## Diagnóstico

[[diagnóstico o impresión diagnóstica]]

## Plan

[[indicaciones, tratamiento y controles]]
`

export function Page(props: MountProps) {
  const i18n = translator(props.locale)
  const { t } = i18n
  const toast = useToast()

  const state = useAsync<{ templates: Template[] }>(
    () => apiGet<{ templates: Template[] }>(props, '/api/consultation-templates'),
    [props.token, props.apiBase],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null)

  const templates = state.data?.templates ?? []
  const selected = templates.find((template) => template.id === selectedId) ?? null

  // Open on the first template, and follow the selection into the editor. The
  // body is held locally while it is being typed: a refresh that re-read the
  // list mid-sentence would throw the sentence away.
  useEffect(() => {
    if (!templates.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !templates.some((template) => template.id === selectedId)) {
      setSelectedId(templates[0]!.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length])

  useEffect(() => {
    setTitle(selected?.title ?? '')
    setBody(selected?.body ?? '')
  }, [selected?.id, selected?.title, selected?.body])

  const create = useCallback(async () => {
    setSaving(true)
    try {
      const { template } = await apiPost<{ template: Template }>(
        props,
        '/api/consultation-templates',
        { title: t('template.new.title'), body: STARTER },
      )
      await state.reload()
      setSelectedId(template.id)
    } catch (err) {
      toast.error(errorMessage(err, i18n))
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props])

  const save = useCallback(async () => {
    if (!selected) return
    setSaving(true)
    try {
      await apiPatch(props, `/api/consultation-templates/${selected.id}`, { title, body })
      await state.reload()
      toast.success(t('template.body.saved'))
    } catch (err) {
      toast.error(errorMessage(err, i18n))
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, selected, title, body])

  const remove = useCallback(
    async (template: Template) => {
      try {
        const { outcome } = await apiDelete<{ outcome: string }>(
          props,
          `/api/consultation-templates/${template.id}`,
        )
        await state.reload()
        // Retired, not deleted, when consultations still point at it — the
        // difference is worth saying: the old notes keep their template name.
        toast.success(
          outcome === 'deactivated' ? t('template.retired') : t('template.deleted'),
        )
      } catch (err) {
        toast.error(errorMessage(err, i18n))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props],
  )

  if (state.loading) {
    return (
      <PageShell title={t('nav.templates')}>
        <YStack alignItems="center" padding="$3">
          <Spinner />
        </YStack>
      </PageShell>
    )
  }

  return (
    <PageShell
      title={t('nav.templates')}
      actions={
        <Button size="sm" variant="primary" iconBefore={<Plus size={14} />} onPress={create}>
          {t('template.new')}
        </Button>
      }
    >
      {state.error ? (
        <ErrorNote>{errorMessage(state.error, i18n)}</ErrorNote>
      ) : (
        <XStack gap="$1.5" $sm={{ flexDirection: 'column' }} flex={1} minHeight={420}>
          {/* The list */}
          <YStack width={240} $sm={{ width: '100%' }} gap="$0.5">
            {templates.length === 0 ? (
              <Text fontSize={13} color="$color11" padding="$1">
                {t('template.empty')}
              </Text>
            ) : null}
            {templates.map((template) => (
              <XStack
                key={template.id}
                alignItems="center"
                gap="$0.5"
                padding="$1"
                borderRadius="$3"
                borderWidth={1}
                borderColor={template.id === selectedId ? '$actionText' : '$borderColor'}
                backgroundColor={
                  template.id === selectedId ? '$actionSurfaceHover' : '$background'
                }
                cursor="pointer"
                onPress={() => setSelectedId(template.id)}
              >
                <FileText size={14} color="$color10" />
                <YStack flex={1}>
                  <Text fontSize={13} color="$color" numberOfLines={1}>
                    {template.title}
                  </Text>
                  {/* A body-less template is the state that used to be the only
                      one, and it is worth flagging: it steers nothing. */}
                  {!template.body.trim() ? (
                    <Text fontSize={11} color="$color10">
                      {t('template.noBody')}
                    </Text>
                  ) : null}
                </YStack>
                {template.scope === 'personal' ? (
                  <Badge variant="neutral" size="sm">
                    {t('template.personal')}
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  iconBefore={<Trash2 size={13} />}
                  onPress={() => setConfirmDelete(template)}
                />
              </XStack>
            ))}
          </YStack>

          {/* The editor, with the bot beside it */}
          {selected ? (
            <XStack flex={1} gap="$1.5" $sm={{ flexDirection: 'column' }}>
            <YStack flex={1} gap="$1" minWidth={280}>
              <InputFrame
                fullWidth
                value={title}
                onChangeText={setTitle}
                placeholder={t('template.title')}
              />
              <Text fontSize={12} color="$color11">
                {t('template.body.hint')}
              </Text>
              {/* A plain textarea on purpose: this is markdown the doctor
                  authors, and a rich editor would fight the `[[…]]` syntax the
                  flow parses. */}
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                spellCheck
                style={{
                  flex: 1,
                  minHeight: 320,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid var(--borderColor)',
                  background: 'var(--background)',
                  color: 'var(--color)',
                  font: '13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
                  resize: 'vertical',
                }}
              />
              <XStack gap="$0.5">
                <Button size="sm" variant="primary" disabled={saving} onPress={save}>
                  {t('template.body.save')}
                </Button>
              </XStack>
            </YStack>

            {/* The bot writes to the ROW, not to this textarea, so when a turn
                edits it hands back the body as it now stands and the editor
                re-renders from that. Anything the doctor had typed and not
                saved would be lost, so the draft is saved first — an edit the
                bot cannot see is an edit it will overwrite. */}
            <YStack width={320} $sm={{ width: '100%' }}>
              <TemplateAssistant
                props={props}
                i18n={i18n}
                templateId={selected.id}
                onEdited={(nextBody) => {
                  setBody(nextBody)
                  void state.reload()
                }}
              />
            </YStack>
            </XStack>
          ) : null}
        </XStack>
      )}

      <ConfirmDialog
        i18n={i18n}
        open={confirmDelete !== null}
        title={t('template.delete.title')}
        body={confirmDelete?.title ?? ''}
        confirmLabel={t('form.delete')}
        onConfirm={async () => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) await remove(target)
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </PageShell>
  )
}
