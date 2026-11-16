// What the estimate email (lib/quote-email) and the invoice email
// (lib/invoice-email) share: the greeting, the line and quantity wording, and
// the mailto: URL itself. One copy, so the two emails can't drift apart.

import { formatCents } from './money'
import type { ServiceLine } from './service-line'

/** "2" not "2.00", "1.5" not "1.50". */
export function qtyText(n: number): string {
  return String(Number(n.toFixed(2)))
}

/**
 * A car customer is a person; an aircraft customer is often an operator,
 * where "Hi Airlift," would read wrong. Jake can change it before sending.
 */
export function greetingFor(customerName: string, line: ServiceLine): string {
  const name = customerName.trim()
  return line === 'automotive' && name ? `Hi ${name.split(/\s+/)[0]},` : name ? `Hello ${name},` : 'Hello,'
}

/** " for your 2014 Subaru Outback" / " for N254AL · 2008 Learjet 45" / "". */
export function forWhatText(vehicleLabel: string, line: ServiceLine): string {
  const label = vehicleLabel.trim()
  if (!label) return ''
  return line === 'automotive' ? ` for your ${label}` : ` for ${label}`
}

/**
 * One document line: "- Oil change: $49.00" or "- Wiper blade (2 x $14.50): $29.00".
 * `tag` is a car invoice's part condition, as its own word the way the paper
 * prints it: "- Brake pads · New: $89.00".
 */
export function lineText(
  l: { description: string; qty: number; unit_charge_cents: number; line_total_cents: number },
  tag?: string | null,
): string {
  const qty = Number(l.qty)
  const what = tag ? `${l.description} · ${tag}` : l.description
  return qty === 1
    ? `- ${what}: ${formatCents(l.line_total_cents)}`
    : `- ${what} (${qtyText(qty)} x ${formatCents(l.unit_charge_cents)}): ${formatCents(l.line_total_cents)}`
}

/**
 * RFC 6068: percent-encoded UTF-8, CRLF line breaks. The address keeps its @
 * and + literal (both are legal there) so no mail app has to decode it.
 */
export function mailtoHref(to: string, subject: string, body: string): string {
  return (
    `mailto:${encodeURIComponent(to).replace(/%40/g, '@').replace(/%2B/g, '+')}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`
  )
}
