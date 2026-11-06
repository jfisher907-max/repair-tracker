# Liquid Glass — the owner shell

The owner side of the app is frosted glass over a lit ground, after Apple's
iOS 26 style. The customer-facing surfaces — the public quote `/q/[token]`,
the public invoice `/i/[token]`, the shared inspection `/r/[token]` and
`/s/[token]`, the printable report, the landing page — are **not**, and
nothing here reaches print.

## How the scoping works

Every shared primitive (`.card`, `.btn`, `.input`, `.chip`, `.skeleton`, …)
paints itself out of one set of variables, the **surface contract**:

| variable | what it is |
| --- | --- |
| `--gs-fill` / `-raised` / `-chrome` / `-sunken` / `-hover` | the pane's colour |
| `--gs-image` / `-chrome` | the sheen gradient painted over the fill |
| `--gs-filter` / `-float` | the `backdrop-filter` |
| `--gs-line` / `-strong` | the hairline |
| `--gs-edge` / `-strong` | the lit top edge (an inset shadow) |
| `--gs-shadow` / `-raised` / `-float` | edge + drop shadow together |
| `--gs-field-fill` / `-line` | a well cut into the glass (inputs, tracks) |
| `--gs-nest` / `-on` | the lit lozenge: hover, a selected tab or segment |
| `--bg1` / `--bg2` / `--bg3` | nested sub-panels set inline across the pages |

In `:root` these hold the **flat** values, so anything customer-facing is
untouched. `.app-frame` — the owner shell — rebinds them to glass, and
`.glass-scope` does the same for the overlays that are portalled out to
`<body>`. That is the entire opt-in: no scoped selectors, no specificity to
unpick.

The same mechanism gives the three guards for free, because each is just a
third rebinding of the same names:

- `@media (prefers-reduced-transparency: reduce)` → solid panels, no lights,
  opaque chrome.
- `@supports not (backdrop-filter: blur(1px))` → solid fills, so a browser
  without the filter never shows the page straight through a panel.
- `@media print` → white, no blur (`backdrop-filter: none !important` on
  everything), chrome and lights `display: none`.

