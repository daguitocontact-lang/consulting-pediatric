import { runWebhookStream } from '@daguito/sdk'
const API = process.env.DAGUITO_STREAM_API_URL!
const KEY = process.env.DAGUITO_STREAM_API_KEY!
const res = await fetch(`${API}/api/sdk/flows?slug=consultation-chatbot`, { headers: { authorization: `Bearer ${KEY}` } })
const wh = await res.json() as any
console.log('webhook:', wh.webhook_id)
const out = await runWebhookStream({
  apiUrl: API,
  webhookId: wh.webhook_id,
  token: wh.webhook_token,
  sessionKey: 'chatbot:probe-' + Date.now(),
  text: '¿Qué dosis de acetaminofén para una niña de 16 kg?',
  input: { context: { template_context: 'Sin nota.', transcript: 'Fiebre de 3 días.', language: 'es' } },
  timeoutMs: 90000,
})
console.log('status:', out.status, '| elapsed:', out.elapsedMs)
console.log('output type:', typeof out.output)
console.log('output:', JSON.stringify(out.output).slice(0, 1500))
