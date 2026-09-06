/**
 * Where a passenger's ID scan lives: a PRIVATE R2 bucket, reached only from
 * here.
 *
 * The browser never talks to the bucket. It uploads to this API and reads back
 * through this API, so the bucket needs no public domain, no CORS rule and no
 * credential in the panel — and a leaked object key buys nothing, because every
 * read still goes through the org check in `requireOrg`. It costs the bytes a
 * hop through Fargate, which for two photos of a cédula per passenger is
 * nothing next to shipping R2 credentials to a browser.
 *
 * Dev has no R2: without the four R2_* variables the same three functions write
 * to a folder (`STORAGE_DIR`, `.storage/` by default, gitignored). This is NOT
 * fail-closed like DATABASE_URL — a missing bucket in prod must not keep the
 * API from serving reservations; it degrades to "documents are stored on the
 * task's disk", which the boot log says out loud.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** What the operator can hand us: a photo, or a scan that came out as a PDF. */
export const DOCUMENT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const
export type DocumentMime = (typeof DOCUMENT_MIME)[number]

const EXTENSION: Record<DocumentMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

const BY_EXTENSION: Record<string, DocumentMime> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

const account = process.env.R2_ACCOUNT_ID ?? ''
const bucket = process.env.R2_BUCKET ?? ''
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? ''
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? ''
const localDir = resolve(process.env.STORAGE_DIR ?? '.storage')

const r2 =
  account && bucket && accessKeyId && secretAccessKey
    ? new Bun.S3Client({
        bucket,
        accessKeyId,
        secretAccessKey,
        // R2 is S3-compatible but has no regions; "auto" is what it signs with.
        endpoint: `https://${account}.r2.cloudflarestorage.com`,
        region: 'auto',
      })
    : null

export const storageDriver: 'r2' | 'fs' = r2 ? 'r2' : 'fs'

console.log(
  r2
    ? `[storage] R2 bucket ${bucket}`
    : `[storage] no R2_* configured — documents go to ${localDir} (dev only)`,
)

/** The extension is ours to choose, so the type can be read back off the key. */
export function extensionFor(mime: string): string | null {
  return EXTENSION[mime as DocumentMime] ?? null
}

export function mimeOf(key: string): string {
  return BY_EXTENSION[key.split('.').pop() ?? ''] ?? 'application/octet-stream'
}

/**
 * Keys are built here, never taken from a client — but the fs driver turns one
 * into a path, and a path is exactly where a `..` would be worth trying. Both
 * drivers refuse anything that is not the shape we write.
 */
function safeKey(key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.includes('..')) {
    throw new Error('invalid object key')
  }
  return key
}

export async function putObject(key: string, data: ArrayBuffer, mime: string): Promise<void> {
  safeKey(key)
  if (r2) {
    await r2.write(key, data, { type: mime })
    return
  }
  const path = join(localDir, key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, new Uint8Array(data))
}

/** `null` when the object is gone — a key in the DB whose bytes no longer are. */
export async function getObject(key: string): Promise<ArrayBuffer | null> {
  safeKey(key)
  if (r2) {
    const file = r2.file(key)
    if (!(await file.exists())) return null
    return file.arrayBuffer()
  }
  const buffer = await readFile(join(localDir, key)).catch(() => null)
  if (!buffer) return null
  // Node hands back a Buffer over a pooled allocation: copy out the slice that
  // is actually this file's, or the Blob carries the whole pool.
  const { byteOffset, byteLength } = buffer
  return buffer.buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer
}

/**
 * Best-effort: this only ever runs on the object a replacement displaced, or on
 * one whose row is already gone. A bucket that hiccups must not turn "the
 * passenger's new photo is saved" into an error the operator sees.
 */
export async function deleteObject(key: string): Promise<void> {
  try {
    safeKey(key)
    if (r2) await r2.delete(key)
    else await rm(join(localDir, key), { force: true })
  } catch (err) {
    console.error('[storage] delete failed (continuing):', key, err)
  }
}

/** Where a traveler's scan goes. The random part is what keeps a replaced photo
 *  from being served from a browser cache under the name of the new one. */
export function documentKey(p: {
  orgId: string
  travelerId: string
  side: string
  mime: DocumentMime
}): string {
  const org = p.orgId.replace(/[^A-Za-z0-9_-]/g, '_')
  const name = `${p.side}-${crypto.randomUUID()}.${EXTENSION[p.mime]}`
  return safeKey(`${org}/travelers/${p.travelerId}/${name}`)
}
