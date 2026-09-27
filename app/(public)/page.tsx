import type { Metadata } from 'next'
import WingMark from '@/components/WingMark'
import RequestForm from '@/components/public/RequestForm'
import RedirectIfOwner from '@/components/public/RedirectIfOwner'
import {
  LineOnly,
  ServiceTabs,
  type ServiceCard,
  type ServiceLine,
} from '@/components/public/ServiceLine'
import { AUTH_STORAGE_KEY } from '@/lib/supabase'
import { BRAND_TAGLINE } from '@/lib/brand'

/**
 * PUBLIC landing page — the address on the Google Business Profile.
 *
 * Design constraints, in order:
 *  - A customer who taps the listing must instantly see a real business:
 *    what we do, where we are, and one obvious way to start.
 *  - No phone number anywhere. The owner's number is personal; the request
 *    form below is the only contact channel, by design.
 *  - Server-rendered and static so Google indexes content, not a login box.
 *    The owner's app lives at /dashboard; RedirectIfOwner forwards a
 *    signed-in session there so the installed PWA still opens the shop.
 *
 * The page tailors itself to one of two service lines — Automotive (the
 * default) or Aviation — chosen by the tabs in "What we do" or the toggle at
 * the top of the request form, and deep-linked by #aviation / #automotive.
 * Both sides' copy is in the static HTML; the inactive side is `hidden`
 * (see components/public/ServiceLine.tsx).
 *
 * The visual language is the Bold Brand document system (charcoal band,
 * amber accent, Space Grotesk display) — the same paper a customer sees on
 * their quote and invoice, so the site and the documents read as one shop.
 */

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  title: 'Wings N Things — Aviation & Automotive Service in Juneau, Alaska',
  description:
    'Aviation and automotive service in Juneau, Alaska. Detail-focused, professional service: photo-documented work, online estimates you approve from your phone, and digital invoices. Request service online.',
}

const AUTOMOTIVE_SERVICES: ServiceCard[] = [
  {
    title: 'Diagnostics',
    body: 'Finding the actual fault. Scan, test, repair.',
  },
  {
    title: 'Scheduled Maintenance',
    body: 'Oil, fluids, filters, belts, and scheduled inspections.',
  },
  {
    title: 'Brakes & Suspension',
    body: 'Pads, calipers, rotors, wheel bearings, shocks and struts.',
  },
  {
    title: 'Electrical & Electronics',
    body: 'Batteries, charging, wiring, and sensors.',
  },
  {
    title: 'Heating & Cooling',
    body: 'Cooling & heating systems.',
  },
  {
    title: 'Pre-purchase Inspections',
    body: 'A straight, documented inspection on a vehicle you’d like to add into your life.',
  },
]

// AWAITING THE OWNER: repair services for private and business jets
// transiting Juneau. This list still awaits Jake's confirmation — the
// certificate scope and the jet types he'll take on are open — so add,
// reword or drop cards here as that is settled. The panel sizes itself to
// however many cards there are (four run two-up on a wide screen).
const AVIATION_SERVICES: ServiceCard[] = [
  {
    title: 'AOG Response',
    body: 'Stuck in Juneau? We come to the aircraft, find the fault, and give your maintenance control a plan.',
  },
  {
    title: 'Troubleshooting & Repair',
    body: 'Write-ups from the last leg diagnosed and fixed on the ramp, with a clear record of the work.',
  },
  {
    title: 'Tires, Brakes & Servicing',
    body: 'Wheel and brake changes, fluids, and the servicing that keeps a trip on schedule.',
  },
  {
    title: 'Photo-Documented Records',
    body: 'Every repair photographed and written up, with a digital invoice your operator can review before approving.',
  },
]

const SERVICES: Record<ServiceLine, ServiceCard[]> = {
  automotive: AUTOMOTIVE_SERVICES,
  aviation: AVIATION_SERVICES,
}

interface Step {
  n: string
  title: string
  body: string
}

const STEPS: Record<ServiceLine, Step[]> = {
  automotive: [
    {
      n: '1',
      title: 'Tell us about your vehicle',
      body: 'Use the request form below — the vehicle, what it’s doing, and how to reach you.',
    },
    {
      n: '2',
      title: 'We come back with a plan',
      body: 'Expect a reply within one business day: what we think it is, a written estimate, and a time and place for the vehicle that works for you.',
    },
    {
      n: '3',
      title: 'Approve from your phone',
      body: 'Estimates are approved online — line by line if you want. Work is photo-documented, and your invoice is digital.',
    },
  ],
  aviation: [
    {
      n: '1',
      title: 'Tell us about the aircraft',
      body: 'Type and tail number, the squawk, where it’s parked, and who to reach — the crew or maintenance control.',
    },
    {
      n: '2',
      title: 'We come back with a plan',
      body: 'A written estimate and a time at the aircraft.',
    },
    {
      n: '3',
      title: 'Approve from your phone',
      body: 'The crew or maintenance control approves the estimate online. Work is photo-documented, and the invoice is digital.',
    },
  ],
}

const REQUEST_INTRO: Record<ServiceLine, string> = {
  automotive:
    "Tell us about your vehicle and what it needs. We'll get back to you within one business day with an estimate and a plan for getting the vehicle in.",
  aviation:
    'Tell us about the aircraft and the squawk. We’ll come back with an estimate and a plan to return it to service.',
}

