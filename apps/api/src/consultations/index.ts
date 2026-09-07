// The consultations module: the listing section ported from the legacy app's
// /dashboard/consultations, the note templates its picker reads, and the Jitsi
// room every consultation owns. One Elysia plugin per domain, mounted in
// src/index.ts.
import { Elysia } from 'elysia'
import { consultationsRoutes } from './routes/consultations'
import { meetingRoutes } from './routes/meeting'
import { workspaceRoutes } from './routes/workspace'
import { audioRoutes } from './routes/audio'
import { patientRoutes } from './routes/patient'
import { templatesRoutes } from './routes/templates'

export const consultationsModule = new Elysia()
  // The meeting routes are mounted FIRST: both they and the consultation
  // routes live under /api/consultations/:id, and the specific path has to be
  // matched before the generic one claims it.
  .use(meetingRoutes)
  .use(audioRoutes)
  // The patient's link and the public session it opens. Mounted before the
  // generic /api/consultations/:id routes for the same reason as the meeting.
  .use(patientRoutes)
  .use(workspaceRoutes)
  .use(consultationsRoutes)
  .use(templatesRoutes)
