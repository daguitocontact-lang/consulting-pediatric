// Home — the "under construction" proof: it calls /api/status with the
// Daguito-signed token and shows the version READ FROM the custom's DB, proving
// web → api(ECS) → db(RDS) end to end.
import { Text, YStack } from 'tamagui'
import { apiGet, errorMessage, type MountProps } from '../lib/api'
import { translator } from '../lib/i18n'
import { useAsync } from '../lib/useAsync'
import { Spinner } from '../components/ui'

type Status = { version: string | null; db_ok: boolean }

export function Page(props: MountProps) {
  const i18n = translator(props.locale)
  const { t } = i18n
  const { data, error, loading } = useAsync(
    () => apiGet<Status>(props, '/api/status'),
    [props.token, props.apiBase],
  )

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$1"
      padding="$3"
      minHeight={320}
    >
      <Text fontSize={56}>🚧</Text>
      <Text fontSize={24} fontWeight="700" letterSpacing={-0.3} color="$color">
        {t('home.title')}
      </Text>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Text fontSize={14} color="$error700">
          {t('home.offline', { detail: errorMessage(error, i18n) })}
        </Text>
      ) : (
        <Text fontSize={14} color={data?.db_ok ? '$success700' : '$error700'}>
          {t('home.status', { version: data?.version ?? '?', db: data?.db_ok ? '✓' : '✗' })}
        </Text>
      )}
    </YStack>
  )
}