// Runs at HTML parse time — before the first paint and before React loads —
// so /#aviation never flashes the automotive side. It only sets
// <html data-line="aviation">; the CSS that acts on it is in globals.css and
// the store in components/public/ServiceLine.tsx keeps the attribute in
// step once React takes over. Must agree with lineFromHash() there.
const LINE_BOOT_SCRIPT =
  "try{if(location.hash.toLowerCase()==='#aviation')document.documentElement.dataset.line='aviation'}catch(e){}"

// Local, not ServiceLine.tsx's SERVICE_LINES: a value exported from a
// 'use client' module arrives here as a client reference, not an array.
const LINES: ServiceLine[] = ['automotive', 'aviation']

export default function LandingPage() {
  return (
    <div
      className="wnt-light min-h-dvh"
      style={{
        background: '#e9ebef',
        color: '#10141c',
        fontFamily: 'var(--font-doc-body), system-ui, sans-serif',
      }}
    >
      {/* First, so every per-side element below is covered before it paints. */}
      <script dangerouslySetInnerHTML={{ __html: LINE_BOOT_SCRIPT }} />

      {/* Owner fast path, evaluated at HTML parse time — before React loads.
          The installed PWA's start_url is still '/' on phones that installed
          before the move; presence of the stored session key sends the owner
          to the dashboard in ~0ms, and works offline (localStorage + the
          worker's cached shell need no network). Customers don't have the
          key and never redirect. RedirectIfOwner below is the fallback. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(localStorage.getItem(${JSON.stringify(AUTH_STORAGE_KEY)}))location.replace('/dashboard')}catch(e){}`,
        }}
      />
      <RedirectIfOwner />

      {/* Charcoal brand band — same header the quotes and invoices wear. */}
      <header className="wnt-dark" style={{ background: '#10141c', color: '#f2f4f8' }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <div className="min-w-0">
            <span
              className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
              style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
            >
              <WingMark size={30} />
              Wings N Things
            </span>
            {/* Same line, same place as the letterhead this band copies. */}
            <span
              className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: '#a7b0c2' }}
            >
              {BRAND_TAGLINE}
            </span>
          </div>
          <span className="text-xs uppercase tracking-widest" style={{ color: '#8b94a7' }}>
            Juneau, Alaska
          </span>
        </div>
        <div style={{ height: 3, background: '#f0a832' }} />
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-5 pb-12 pt-14 sm:pt-20">
          <h1
            className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl"
            style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
          >
            Premier aviation&nbsp;&amp; automotive service.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed" style={{ color: '#2a3040' }}>
            Detail-focused, professional service in Juneau, Alaska. Clear
            communication, photo-documented work, and written estimates you
            approve from your phone.
          </p>
          <a
            href="#request"
            className="mt-8 inline-block rounded-lg px-6 py-3.5 text-base font-semibold"
            style={{ background: '#f0a832', color: '#201503' }}
          >
            Request service →
          </a>
        </section>

        {/* Services */}
        <section style={{ background: '#ffffff', borderTop: '1px solid #dadde4', borderBottom: '1px solid #dadde4' }}>
          <div className="mx-auto max-w-4xl px-5 py-12">
            <h2
              id="what-we-do"
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: '#5f6779' }}
            >
              What we do
            </h2>
            <ServiceTabs labelledBy="what-we-do" services={SERVICES} />
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-4xl px-5 py-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#5f6779' }}>
            How it works
          </h2>
          {LINES.map((line) => (
            <LineOnly key={line} line={line} className="mt-6">
              <div className="grid gap-6 sm:grid-cols-3">
                {STEPS[line].map((s) => (
                  <div key={s.n}>
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full text-base font-bold"
                      style={{ background: '#10141c', color: '#f0a832', fontFamily: 'var(--font-doc-display), sans-serif' }}
                    >
                      {s.n}
                    </span>
                    <h3
                      className="mt-3 text-base font-semibold"
                      style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
                    >
                      {s.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed" style={{ color: '#2a3040' }}>
                      {s.body}
                    </p>
                  </div>
                ))}
              </div>
            </LineOnly>
          ))}
        </section>

        {/* Request form — the one and only contact channel. */}
        <section
          id="request"
          className="wnt-dark"
          style={{ background: '#10141c', color: '#f2f4f8' }}
        >
          <div className="mx-auto max-w-4xl px-5 py-14">
            <h2
              className="text-3xl font-bold tracking-tight"
              style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
            >
              Request service
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: '#8b94a7' }}>
              {LINES.map((line) => (
                <LineOnly key={line} line={line} as="span">
                  {REQUEST_INTRO[line]}
                </LineOnly>
              ))}
            </p>
            <div className="mt-8">
              <RequestForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-5 py-8 text-xs" style={{ color: '#5f6779' }}>
        <span>© {new Date().getFullYear()} Wings N Things LLC · Juneau, Alaska</span>
        <a href="/dashboard" className="underline underline-offset-2" style={{ color: '#5f6779' }}>
          Owner sign in
        </a>
      </footer>

      {/* Local-business structured data for the Google listing. Deliberately
          no telephone: the request form is the contact channel. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'AutoRepair',
            name: 'Wings N Things',
            url: 'https://wingsnthings.repair',
            address: {
              '@type': 'PostalAddress',
              addressLocality: 'Juneau',
              addressRegion: 'AK',
              addressCountry: 'US',
            },
            areaServed: 'Juneau, Alaska',
            description:
              'Aviation and automotive service in Juneau, Alaska. Detail-focused, professional service with online estimates and digital invoices.',
          }),
        }}
      />
    </div>
  )
}