A document rendered *inside* the shell (an invoice on the owner's own screen)
takes the flat contract and the paper corner radii back, via
`:is(.app-frame, .glass-scope) :is(.doc-root, .report-root)`.

## Why the tint is dark

The mockup tints the glass **white**: `rgba(255,255,255,.08)` under a `.13`
sheen. On this app's content that cannot hold. Over the amber light's peak it
composites to `#73634c`, and there:

| token | ratio on the mockup's white glass |
| --- | --- |
| `--text-muted` (ink-400) | **1.90** |
| gold-500 `#f0a832` | **2.85** |
| `--text-body` (ink-200) | **4.20** |
| `--text-heading` (ink-100) | 5.25 |

This app has 738 micro-labels at 11px and the gold accent on nearly every
card, so a white tint would have meant giving up either the lights or the
accent. The tint is dark instead — which is what iOS 26 itself does on a dark
ground. The glass reads as glass from the hairline, the sheen and the lit top
edge, not from lightening the panel.

## The numbers that matter

Ground `#0b0e13`. Lights: amber `#f0a832` .17, blue `#4a90d9` .14, violet
`#8a6ee0` .11. Card glass: `rgba(20,25,34,.55)` + a `.10` white sheen.

The **lightest spot the glass can produce** is the amber peak with blue
bleeding into it — that is the figure every check below is run against, not an
average:

```
ground                         #0b0e13
amber .17 + blue .07           #342f26
    + card fill .55            #323332
    + sheen .10                #38393a   <- the worst-case card
```

How much light still comes through, by where a card sits on the page:

| spot | card composites to |
| --- | --- |
| dark corner | `#282c32` |
| violet peak | `#2e303b` |
| blue peak | `#2b333d` |
| amber peak | `#383634` |
| amber + blue | `#38393a` |

Text on the worst-case card `#38393a`:

| token | value | ratio | |
| --- | --- | --- | --- |
| `--text-heading` ink-100 | `#f2f4f8` | 10.49 | pass |
| `--text-body` ink-200 | `#d7dce5` | 8.40 | pass |
| `--text-muted` ink-300 | `#aeb6c4` | 5.66 | pass |
| `--text-faint` ink-350 | `#9da5b6` | 4.67 | pass |
| gold-500 | `#f0a832` | 5.70 | pass |
| gold-400 | `#ffc35c` | 7.27 | pass |
| mint-500 | `#4cd97b` | 6.34 | pass |
| ember-400 | `#f58e8b` | 5.02 | pass |
| sky-400 | `#8cc3ea` | 6.11 | pass |
| ~~ink-400~~ | `#8b94a7` | 3.79 | **fails at 11px** |
| ~~sky-500~~ | `#5ca8de` | 4.46 | **fails** |
| ~~ember-500~~ | `#ef6f6c` | 3.94 | **fails** |

Chips (their own tint over the card glass):

| chip | ratio | |
| --- | --- | --- |
| paid — mint .12 / mint-400 | 5.70 | pass |
| partial — gold .12 / gold-400 | 5.82 | pass |
| unpaid — ember .12 / ember-300 | 4.99 | pass |
| scheduled — sky .12 / sky-400 | 5.07 | pass |
| draft — white .06 / ink-300 | 4.71 | pass |
| selected tab or segment — white .14 / gold-400 | 4.79 | pass |

### What moved, and why

Because glass is lighter than a flat card, every secondary tier went one step
up the ramp. These are the only token changes:

| token | was | is | reason |
| --- | --- | --- | --- |
| `--text-muted` | ink-400 | ink-300 | 3.79 → 5.66 |
| `--text-faint` | ink-500 | ink-350 (new) | ink-500 reads 1.79 on glass |
| `--text3` (alias, 186 uses) | ink-400 | `--text-muted` | same reason |
| `--text2` (alias, 105 uses) | ink-300 | `--text-body` | keeps the tiers apart |
| `--status-stop-fg` | ember-400 | ember-300 (new) | 4.30 → 4.99 on its chip |
| `--status-info-fg` | sky-500 | sky-400 (new) | 4.46 → 6.11 |
| `--status-idle-fg` | ink-400 | ink-300 | 3.79 → 5.66 |
| `--text-money-owed` | ember-500 | ember-400 | 3.94 → 5.02 |
| `--red` (45 uses as text) | ember-500 | ember-400 | same |
| `--blue` (link text) | sky-500 | sky-400 | 4.46 → 6.11 |
| `--orange` | `#f08840` | `#f8a05a` | 3.64 → 5.59 |

`--ink-350` exists because the old four-tier ramp had no room left on glass:
it is the faintest shade that still clears 4.5:1 at the worst spot.

### Nested panels go darker, not lighter

43 places set `background: var(--bg2)` or `var(--bg3)` inline on a sub-panel,
a chip or a note row inside a card. Rebinding the two aliases in `.app-frame`
converts all of them at once. They go **darker** than the card even though
night-700/800 were lighter than night-850 in the flat system, and that is a
guarantee rather than a taste: a well cut into the pane can only raise the
ratio of whatever text sits in it, so every combination that passes on the
card still passes inside one. The obvious reading of the mockup — white .10 —
does not:

| nested fill | composites to | `--text3` | gold-500 |
| --- | --- | --- | --- |
| white .06 | `#444545` | 4.71 | 4.74 |
| **white .10** | `#4c4d4d` | **4.16** | **4.18** |
| white .12 | `#505151` | **3.91** | **3.93** |
| **dark .32 (chosen)** | `#27282a` | **7.20** | **7.24** |

### The one number that does not clear 3:1

A card's own edge. At the amber light's peak a dark-tinted pane is only
**1.15:1** against the ground behind it — the fill and the ground converge
there, and dimming the lights barely moves it (1.25:1 even at amber .11).
What separates them is the hairline, which is why it is `.18` rather than the
mockup's `.14`:

| | amber peak | dark corner |
| --- | --- | --- |
| card vs ground | 1.15 | 1.37 |
| hairline white .18 vs ground | 2.00 | 2.45 |
| lit top edge white .26 vs its card | 2.22 | 2.22 |

This is reported by the script but **not gated**, for two reasons. A card
boundary is decoration under WCAG 1.4.11 — the content is what identifies the
card, and nothing here is a control whose state you must see the border to
read. And most of the real separation is the drop shadow, which a flat
two-colour ratio cannot express at all. Picking a threshold and tuning until
it was met would hide that rather than measure it. The focus ring, which IS
required, is gated and clears 3:1 against both the card (3.61) and the ground
(4.14).

## Re-running the arithmetic

`scripts/glass-contrast.mjs` computes every table above from the token values.
Run it before changing any fill, light or text token:

```bash
node scripts/glass-contrast.mjs
```

It exits non-zero if any pair that must clear 4.5:1 does not.

## The blur budget

`--glass-blur` (22px) is the one perf dial. Cost scales with the radius and
with how many blurred layers a page stacks, so **only surfaces with real
content moving behind them blur**: cards, panels, the floating chrome, the
sidebar, dialogs. Everything nested inside a glass surface — fields, chips,
segment tracks, tile bands, calendar cells and all 638 buttons — takes a plain
translucent fill. A second blur pass inside an already-frosted card changes
nothing visually, and it would both cost a compositing layer and create a
containing block.

## The containing-block trap

`backdrop-filter`, like `transform`, makes an element the containing block for
every `position: fixed` element inside it. Three overlays were written inside
a card and would have started measuring the card instead of the screen:

- the job photo viewer (`components/JobPhotos.tsx`) — a child of that
  component's own `.card`
- the receipt viewer (`components/ReceiptPreview.tsx`) — its pages wrap it in
  a card
- the hangar dialogs (`components/hangar/HangarModal.tsx`) — opened from
  inside a `JetCard`

All three now go through `components/Overlay.tsx`, which portals them to
`<body>`. That is the fix that cannot regress: there is no ancestor left to
misbehave, so `inset: 0` means the viewport whatever the page does.

Two related points:

- `.app-frame` uses `isolation: isolate`, not `position: relative; z-index: 0`.
  Isolation creates a stacking context **without** creating a containing
  block, so the floating tab bar and corner buttons keep measuring the
  viewport. It is needed at all because `.app-lit` sits at `z-index: -1`, and
  paint order inside `<html>` puts negative-z layers *before* `<body>`'s own
  background — un-isolated, the lights would be hidden under the page colour.
- A translucent row shows what is behind it. `components/SwipeableRow.tsx`
  parks its delete action behind the row, so that action is now hidden until
  the gesture starts; otherwise every swipeable row carried a red stain down
  its right-hand side.
