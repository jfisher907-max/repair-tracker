import Anthropic from '@anthropic-ai/sdk'
import { clientForRequest, unauthorized } from '@/lib/server'

// Reading a supplier quote (an O'Reilly Pro cart/quote screenshot or its
// printed PDF) into quote lines, so Jake builds the parts list once. Same
// small/cheap model as receipt reading. Nothing is saved here: the lines go
// back to the quote form, where he checks them against the screen.
const MODEL = 'claude-haiku-4-5'

const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type SupportedMedia = (typeof SUPPORTED_MEDIA)[number]

/** Only files the quote form uploaded for this purpose. */
const QUOTE_FILE = new RegExp('^quotes/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp|gif|pdf)$')

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store', 'lines'],
  properties: {
    store: { type: ['string', 'null'], description: 'Supplier name, if shown' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'line_code', 'part_number', 'description', 'qty', 'unit_cost', 'unit_list', 'unit_price', 'kind', 'confidence',
        ],
        properties: {
          line_code: {
            type: ['string', 'null'],
            description: 'The short supplier line code printed before the part number, e.g. "STD" in "STD UF504". Null if none.',
          },
          part_number: {
            type: ['string', 'null'],
            description: 'The part number WITHOUT the line code, e.g. "UF504". Null when not clearly printed — never guessed.',
          },
          description: {
            type: 'string',
            description: 'The product title as printed. Keep words like Remanufactured, Rebuilt or Used.',
          },
          qty: { type: 'number' },
          unit_cost: {
            type: ['number', 'null'],
            description:
              'Per-unit dollars from the column naming what the SHOP pays — headed Cost, Your Cost, Your Price, Net or Dealer. Null unless such a column is visible.',
          },
          unit_list: {
            type: ['number', 'null'],
            description:
              'Per-unit dollars from the suggested-retail column — headed List, Retail, MSRP or Suggested. Null unless such a column is visible.',
          },
          unit_price: {
            type: ['number', 'null'],
            description:
              'Per-unit dollars from a price column with none of those headings (e.g. a bare "Price"). Null otherwise.',
          },
          kind: { type: 'string', enum: ['part', 'core', 'fee', 'labor', 'tax'] },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
      },
    },
  },
} as const

const PROMPT = `This is a parts quote or shopping cart from an auto-parts supplier's professional site or app (usually O'Reilly Auto Parts) — a screenshot or a printed PDF. Extract every line. Rules:
- NEVER guess which column a price came from. A column headed Cost, Your Cost, Your Price, Net or Dealer is unit_cost (what the shop pays). A column headed List, Retail, MSRP or Suggested is unit_list. Any other price column goes in unit_price — the app leaves those blank for the owner to place, so putting a figure there is safe and guessing is not. A figure you can't place goes nowhere (null).
- line_code is the short letters printed before the part number ("STD UF504" -> line_code "STD", part_number "UF504"). Never invent part numbers; null when unclear.
- kind: "part" for parts and fluids; "core" for core charges or deposits; "fee" for freight, delivery or shop fees; "labor" for labor lines; "tax" for tax lines.
- Keep the product title as printed, including words like Remanufactured.
- qty defaults to 1 when not printed. Prices are per unit, in dollars.
- Mark anything blurry, cut off or uncertain with confidence "low".`

export interface SupplierQuoteLine {
  line_code: string | null
  part_number: string | null
  description: string
  qty: number
  unit_cost: number | null
  unit_list: number | null
  unit_price: number | null
  kind: 'part' | 'core' | 'fee' | 'labor' | 'tax'
  confidence: 'high' | 'low'
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function validate(raw: unknown): { store: string | null; lines: SupplierQuoteLine[] } {
  if (typeof raw !== 'object' || raw === null) throw new Error('not an object')
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.lines)) throw new Error('lines missing')
  const kinds = ['part', 'core', 'fee', 'labor', 'tax'] as const
  const lines = o.lines
    .map((l) => l as Record<string, unknown>)
    .filter((l) => typeof l.description === 'string' && l.description.trim())
    .map((l) => ({
      line_code: str(l.line_code),
      part_number: str(l.part_number),
      description: (l.description as string).trim(),
      qty: num(l.qty) && (l.qty as number) > 0 ? (l.qty as number) : 1,
      unit_cost: num(l.unit_cost),
      unit_list: num(l.unit_list),
      unit_price: num(l.unit_price),
      kind: (kinds as readonly string[]).includes(l.kind as string) ? (l.kind as SupplierQuoteLine['kind']) : 'part',
      confidence: l.confidence === 'low' ? ('low' as const) : ('high' as const),
    }))
  return { store: str(o.store), lines }
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

  const { path } = await request.json().catch(() => ({}))
  if (typeof path !== 'string' || !QUOTE_FILE.test(path)) {
    return Response.json({ error: 'a quote file path is required' }, { status: 400 })
  }

  // The owner's own session reads it — storage policies scope the bucket.
  const { data: blob, error: dlErr } = await supabase.storage.from('receipts').download(path)
  if (dlErr || !blob) return Response.json({ error: 'could not read that file' }, { status: 422 })

  const isPdf = /\.pdf$/i.test(path) || blob.type === 'application/pdf'
  const mediaType = isPdf ? null : mediaTypeFor(path, blob.type)
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
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [{ role: 'user' as const, content: [fileBlock, { type: 'text' as const, text: PROMPT }] }],
    }
    const response = await client.messages.create(params as unknown as Anthropic.MessageCreateParamsNonStreaming)
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('no text in response')
    return Response.json(validate(JSON.parse(textBlock.text)))
  } catch {
    return Response.json({ error: 'could not read the quote' }, { status: 422 })
  }
}
