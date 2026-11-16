// The invoice written out as an email: the invoice-side twin of the emailed
// estimate (lib/quote-email). Jake, 2026-11-15: "add the same button for
// invoices".
//
// The same mailto: approach. Tapping it opens Jake's own mail app with the To,
// Subject and Body filled in, the way "Send link" fills a text, so it leaves
// from his address and the reply comes back to him.
//
// It carries what the invoice itself prints and the customer's link shows
// (get_public_invoice), in the same words: the lines and their part conditions
// on car paper, the totals, any payments to date, the balance, the notes for
// the customer, the payment instructions and the AS 45.45.210 notice. It
// carries nothing the link does not: no costs, no profit, no tax-exemption
// note, no owner-only books.
//
// The figures are the invoice's own frozen snapshot, never recomputed from the
// job (an invoice is immutable once sent). "Paid to date" is every payment on
// the job, which the printed invoice and the link both count the same way.

import { BRAND_NAME } from './brand'
import { formatCents } from './money'
import { formatDate } from './date'
import { formatTaxRate } from './billing'
import { forWhatText, greetingFor, lineText, mailtoHref, qtyText } from './mailto'
import {
  CONDITION_LABEL,
  REPAIR_ACT_NOTICE,
  needsPartConditions,
  printsRepairActNotice,
  serviceMarkText,
  type ServiceLine,
  type ServiceMarks,
} from './service-line'
import type { DocLine, InvoiceStatus } from './types'

export interface InvoiceEmailInput {
  status: InvoiceStatus
  invoiceNumber: string
  /** The job title the invoice froze. */
  title: string
  /** The work performed, which the invoice and its link print under the title. */
  workPerformed: string | null
  issueDate: string
  dueDate: string | null
  customerName: string
  customerEmail: string | null
  /** As the invoice prints it: "2014 Subaru Outback 2.5i" / "N254AL · 2008 Learjet 45". */
  vehicleLabel: string
  serviceLine: ServiceLine
  marks: ServiceMarks
  lines: DocLine[]
  linesCents: number
  laborHours: number
  laborRateCents: number
  laborCents: number
  taxRateBp: number
  taxCents: number
  totalCents: number
  /** Every payment on the job: what the invoice prints as Paid to date. */
  paidCents: number
  /** The day it was settled, or null. */
  paidDate: string | null
  /** Notes for the customer (the invoice's memo), which the link shows. */
  memo: string | null
  /** Settings' invoice payment instructions, which the invoice's footer prints. */
  paymentInstructions: string | null
  /** Whether the customer's link offers Pay by card right now (/api/pay/status). */
  cardOffered: boolean
  businessName: string
  businessPhone: string
  /** The customer's link, /i/<token>. */
  link: string
}

export interface InvoiceEmail {
  to: string
  subject: string
  body: string
  /** The mailto: URL that opens the mail app with all of the above. */
  href: string
}

export function buildInvoiceEmail(i: InvoiceEmailInput): InvoiceEmail {
  const business = i.businessName.trim() || BRAND_NAME
  const title = i.title.trim()
  const total = formatCents(i.totalCents)
  const paid = i.paidCents
  // Settled and balance exactly as the printed invoice decides them (DocView).
  const settled = i.paidDate != null || (paid > 0 && paid >= i.totalCents)
  const balance = Math.max(0, i.totalCents - paid)

  const forWhat = forWhatText(i.vehicleLabel, i.serviceLine)
  const opening = settled
    ? `Here's a copy of your invoice from ${business}${forWhat}. It's paid in full. Thank you!`
    : `Here's your invoice from ${business}${forWhat}.`

  const out: string[] = [greetingFor(i.customerName, i.serviceLine), '', opening, '']

  out.push(`Invoice ${i.invoiceNumber}${title ? ` - ${title}` : ''}`)
  out.push(`Issued ${formatDate(i.issueDate)}`)
  if (i.dueDate && !settled) out.push(`Due ${formatDate(i.dueDate)}`)
  // AOG / Nights & weekends: aircraft paper only, the same words the link prints.
  const marks = i.serviceLine === 'aviation' ? serviceMarkText(i.marks) : null
  if (marks) out.push(marks)

  const work = i.workPerformed?.trim()
  if (work) out.push('', work)

  if (i.lines.length > 0) {
    // New / Used / Rebuilt / Reconditioned beside each part (AS 45.45.190),
    // only where the paper prints them.
    const tags = needsPartConditions(i.serviceLine)
    out.push('')
    for (const l of i.lines) out.push(lineText(l, tags && l.condition ? CONDITION_LABEL[l.condition] : null))
  }

  // The totals, row for row as the invoice prints them (DocView).
  out.push('')
  if (i.linesCents !== 0) out.push(`Parts: ${formatCents(i.linesCents)}`)
  if (i.laborCents !== 0) {
    const how = i.laborHours > 0 ? ` (${qtyText(i.laborHours)} hr @ ${formatCents(i.laborRateCents)}/hr)` : ''
    out.push(`Labor${how}: ${formatCents(i.laborCents)}`)
  }
  if (i.taxRateBp > 0) out.push(`Sales tax (${formatTaxRate(i.taxRateBp)}): ${formatCents(i.taxCents)}`)
  out.push(`Total: ${total}`)
  if (paid > 0 && paid < i.totalCents) out.push(`Paid to date: -${formatCents(paid)}`)
  if (settled) {
    out.push(`Paid in full${i.paidDate ? `, received ${formatDate(i.paidDate)}` : ''}`)
  } else {
    out.push(`Balance due: ${formatCents(balance)}${i.dueDate ? ` by ${formatDate(i.dueDate)}` : ''}`)
  }

  const memo = i.memo?.trim()
  if (memo) out.push('', `Notes: ${memo}`)

  out.push('')
  if (settled) {
    out.push(`You can see it any time here:`, '', i.link)
  } else {
    out.push(
      i.cardOffered && balance > 0
        ? `The full invoice is at the link below, and you can pay the ${formatCents(balance)} by card there.`
        : `The full invoice is at the link below.`,
      '',
      i.link,
    )
    const how = i.paymentInstructions?.trim()
    if (how) out.push('', `Payment: ${how}`)
  }

  // The motor-vehicle notice the invoice prints (AS 45.45.210): car paper only.
  if (printsRepairActNotice(i.serviceLine)) out.push('', REPAIR_ACT_NOTICE)
  out.push('', 'Questions? Just reply to this email.', '', 'Thanks,', business)
  const phone = i.businessPhone.trim()
  if (phone) out.push(phone)

  const body = out.join('\n')
  const subject =
    `Invoice ${i.invoiceNumber} from ${business}${title ? `: ${title}` : ''} - ${total}` +
    (settled ? ', paid in full' : '')
  const to = i.customerEmail?.trim() ?? ''

  return { to, subject, body, href: mailtoHref(to, subject, body) }
}
