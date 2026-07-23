import Anthropic from '@anthropic-ai/sdk'
import { clientForRequest, unauthorized } from '@/lib/server'

/** GET: is receipt AI configured on the server? (The key itself never leaves the server.) */
export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  return Response.json({ configured: !!process.env.ANTHROPIC_API_KEY })
}

/** POST: "test extraction" button — makes one tiny model call to prove the key works. */
export async function POST(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ ok: false, error: 'No ANTHROPIC_API_KEY configured on the server.' })

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    })
    const text = response.content.find((b) => b.type === 'text')
    return Response.json({ ok: true, model: response.model, reply: text?.type === 'text' ? text.text : '' })
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
