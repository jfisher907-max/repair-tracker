import Anthropic from '@anthropic-ai/sdk'
import { clientForRequest, unauthorized } from '@/lib/server'
import type { ExtractionResult } from '@/lib/types'

// Receipt reading is deliberately a small/cheap-model job (per the project
// spec) — a Haiku-class model handles line-item extraction fine.
const MODEL = 'claude-haiku-4-5'

const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type SupportedMedia = (typeof SUPPORTED_MEDIA)[number]

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store', 'purchase_date', 'receipt_total', 'lines'],
  properties: {
    store: { type: ['string', 'null'], description: 'Store/vendor name as printed' },
    purchase_date: { type: ['string', 'null'], description: 'Purchase date as YYYY-MM-DD, null if unreadable' },
    receipt_total: { type: ['number', 'null'], description: 'Grand total as printed, in dollars' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['part_number', 'description', 'qty', 'unit_cost', 'confidence'],
        properties: {
          part_number: { type: ['string', 'null'] },
          description: { type: 'string' },
          qty: { type: 'number' },
          unit_cost: { type: 'number', description: 'Per-unit price in dollars; negative for refunds/discounts' },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
      },
    },
  },
} as const

const PROMPT = `Extract the line items from this store receipt photo. Rules:
- Include EVERY charged line: parts, sales tax, core charges, shop fees, discounts and refunds (as negative unit_cost).
- NEVER invent or guess part numbers — use null when a part number is not clearly printed.
- Mark any value you are unsure about (faded, blurry, cut off) with confidence "low"; otherwise "high".
- Ignore marketing text, surveys, loyalty-program blurbs, and store addresses.
- qty defaults to 1 when not printed. unit_cost is the per-unit price so qty × unit_cost equals the line amount.
- receipt_total is the grand total as printed on the receipt.
Receipts are often thermal-faded, crumpled, or photographed at an angle — do your best, and prefer null/low confidence over guessing.`

function validateExtraction(raw: unknown): ExtractionResult {
  if (typeof raw !== 'object' || raw === null) throw new Error('not an object')
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.lines)) throw new Error('lines missing')
  const lines = o.lines.map((l) => {
    const line = l as Record<string, unknown>
    if (typeof line.description !== 'string' || !line.description.trim()) {
      throw new Error('line missing description')
    }
    return {
      part_number: typeof line.part_number === 'string' ? line.part_number : null,
      description: line.description,
      qty: typeof line.qty === 'number' && Number.isFinite(line.qty) ? line.qty : 1,
      unit_cost: typeof line.unit_cost === 'number' && Number.isFinite(line.unit_cost) ? line.unit_cost : 0,
      confidence: line.confidence === 'low' ? ('low' as const) : ('high' as const),
    }
  })
  return {
    store: typeof o.store === 'string' ? o.store : null,
    purchase_date: typeof o.purchase_date === 'string' ? o.purchase_date : null,
    receipt_total:
      typeof o.receipt_total === 'number' && Number.isFinite(o.receipt_total) ? o.receipt_total : null,
    lines,
  }
}

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

  const { receiptId } = await request.json().catch(() => ({}))
  if (typeof receiptId !== 'string') {
    return Response.json({ error: 'receiptId required' }, { status: 400 })
  }

  // RLS scopes this to the owner — a stranger's token finds no row.
  const { data: receipt, error: recErr } = await supabase
    .from('receipts')
    .select('id, storage_path')
    .eq('id', receiptId)
    .single()
  if (recErr || !receipt) return Response.json({ error: 'receipt not found' }, { status: 404 })

  async function markFailed(reason: string) {
    await supabase
      .from('receipts')
      .update({ extraction_status: 'failed', extraction_raw: { error: reason } })
      .eq('id', receiptId)
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from('receipts')
    .download(receipt.storage_path)
  if (dlErr || !blob) {
    await markFailed('download failed')
    return Response.json({ error: 'could not download image' }, { status: 422 })
  }

  // PDFs are first-class: Claude reads them natively as documents.
  const isPdf = /\.pdf$/i.test(receipt.storage_path) || blob.type === 'application/pdf'
  const mediaType = isPdf ? null : mediaTypeFor(receipt.storage_path, blob.type)
  if (!isPdf && !mediaType) {
    await markFailed(`unsupported file type: ${blob.type}`)
    return Response.json({ error: 'unsupported file type' }, { status: 422 })
  }

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
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [
        {
          role: 'user' as const,
          content: [fileBlock, { type: 'text' as const, text: PROMPT }],
        },
      ],
    }
    const response = await client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    )

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('no text in response')
    const extraction = validateExtraction(JSON.parse(textBlock.text))

    await supabase
      .from('receipts')
      .update({
        extraction_status: 'extracted',
        extraction_raw: JSON.parse(textBlock.text),
        store: extraction.store,
        purchase_date: extraction.purchase_date,
        receipt_total_cents:
          extraction.receipt_total != null ? Math.round(extraction.receipt_total * 100) : null,
      })
      .eq('id', receiptId)

    return Response.json(extraction)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    await markFailed(reason)
    return Response.json({ error: 'extraction failed' }, { status: 422 })
  }
}
