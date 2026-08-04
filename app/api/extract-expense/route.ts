import Anthropic from '@anthropic-ai/sdk'
import { clientForRequest, unauthorized } from '@/lib/server'

// Same small-model approach as job receipts — expense receipts are simpler
// (one total, a vendor, a date), so Haiku handles them easily.
const MODEL = 'claude-haiku-4-5'

const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type SupportedMedia = (typeof SUPPORTED_MEDIA)[number]

const CATEGORIES = [
  'Parts & materials', 'Tools & equipment', 'Shop supplies', 'Insurance', 'Rent',
  'Utilities', 'Advertising', 'Software & fees', 'Fuel & travel', 'Other',
]

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vendor', 'date', 'total', 'category', 'description'],
  properties: {
    vendor: { type: ['string', 'null'], description: 'Store/vendor name as printed' },
    date: { type: ['string', 'null'], description: 'Purchase date as YYYY-MM-DD, null if unreadable' },
    total: { type: ['number', 'null'], description: 'Grand total in dollars as printed' },
    category: { type: ['string', 'null'], enum: [...CATEGORIES, null], description: 'Best-fit expense category' },
    description: { type: ['string', 'null'], description: 'Short summary of what was bought, e.g. "impact sockets + zip ties"' },
  },
} as const

const PROMPT = `This is a business-expense receipt for a small auto repair shop. Extract:
- vendor: the store name as printed (null if unreadable)
- date: purchase date as YYYY-MM-DD (null if unreadable)
- total: the grand total in dollars as printed
- category: best fit from the allowed list (tools -> "Tools & equipment", consumables like gloves/cleaner -> "Shop supplies", gas -> "Fuel & travel", etc.)
- description: a short human summary of what was purchased (a few words)
Prefer null over guessing. Ignore marketing text and surveys.`

function mediaTypeFor(path: string, blobType: string): SupportedMedia | null {
  if ((SUPPORTED_MEDIA as readonly string[]).includes(blobType)) return blobType as SupportedMedia
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return null
}

export async function POST(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  const { supabase } = auth

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'not_configured' }, { status: 501 })

  const { storagePath } = await request.json().catch(() => ({}))
  // Expense uploads live under expenses/ in the receipts bucket — refuse
  // anything else so this can't be pointed at arbitrary objects.
  if (typeof storagePath !== 'string' || !/^expenses\/[\w-]+\.[a-z0-9]+$/i.test(storagePath)) {
    return Response.json({ error: 'invalid storagePath' }, { status: 400 })
  }

  const { data: blob, error: dlErr } = await supabase.storage.from('receipts').download(storagePath)
  if (dlErr || !blob) return Response.json({ error: 'could not download image' }, { status: 422 })

  const isPdf = /\.pdf$/i.test(storagePath) || blob.type === 'application/pdf'
  const mediaType = isPdf ? null : mediaTypeFor(storagePath, blob.type)
  if (!isPdf && !mediaType) return Response.json({ error: 'unsupported file type' }, { status: 422 })

  const fileData = Buffer.from(await blob.arrayBuffer()).toString('base64')

  try {
    const client = new Anthropic({ apiKey })
    const fileBlock = isPdf
      ? {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData },
        }
      : {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: mediaType!, data: fileData },
        }
    const params = {
      model: MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        { role: 'user' as const, content: [fileBlock, { type: 'text' as const, text: PROMPT }] },
      ],
    }
    const response = await client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    )
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('no text in response')
    const raw = JSON.parse(textBlock.text) as Record<string, unknown>
    return Response.json({
      vendor: typeof raw.vendor === 'string' ? raw.vendor : null,
      date: typeof raw.date === 'string' ? raw.date : null,
      total: typeof raw.total === 'number' && Number.isFinite(raw.total) ? raw.total : null,
      category:
        typeof raw.category === 'string' && CATEGORIES.includes(raw.category) ? raw.category : null,
      description: typeof raw.description === 'string' ? raw.description : null,
    })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'extraction failed' },
      { status: 422 },
    )
  }
}
