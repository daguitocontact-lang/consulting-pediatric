import { authorize, AuthError } from './auth'

/**
 * The gate EVERY data route goes through, shaped like Daguito's `requireManage`:
 * it returns an object instead of throwing, so handlers stay linear and no
 * over-wide try/catch swallows a business error and reports it as a 401.
 *
 *   const guard = await requireOrg(request)
 *   if (!guard.ok) { set.status = guard.status; return { error: guard.error } }
 *   // guard.orgId, guard.userId
 *
 * `authorize` already checks the RS256 signature, the audience and the org
 * allow-list; this only maps its failure to the right status. 401 = invalid
 * token, 403 = valid token from an org this custom does not serve.
 */
export type Guard =
  | { ok: true; orgId: string; userId: string; userName: string | null }
  | { ok: false; status: 401 | 403; error: 'unauthorized' | 'forbidden' }

export async function requireOrg(request: Request): Promise<Guard> {
  try {
    const { orgId, userId, userName } = await authorize(request)
    return { ok: true, orgId, userId, userName }
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401
    return { ok: false, status, error: status === 403 ? 'forbidden' : 'unauthorized' }
  }
}
