# Fonts

The app's five typefaces, kept as files in the repo.

## Why they are here

The app used to load these through `next/font/google`, which downloads the font
stylesheets and files from Google every time the site is built. On 2026-11-15
two builds in a row failed on every page with "next/font/google queries have
exactly one entry", then passed again minutes later with no change to the code:
Google had briefly answered with a different kind of address for one font, and
the build could not take it. A failed build means a change does not go live.

With the files here, a build needs nothing from Google.

## What is here

| Folder | Face | Version | Used for | Licence |
| --- | --- | --- | --- | --- |
| `barlow` | Barlow 400 500 600 700 | v13 | the app's text | SIL OFL 1.1 |
| `barlow-condensed` | Barlow Condensed 500 600 700 | v13 | headings and labels | SIL OFL 1.1 |
| `inter` | Inter 400 to 700 (one variable file per alphabet) | v20 | customer paper, body | SIL OFL 1.1 |
| `space-grotesk` | Space Grotesk 500 700 (one variable file per alphabet) | v22 | customer paper, headings | SIL OFL 1.1 |
| `ibm-plex-mono` | IBM Plex Mono 400 600 | v23 | ids only: job numbers, VINs | SIL OFL 1.1 |

Each folder holds that family's `OFL.txt`. The licence allows bundling the
fonts with the app as long as the licence text travels with them, so keep the
two together.

- `fonts.css` declares every face and sets the five `--font-*` variables on
  `<body>`. The rules are Google Fonts' own; only the file addresses changed.
- `PreloadFonts.tsx` asks the browser for the eleven everyday (latin) files
  early, on every page.
- `woff2.d.ts` lets code import a font file and get its address.

## The files are exactly what the site served before

Each `.woff2` is byte for byte the file a build fetched from Google on
2026-11-15 (43 files, 545 KB). Google serves slightly different files to
different browsers; these are the ones the build asked for, so every visitor
gets the same fonts as before the move.

Each face is split by alphabet (latin, latin-ext, vietnamese, cyrillic, greek,
symbols). A browser downloads only the ones a page has letters for, so the
extra alphabets cost nothing until a name needs them.

## Changing a font

Do not edit `fonts.css` by hand to add a weight: the weight needs its own files
for each alphabet. Get the family's stylesheet and files from Google Fonts for
the weights wanted, put the files in the family's folder, and copy the rules
across with the addresses pointed at the local files. Add the latin file to
`PreloadFonts.tsx` if the weight is used on most pages.
