# Wings N Things Design System — extracted reference

Source: Claude Design canvas ("Wings N Things Design System",
https://claude.ai/design/p/23133ab3-b251-4c08-b0b3-169360197635), extracted
verbatim 2026-08-22. The canvas is the design authority; this file is the
engineering copy of its token layer plus the reconciliation decisions made
when wiring it into the real app.

## Reconciliation decisions (owner-approved 2026-08-22)

The design system was built by eye from screenshots and flags its fonts and
gold as stand-ins ("correct against the real stylesheet"). Decisions:

- **Fonts: keep the real brand.** App chrome stays Barlow / Barlow Condensed;
  documents stay Space Grotesk / Inter. The design's Archivo / Instrument Sans
  were its eye-matched guesses at these. NEW from the design: IBM Plex Mono
  for ids (J007, Q012, VINs) — adopted.
- **Gold: keep #f0a832** (the live brand gold) behind the design's gold token
  names; hover/active shades derived from it. #E9B44C was the eye-match.
- **Contrast corrections (measured, 2026-08-22):** the canvas's `.wnt-doc`
  `--text-faint` #9AA1B0 fails AA on white paper (2.59:1) at the 10px labels
  it styles — implemented as #6B7383 (4.77:1). Dark-theme `--text-faint`
  (ink-500) is NON-TEXT only: it measures 2.88–3.53:1 on the night surfaces,
  so placeholders and sidebar section labels use `--text-muted` instead.
- **Structure: adopt wholesale** — night/ink ramps, semantic surface/text/
  border tokens, the status vocabulary, 3px status edges, radii scale,
  elevation, motion, `.wnt-doc` document re-map, `.wnt-label`/`.wnt-money`/
  `.wnt-data` helpers, interaction-state rules.
- **Kit screens**: shop_console's DispatchBoard / WorkOrderDetail /
  AviationCompliance and customer_portal's sign-in / job status / messages are
  designs for FUTURE surfaces (portal phase 6c, aviation page) — blueprints,
  not part of the reskin of existing screens.

## Deliberate deviations (and why)

Full-fidelity implementation, with these documented exceptions. Anything not
listed here follows the canvas.

- **Radius tokens are namespaced `--wnt-radius-*`.** Tailwind v4 owns the bare
  `--radius-*` names to generate `rounded-sm/md/lg/xl`; declaring ours in
  `:root` after Tailwind's silently resized every `rounded-*` class in the app
  (`rounded-lg` 8px -> 18px) and inverted the scale against the undefined
  `rounded-xl`. Never reuse the bare names.
- **Focus ring is 70% gold, not 30%.** The canvas's 30% composites to 1.84:1
  against the night page — under the 3:1 non-text minimum, and it is the only
  focus indicator on buttons and nav. 70% measures 5.11:1.
- **Money keeps the body face at 600, not the display face at 700.** A
  consequence of keeping the real brand fonts: the app's display face is
  Barlow *Condensed*, so display-face money would render narrow and hard to
  scan. The canvas's Archivo is not condensed, which is why the rule reads the
  way it does. Tabular figures and the never-rounded rule are kept.
- **`sent` maps to info (sky), not idle.** The canvas lists idle = draft/sent,
  but draft-vs-sent is the single most important distinction on the billing
  screen — collapsing both to grey would lose the "I actually sent this"
  signal the owner relies on. Every other state follows the vocabulary.
- **Customer documents keep their own print-tuned micro-label scale**
  (10px/.13em) rather than the 11px/.08em app micro-label, and keep the
  parallel `--doc-*` variables rather than the `.wnt-doc` token re-map. The
  VALUES are reconciled to the canvas's document palette; renaming the
  variables would be a no-visual-change refactor carrying real print risk.
- **Emoji remain in owner-side action buttons** (Print, Reports, Expenses …).
  The canvas bans emoji in buttons; on a phone-first owner tool they are the
  fastest scan target, and they never appear in customer documents, which is
  what the rule protects. Flagged for the owner's call.
- **The page-arrival stagger (`.page-anim`) is retained** against the canvas's
  "no entrance animation" rule. Flagged for the owner's call.

## tokens/colors.css (verbatim)

```css
:root{
/* --- Night: the base — near-black blue (site theme-color #0b0e13) --- */
--night-1000:#06080C;--night-950:#0B0E13;--night-900:#10141C;--night-850:#141922;--night-800:#1A202C;--night-700:#222A38;--night-600:#2E3746;--night-500:#3E4859;
/* --- Ink: text on night --- */
--ink-100:#F2F4F8;--ink-200:#D7DCE5;--ink-300:#AEB6C4;--ink-400:#8B94A7;--ink-500:#5F6779;--ink-600:#454D5E;
/* --- Gold: the brand — wing gold --- */
--gold-700:#B97F1E;--gold-600:#D9A83F;--gold-500:#E9B44C;--gold-400:#F2C56A;--gold-200:#F7DCA4;--gold-ink:#231803;--gold-tint:rgba(233,180,76,.12);--gold-line:rgba(233,180,76,.35);
/* --- Money & status accents (from the shop dashboard) --- */
--mint-500:#4CD97B;--mint-400:#6FE398;--mint-tint:rgba(76,217,123,.12);--mint-line:rgba(76,217,123,.45);
--ember-500:#EF6F6C;--ember-400:#F58E8B;--ember-tint:rgba(239,111,108,.12);--ember-line:rgba(239,111,108,.45);
--sky-500:#5CA8DE;--sky-tint:rgba(92,168,222,.12);
--white:#FFFFFF;

/* --- Semantic surfaces (dark-first everywhere) --- */
--surface-page:var(--night-950);
--surface-rail:var(--night-1000);
--surface-card:var(--night-850);
--surface-sunken:var(--night-900);
--surface-raised:var(--night-800);
--surface-inverse:var(--ink-100);
--surface-accent:var(--gold-tint);
--surface-hover:rgba(255,255,255,.05);
--surface-selected:var(--gold-tint);
/* legacy aliases (shop = default) */
--surface-shop:var(--night-950);
--surface-shop-panel:var(--night-850);
--surface-shop-raised:var(--night-800);

/* --- Semantic text --- */
--text-heading:var(--ink-100);
--text-body:var(--ink-200);
--text-muted:var(--ink-400);
--text-faint:var(--ink-500);
--text-inverse:var(--night-950);
--text-inverse-muted:var(--night-600);
--text-link:var(--gold-500);
--text-on-accent:var(--gold-ink);
--text-money-in:var(--mint-500);
--text-money-owed:var(--ember-500);

/* --- Semantic lines --- */
--border-hairline:var(--night-800);
--border-default:var(--night-700);
--border-strong:var(--night-600);
--border-focus:var(--gold-500);
--border-shop:var(--night-700);

/* --- Status (job + payment + airworthiness states) --- */
--status-ok-fg:var(--mint-400);--status-ok-bg:var(--mint-tint);--status-ok-solid:var(--mint-500);
--status-wait-fg:var(--gold-400);--status-wait-bg:var(--gold-tint);--status-wait-solid:var(--gold-500);
--status-stop-fg:var(--ember-400);--status-stop-bg:var(--ember-tint);--status-stop-solid:var(--ember-500);
--status-info-fg:var(--sky-500);--status-info-bg:var(--sky-tint);--status-info-solid:var(--sky-500);
--status-idle-fg:var(--ink-400);--status-idle-bg:rgba(255,255,255,.06);--status-idle-solid:var(--ink-500);

/* --- Interactive --- */
--action-primary:var(--gold-500);
--action-primary-hover:var(--gold-400);
--action-primary-active:var(--gold-600);
--action-secondary-bg:var(--night-800);
--action-ghost-hover:var(--surface-hover);
--focus-ring:0 0 0 3px rgba(233,180,76,.30);
}
```

## tokens/doc-theme.css (verbatim)

```css
/* Light "document" theme — customer-facing quotes, invoices, portal bodies.
   Wrap any subtree in class="wnt-doc" and the semantic tokens re-map; the dark
   chrome (header bands, buttons) keeps using the root values. */
.wnt-doc{
--surface-page:#E9EBEF;
--surface-card:#FFFFFF;
--surface-sunken:#F4F5F8;
--surface-raised:#FFFFFF;
--surface-hover:#F3F4F7;
--surface-selected:rgba(233,180,76,.14);
--surface-accent:rgba(233,180,76,.10);
--text-heading:#10141C;
--text-body:#2A3040;
--text-muted:#6B7383;
--text-faint:#6B7383; /* canvas said #9AA1B0 — 2.59:1 on white, fails AA */
--text-link:#B97F1E;
--border-hairline:#ECEEF2;
--border-default:#DADDE4;
--border-strong:#C2C7D1;
--action-secondary-bg:#FFFFFF;
--action-ghost-hover:rgba(233,180,76,.10);
--shadow-card:0 1px 2px rgba(16,20,28,.06),0 1px 0 rgba(16,20,28,.03);
--shadow-raised:0 2px 8px rgba(16,20,28,.10);
--shadow-inset-field:inset 0 1px 1px rgba(16,20,28,.05);
--status-ok-fg:#1E7F46;--status-ok-bg:rgba(76,217,123,.16);
--status-wait-fg:#8A6114;--status-wait-bg:rgba(233,180,76,.18);
--status-stop-fg:#B3362F;--status-stop-bg:rgba(239,111,108,.14);
--status-info-fg:#2E6E9E;--status-info-bg:rgba(92,168,222,.14);
--status-idle-fg:#6B7383;--status-idle-bg:rgba(16,20,28,.06);
color:var(--text-body);
}

/* Dark band inside a document — restores chrome tokens under .wnt-doc (quote
   headers, approval bands, total capsules). */
.wnt-dark{
--surface-page:#0B0E13;
--surface-card:#141922;
--surface-sunken:#10141C;
--surface-raised:#1A202C;
--surface-hover:rgba(255,255,255,.05);
--text-heading:#F2F4F8;
--text-body:#D7DCE5;
--text-muted:#8B94A7;
--text-faint:#5F6779;
--text-link:#E9B44C;
--border-hairline:#1A202C;
--border-default:#222A38;
--border-strong:#2E3746;
--action-secondary-bg:#1A202C;
--action-ghost-hover:rgba(255,255,255,.05);
--shadow-inset-field:inset 0 1px 2px rgba(0,0,0,.35);
--status-ok-fg:#6FE398;--status-ok-bg:rgba(76,217,123,.12);
--status-wait-fg:#F2C56A;--status-wait-bg:rgba(233,180,76,.12);
--status-stop-fg:#F58E8B;--status-stop-bg:rgba(239,111,108,.12);
--status-info-fg:#5CA8DE;--status-info-bg:rgba(92,168,222,.12);
--status-idle-fg:#8B94A7;--status-idle-bg:rgba(255,255,255,.06);
color:var(--text-body);
}
```

## tokens/elevation.css (verbatim)

```css
:root{
--radius-xs:6px;--radius-sm:10px;--radius-md:14px;--radius-lg:18px;--radius-pill:999px;
--border-width:1px;--border-width-strong:2px;
--edge-width:3px; /* colored left edge on job rows */
--shadow-none:none;
--shadow-hairline:0 0 0 1px var(--border-hairline);
--shadow-card:0 1px 0 rgba(255,255,255,.03) inset,0 2px 8px rgba(0,0,0,.25);
--shadow-raised:0 1px 0 rgba(255,255,255,.04) inset,0 6px 18px rgba(0,0,0,.35);
--shadow-overlay:0 20px 48px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.4);
--shadow-inset-field:inset 0 1px 2px rgba(0,0,0,.35);
--shadow-shop-panel:inset 0 1px 0 rgba(255,255,255,.03);
--shadow-glow-gold:0 0 0 1px var(--gold-line),0 4px 16px rgba(233,180,76,.15);
--scrim-overlay:rgba(4,6,10,.66);
--blur-overlay:blur(3px);
}
```

## tokens/typography.css (verbatim)

```css
:root{
--font-display:"Archivo","Helvetica Neue",Arial,sans-serif;
--font-body:"Instrument Sans","Helvetica Neue",Arial,sans-serif;
--font-mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",monospace;

--text-display-size:44px;--text-display-lh:46px;--text-display-weight:700;--text-display-track:-.02em;
--text-h1-size:32px;--text-h1-lh:36px;--text-h1-weight:700;--text-h1-track:-.015em;
--text-h2-size:24px;--text-h2-lh:30px;--text-h2-weight:600;--text-h2-track:-.01em;
--text-h3-size:18px;--text-h3-lh:24px;--text-h3-weight:600;--text-h3-track:-.005em;
--text-body-size:15px;--text-body-lh:23px;--text-body-weight:400;
--text-body-sm-size:13px;--text-body-sm-lh:19px;
--text-caption-size:12px;--text-caption-lh:16px;
--text-label-size:11px;--text-label-lh:14px;--text-label-weight:600;--text-label-track:.08em;
--text-data-size:13px;--text-data-lh:18px;
--text-data-lg-size:22px;--text-data-lg-lh:26px;
}
```
(Font families are the design's stand-ins — the app substitutes the real
brand faces per the reconciliation above.)

## tokens/spacing.css (verbatim)

```css
:root{
--space-0:0;--space-1:2px;--space-2:4px;--space-3:8px;--space-4:12px;--space-5:16px;--space-6:20px;--space-7:24px;--space-8:32px;--space-9:40px;--space-10:48px;--space-11:64px;--space-12:80px;
--gutter-page:24px;--gutter-page-wide:40px;
--pad-card:20px;--pad-card-tight:14px;--pad-field-x:12px;--pad-field-y:9px;
--row-height:44px;--row-height-dense:34px;
--width-content:1160px;--width-prose:64ch;--width-sidebar:248px;--width-rail:64px;
}
```

## tokens/motion.css (verbatim)

```css
:root{
--ease-standard:cubic-bezier(.2,.6,.2,1);
--ease-out:cubic-bezier(0,.6,.3,1);
--ease-in:cubic-bezier(.4,0,1,1);
--dur-instant:80ms;--dur-fast:130ms;--dur-normal:200ms;--dur-slow:320ms;
--transition-control:background-color var(--dur-fast) var(--ease-standard),border-color var(--dur-fast) var(--ease-standard),color var(--dur-fast) var(--ease-standard),box-shadow var(--dur-fast) var(--ease-standard);
--press-scale:.985;
}
```

## tokens/base.css (verbatim)

```css
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:var(--font-body);font-size:var(--text-body-size);line-height:var(--text-body-lh);color:var(--text-body);background:var(--surface-page);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:var(--font-display);color:var(--text-heading);margin:0}
a{color:var(--text-link);text-decoration:none;border-bottom:1px solid var(--gold-line);transition:var(--transition-control)}
a:hover{color:var(--gold-400);border-bottom-color:var(--gold-400)}
code,kbd,samp{font-family:var(--font-mono);font-size:var(--text-data-size)}
::selection{background:rgba(233,180,76,.35)}
.wnt-label{font-family:var(--font-display);font-size:var(--text-label-size);line-height:var(--text-label-lh);font-weight:var(--text-label-weight);letter-spacing:var(--text-label-track);text-transform:uppercase;color:var(--text-muted)}
.wnt-data{font-family:var(--font-mono);font-size:var(--text-data-size);line-height:var(--text-data-lh);font-variant-numeric:tabular-nums}
.wnt-money{font-family:var(--font-display);font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.01em}
```

## Key rules from the canvas readme (spec, not CSS)

- **The signature pattern**: 3px status-colored LEFT EDGE on job rows, active
  nav, selected cards — never a colored background, never a full colored card.
- **Status vocabulary**: ok = paid/cleared · wait = partial/awaiting (gold) ·
  stop = unpaid/grounded (ember) · info = scheduled (sky) · idle = draft/sent.
- **Color is meaning**: green/red reserved for money and state, never decoration.
- **Money**: never rounded or abbreviated; colored by meaning (green in, red
  owed, white neutral); bold display face with tabular figures, NOT mono.
- **Ids** (J007, Q012, VINs): gold, mono, always visible.
- **Casing**: sentence/title case everywhere; uppercase ONLY for micro-labels
  and status pills at 10.5–11px / .08em tracking.
- **Emoji are the icon set** (nav + metric corners) — never inside sentences,
  buttons, headings, or document bodies. Established pairings: Dashboard 🏠 ·
  Reports 📊 · Jobs 📁 · New Job ➕ · Requests 🛎️ · Follow-ups 🔔 ·
  Quotes & Invoices 🧾 · New Quote 📝 · Expenses 💼 · Customers 👤 ·
  Settings ⚙️ · Jobs-count 🔧 · Labor ⏱️ · Billed 💵 · Collected 🏦 ·
  Parts 🛒 · Profit 📈 · Unpaid ⚠️.
- **Cards**: hairline border + 14px radius + inset top-light + soft drop;
  emphasis = colored 1px outline (mint/ember tiles) or gold glow (the one
  primary CTA); never nested shadows.
- **Backgrounds**: flat color only; no gradients (except the gold mark tile),
  no textures, no decorative photography.
- **Documents**: white paper card (6px radius) on grey desk; night header band
  with wordmark left / doc id right; 3px gold rule under the band; meta row of
  uppercase micro-labels; 2px dark rule under table headers; ESTIMATED TOTAL
  black capsule (night box, gold label, big white numeral).
- **States**: gold hover LIGHTENS (500→400); dark-surface hover lightens one
  step; press scale .985 + gold-600; focus 3px gold ring at 30%; disabled 45%
  opacity.
- **Motion**: 130ms controls, 200ms panels, standard ease; no bounce, no
  ripple, no entrance animations.
- **Layout**: console = fixed sidebar (rail-black, sectioned OVERVIEW / WORK /
  MONEY / PEOPLE, Settings pinned bottom) + date-eyebrow + 30px bold title;
  metric strip 4-across; section dividers = uppercase label + hairline rule +
  optional gold "View all →". Portal: sticky 64px dark header, 1160px content,
  dark footer with the privacy line.
- **Transparency/blur**: dialog scrim only; no glass panels.
- **Voice**: every metric gets a plain-words caption; "we" for the shop, "you"
  for the customer; aviation register stricter (AD/SB exact, "release to
  service", "A&P/IA").
