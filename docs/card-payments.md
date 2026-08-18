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
- Event: `checkout.session.completed`

Copy the **Signing secret** it shows into `STRIPE_WEBHOOK_SECRET`, then
redeploy so the new variables take effect.

## 4. Check it

Settings → **Card payments** should read "Live". Open any unpaid invoice link
and a "Pay $X by card" button appears above the invoice.

Test with Stripe in **test mode** first: use test keys, and card number
`4242 4242 4242 4242` with any future expiry and any CVC. Confirm the payment
shows up on the job, then switch to live keys.

## How the money is recorded

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
- `record_card_payment` is granted to `service_role` only. The invoice token is
  shared with the customer, so an `anon` grant would let anyone holding a link
  mark their own invoice paid. This is enforced in the database, not just in
  the app.
- Already-paid and voided invoices are refused before checkout opens.
