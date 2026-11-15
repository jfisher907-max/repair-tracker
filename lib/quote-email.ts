// The estimate written out as an email, for customers who only use email
// (Jake, 2026-11-15: "I don't want to necessarily just send a link ... I want
// the link to populate similarly to how our text system works").
//
// It is a mailto: link, not a server send. Tapping it opens Jake's own mail app
// with the To, Subject and Body already filled in, the way "Send link" fills a
// text message. So it goes out from his own address, the customer's reply comes
// back to him, he can read or change it before it leaves, and nothing new is
// needed on the server (Resend is not set up to send to customers).
//
// A mailto body is PLAIN TEXT, so the estimate is laid out in lines rather than
// as a table. It carries the same figures the printed estimate and the
// customer's link show, in the same words (lib/service-line PAPER), and nothing
// that link does not show: no notes, no costs, no profit. The link is still
// where the customer approves, because only the link records who approved,
// when, and which lines.

import { BRAND_NAME } from './brand'
import { formatCents } from './money'
import { formatDate } from './date'
import { formatTaxRate } from './billing'
import { PAPER, serviceMarkText, type ServiceLine, type ServiceMarks } from './service-line'
import type { QuoteStatus } from './types'

export interface QuoteEmailInput {
  status: QuoteStatus
  quoteNumber: string
  title: string
  /** The quote's description, which the customer's link also shows. */
  description: string | null
  validUntil: string | null
  customerName: string
  customerEmail: string | null
  /** As the estimate prints it: "2014 Subaru Outback 2.5i" / "N254AL · 2008 Learjet 45". */
  vehicleLabel: string
  serviceLine: ServiceLine
  marks: ServiceMarks
  /** The lines that stand to be agreed (customer-declined ones already out). */
  lines: { description: string; qty: number; unit_charge_cents: number; line_total_cents: number }[]
  linesCents: number
  laborHours: number
  laborRateCents: number
  laborCents: number
  taxRateBp: number
  taxCents: number
  totalCents: number
  depositCents: number | null
  businessName: string
  businessPhone: string
  /** The customer's link, /q/<token>. */
  link: string
}

export interface QuoteEmail {
  to: string
  subject: string
  body: string
  /** The mailto: URL that opens the mail app with all of the above. */
  href: string
}

/** "2" not "2.00", "1.5" not "1.50". */
function qtyText(n: number): string {
  return String(Number(n.toFixed(2)))
}

export function buildQuoteEmail(q: QuoteEmailInput): QuoteEmail {
  const paper = PAPER[q.serviceLine]
  const business = q.businessName.trim() || BRAND_NAME
  const title = q.title.trim()
  const total = formatCents(q.totalCents)
  const deposit = q.depositCents ?? 0
  // Still waiting on the customer: ask them to approve. Otherwise this is a copy.
  const asking = q.status === 'draft' || q.status === 'sent'

  // A car customer is a person; an aircraft customer is often an operator,
  // where "Hi Airlift," would read wrong. Jake can change it before sending.
  const name = q.customerName.trim()
  const greeting =
    q.serviceLine === 'automotive' && name ? `Hi ${name.split(/\s+/)[0]},` : name ? `Hello ${name},` : 'Hello,'

  const forWhat = q.vehicleLabel.trim()
    ? q.serviceLine === 'automotive'
      ? ` for your ${q.vehicleLabel.trim()}`
      : ` for ${q.vehicleLabel.trim()}`
    : ''
  const opening = asking
    ? `Here's your ${paper.quoteLower} from ${business}${forWhat}.`
    : q.status === 'approved'
      ? `Here's a copy of the ${paper.quoteLower} you approved${forWhat}.`
      : `Here's a copy of your ${paper.quoteLower} from ${business}${forWhat}.`

  const out: string[] = [greeting, '', opening, '']

  out.push(`${paper.quote} ${q.quoteNumber}${title ? ` - ${title}` : ''}`)
  if (q.validUntil) out.push(`Valid until ${formatDate(q.validUntil)}`)
  // AOG / Nights & weekends: aircraft paper only, the same words the link prints.
  const marks = q.serviceLine === 'aviation' ? serviceMarkText(q.marks) : null
  if (marks) out.push(marks)

  const description = q.description?.trim()
  if (description) out.push('', description)

  if (q.lines.length > 0) {
    out.push('')
    for (const l of q.lines) {
      const qty = Number(l.qty)
      out.push(
        qty === 1
          ? `- ${l.description}: ${formatCents(l.line_total_cents)}`
          : `- ${l.description} (${qtyText(qty)} x ${formatCents(l.unit_charge_cents)}): ${formatCents(l.line_total_cents)}`,
      )
    }
  }

  // The totals, row for row as the estimate prints them (DocView).
  out.push('')
  if (q.linesCents !== 0) out.push(`Parts: ${formatCents(q.linesCents)}`)
  if (q.laborCents !== 0) {
    const how = q.laborHours > 0 ? ` (${qtyText(q.laborHours)} hr @ ${formatCents(q.laborRateCents)}/hr)` : ''
    out.push(`Labor${how}: ${formatCents(q.laborCents)}`)
  }
  if (q.taxRateBp > 0) out.push(`Sales tax (${formatTaxRate(q.taxRateBp)}): ${formatCents(q.taxCents)}`)
  out.push(`${paper.quotedTotal}: ${total}`)
  if (deposit > 0) out.push(`Deposit due on approval: ${formatCents(deposit)}`)

  out.push('')
  if (asking) {
    out.push(
      `To approve it, open your ${paper.quoteLower} at the link below and type your name. ` +
        `If there's a line you don't want, uncheck it first and approve the rest.` +
        (deposit > 0 ? ` The ${formatCents(deposit)} deposit is due when you approve.` : ''),
      '',
      q.link,
    )
  } else {
    out.push(`You can see it any time here:`, '', q.link)
  }

  // The posted-notice wording the estimate itself ends with (AS 45.45.150 on a car).
  out.push('', paper.quoteFooter, '', 'Questions? Just reply to this email.', '', 'Thanks,', business)
  const phone = q.businessPhone.trim()
  if (phone) out.push(phone)

  const body = out.join('\n')
  const subject = `${paper.quote} ${q.quoteNumber} from ${business}${title ? `: ${title}` : ''} - ${total}`
  const to = q.customerEmail?.trim() ?? ''

  // RFC 6068: percent-encoded UTF-8, CRLF line breaks. The address keeps its @
  // and + literal (both are legal there) so no mail app has to decode it.
  const href =
    `mailto:${encodeURIComponent(to).replace(/%40/g, '@').replace(/%2B/g, '+')}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`

  return { to, subject, body, href }
}
