// The consultations module: the listing section ported from the legacy app's
// /dashboard/consultations, plus the note templates its picker reads. One
// Elysia plugin per domain, mounted in src/index.ts.
import { Elysia } from 'elysia'
import { consultationsRoutes } from './routes/consultations'
import { templatesRoutes } from './routes/templates'

export const consultationsModule = new Elysia().use(consultationsRoutes).use(templatesRoutes)
