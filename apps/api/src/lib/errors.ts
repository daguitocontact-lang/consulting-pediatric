/**
 * Turn a thrown error into something safe to hand a client.
 *
 * The routes used to answer `err.message` straight, and for a Postgres failure
 * that message is the SERVER's: posting a reservation whose check-out precedes
 * its check-in came back as
 *
 *   new row for relation "reservations" violates check constraint "reservations_dates"
 *
 * — table name, constraint name and schema shape, to anyone with a token. It is
 * also useless to the operator, who wanted "the dates are backwards".
 *
 * Same split Daguito draws in its own `lib/errors.ts`: an error WE threw carries
 * a message we wrote on purpose (`product not found`) and passes through
 * untouched; a Postgres error is replaced by a stable code and neutral copy,
 * with the full detail logged server-side where it belongs.
 */

/** What the driver gives us for a database failure. */
type PostgresLikeError = Error & {
  code: string
  constraint_name?: string
  table_name?: string
  column_name?: string
  detail?: string
}

function isPostgresError(error: unknown): error is PostgresLikeError {
  return (
    error instanceof Error &&
    error.name === 'PostgresError' &&
    typeof (error as PostgresLikeError).code === 'string'
  )
}

export type SafeError = { status: number; body: { error: string; code: string } }

/**
 * SQLSTATE → a controlled answer.
 *
 * The `code` is the stable part — the panel can localise it — while the message
 * is a neutral fallback for anything reading the API directly. Neither ever
 * names a table, a column or a constraint.
 */
function mapPostgres(error: PostgresLikeError): SafeError {
  switch (error.code) {
    case '23505': // unique_violation
      return { status: 409, body: { error: 'That record already exists.', code: 'already_exists' } }
    case '23503': // foreign_key_violation
      return {
        status: 409,
        body: { error: 'A related record is missing or still in use.', code: 'reference_conflict' },
      }
    case '23502': // not_null_violation
      return { status: 400, body: { error: 'A required field is missing.', code: 'missing_field' } }
    case '23514': // check_violation
      return { status: 400, body: { error: 'A value is invalid.', code: 'invalid_value' } }
    case '22P02': // invalid_text_representation — a malformed uuid, usually
      return { status: 400, body: { error: 'A value is malformed.', code: 'invalid_value' } }
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return {
        status: 409,
        body: { error: 'The request conflicted, please retry.', code: 'conflict_retry' },
      }
    default:
      return { status: 500, body: { error: 'Something went wrong.', code: 'internal_error' } }
  }
}

/**
 * `fallbackStatus` is what OUR OWN errors get — the routes already know whether
 * their failure mode is a 400 (bad booking) or a 409 (duplicate service), and
 * that judgement is theirs to keep.
 */
export function safeError(error: unknown, fallbackStatus: number, fallbackCode: string): SafeError {
  if (isPostgresError(error)) {
    // Logged in full, returned in none: this is the line to read when a client
    // reports "a value is invalid" and nobody knows which.
    console.error('[db] sanitized for client:', {
      sqlstate: error.code,
      constraint: error.constraint_name,
      table: error.table_name,
      column: error.column_name,
      detail: error.detail,
    })
    return mapPostgres(error)
  }
  return {
    status: fallbackStatus,
    body: {
      error: error instanceof Error ? error.message : 'request failed',
      code: fallbackCode,
    },
  }
}
