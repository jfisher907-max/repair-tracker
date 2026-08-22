# Turning on card payments

The app already contains everything needed to take a card online; it stays
completely dormant until the three keys below exist. With no keys, invoice
links look and behave exactly as they do today.

## 1. Create the Stripe account

<https://dashboard.stripe.com/register> — business details, SSN or EIN for a
sole proprietorship, and the bank account payouts land in.

## 2. Add three environment variables in Vercel

Vercel → the project → Settings → Environment Variables. All three are
**server-side only — none may ever be given a `NEXT_PUBLIC_` prefix**, which
would publish them in the browser bundle.

| Variable | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → **Secret key** |
| `STRIPE_WEBHOOK_SECRET` | created in step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` |

The service-role key is what lets the webhook write a payment when nobody is
signed in. It is powerful — treat it like the key to the database, because it
is one.

## 3. Point Stripe at the webhook

Stripe → Developers → Webhooks → **Add endpoint**

- URL: `https://wingsnthings.repair/api/pay/webhook`
- Events: `checkout.session.completed` **and** `checkout.session.async_payment_succeeded`

Copy the **Signing secret** it shows into `STRIPE_WEBHOOK_SECRET`, then
redeploy so the new variables take effect.

The second event only matters if a delayed payment method is ever turned on;
today the checkout is card-only and settles instantly, but subscribing to both
now means nothing has to change later.

## 4. Check it

Settings → **Card payments** should read "Live". Open any unpaid invoice link
and a "Pay $X by card" button appears above the invoice.

Test with Stripe in **test mode** first: use test keys, and card number
`4242 4242 4242 4242` with any future expiry and any CVC. Confirm the payment
shows up on the job, then switch to live keys.

## Deposits on approved quotes

The same three keys also turn on **deposits**. On any quote, pick a deposit
rule — *Parts*, *50%*, or a custom dollar amount — and it rides along:

- The customer sees the deposit on the quote and in the approval box, and
  agrees to it as part of approving. The figure follows what they actually
  approve: if they untick a line, the deposit shrinks with it.
- Once approved, a **Pay deposit by card** button appears on their quote page.
  Paying it **creates the job** automatically (same job the *Convert* button
  would make) and records the deposit against it.
- The deposit counts toward the final invoice, so the customer is only ever
  charged the remaining balance. Nothing is double-collected.
- You can also take a deposit in cash or by check — record it on the job as a
  normal payment. The quote page then shows the deposit as received and stops
  offering the card button.

## How the money is recorded

- The customer pays on Stripe's own hosted page — card details never touch
  this app or its server, which keeps PCI scope at the simplest tier.
- Stripe reports the completed payment to `/api/pay/webhook`, which verifies
  the signature before believing anything. As a backstop, the customer's own
  return from Checkout also reconciles with Stripe directly, so the page never
  shows "pay again" over money that already moved. Both paths run the same
  idempotent recorder, so a payment can never post twice.
- **The balance on any invoice is the job total minus every payment ever
  recorded on that job.** Invoices are whole-job snapshots (revisions, never
  installments), so a deposit — or a payment made against an invoice that was
  later voided and reissued — always carries to the live invoice and is never
  re-billed.
- The payment is written to the ledger as a normal `card` payment, exactly as
  if it had been entered by hand, and the job and invoice statuses follow.
- Stripe deposits **net** of its fee, so the fee is booked automatically as a
  "Software & fees" expense from Stripe. The ledger stays on gross, so the
  reports remain honest.
- Webhook retries are idempotent: the payment carries Stripe's PaymentIntent
  id in `payments.external_ref`, which is unique, so the same money cannot
  post twice.

- The customer pays on Stripe's own hosted page — card details never touch
  this app or its server, which keeps PCI scope at the simplest tier.
- Stripe reports the completed payment to `/api/pay/webhook`, which verifies
  the signature before believing anything.
- The payment is written to the ledger as a normal `card` payment against that
  invoice, exactly as if it had been entered by hand, and the job and invoice
  statuses follow.
- Stripe deposits **net** of its fee, so the fee is booked automatically as a
  "Software & fees" expense from Stripe. The ledger stays on gross, so the
  reports remain honest.
- Webhook retries are idempotent: the payment carries Stripe's PaymentIntent
  id in `payments.external_ref`, which is unique, so the same money cannot
  post twice.

## What is deliberately NOT possible

- The page never tells the server how much to charge — the amount is read from
  the invoice server-side.
- `record_card_payment` and `record_deposit_payment` are granted to
  `service_role` only. The token is shared with the customer, so an `anon`
  grant would let anyone holding a link mark their own invoice paid. This is
  enforced in the database, not just in the app.
- The amount comes from Stripe's settled figure, and only a USD charge is
  accepted — a foreign-currency or test-mode event can't post a wrong number
  into the live ledger.
- The redirect back from Checkout is built from the shop's own domain, never
  from the request's `Origin` header, so a forwarded link can't send a paying
  customer to a look-alike page afterward.
- Already-paid and voided invoices, and already-covered deposits, are refused
  before checkout opens.
