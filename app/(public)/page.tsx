import type { Metadata } from 'next'
import WingMark from '@/components/WingMark'
import RequestForm from '@/components/public/RequestForm'
import RedirectIfOwner from '@/components/public/RedirectIfOwner'
import { AUTH_STORAGE_KEY } from '@/lib/supabase'

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
 * The visual language is the Bold Brand document system (charcoal band,
 * amber accent, Space Grotesk display) — the same paper a customer sees on
 * their quote and invoice, so the site and the documents read as one shop.
 */

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  title: 'Wings N Things — Automotive Diagnostics & Repair in Juneau, Alaska',
  description:
    'Premier automotive diagnostics and repair in Juneau, Alaska. Detail-focused, professional service: photo-documented work, online estimates you approve from your phone, and digital invoices. Request service online.',
}

const SERVICES = [
  {
    title: 'Diagnostics',
    body: 'Finding the actual fault — not throwing parts at a symptom. Scan, test, verify, then talk.',
  },
  {
    title: 'Scheduled maintenance',
    body: 'Oil, fluids, filters, belts, and inspections on the schedule your vehicle actually needs.',
  },
  {
    title: 'Brakes & suspension',
    body: 'Pads, rotors, wheel bearings, shocks and struts — the systems that keep you planted.',
  },
  {
    title: 'Electrical & electronics',
    body: 'Batteries, charging, wiring, sensors, and the gremlins other shops give back unsolved.',
  },
  {
    title: 'Heating & cooling',
    body: 'Cooling systems and cabin heat, sorted before an Alaska winter makes them urgent.',
  },
  {
    title: 'Pre-purchase inspections',
    body: 'A straight, documented answer on a vehicle before you hand over the money.',
  },
]

const STEPS = [
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
]

export default function LandingPage() {
  return (
    <div
      className="min-h-dvh"
      style={{
        background: '#e9ebef',
        color: '#10141c',
        fontFamily: 'var(--font-doc-body), system-ui, sans-serif',
      }}
    >
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
      <header style={{ background: '#10141c', color: '#e9ebef' }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <span
            className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
            style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
          >
            <WingMark size={30} />
            Wings N Things
          </span>
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
            Premier automotive diagnostics&nbsp;&amp; repair.
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
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: '#5f6779' }}
            >
              What we do
            </h2>
            <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICES.map((s) => (
                <div key={s.title}>
                  <h3
                    className="text-base font-semibold"
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
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-4xl px-5 py-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#5f6779' }}>
            How it works
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
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
        </section>

        {/* Request form — the one and only contact channel. */}
        <section
          id="request"
          style={{ background: '#10141c', color: '#e9ebef' }}
        >
          <div className="mx-auto max-w-4xl px-5 py-14">
            <h2
              className="text-3xl font-bold tracking-tight"
              style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
            >
              Request service
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: '#8b94a7' }}>
              Tell us about your vehicle and what it needs. We&apos;ll get back to you
              within one business day with an estimate and a plan for getting
              the vehicle in.
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
              'Premier automotive diagnostics and repair in Juneau, Alaska. Detail-focused, professional service with online estimates and digital invoices.',
          }),
        }}
      />
    </div>
  )
}
