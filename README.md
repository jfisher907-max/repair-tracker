# Repair Tracker

Single-user car repair shop tracker: customers → vehicles → jobs → parts & receipt photos → printable customer repair history. Built for Jake; runs on a phone (installable PWA) and PC against the same cloud backend.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind v4 · Supabase (Postgres, Auth, Storage) · Vercel · Anthropic API for receipt reading (optional).

---

## Where the data lives

| Thing | Where |
|---|---|
| Database, auth account, receipt photos | Supabase project **repair-tracker** (`kccmalbgfekapedgvhar`), region us-west-1 — [dashboard](https://supabase.com/dashboard/project/kccmalbgfekapedgvhar) |
| Code | This repo (`jfisher907-max/repair-tracker` on GitHub) |
| Hosting | Vercel project linked to this repo, auto-deploys `main` |
| Backups | Settings → "Export all data" downloads a zip of CSVs + all receipt photos. Do this now and then. |

Money is stored as **integer cents** everywhere (`*_cents` columns). Job totals are computed by the `job_totals` Postgres view; the same math is mirrored in `lib/calc.ts`.

## Local development

```bash
npm install
npm run dev
```

`.env.local` (not committed) carries the Supabase URL/key — but the public URL and publishable key are also hardcoded fallbacks in `lib/supabase.ts`, so the app runs with no env setup at all. Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local` to test receipt AI locally.

## Deploying (GitHub → Vercel)

1. **GitHub**: create a **private** repo named `repair-tracker` at <https://github.com/new> (owner `jfisher907-max`, no README/gitignore — the repo already has them). Then push:
   ```bash
   git push -u origin main
   ```
   (The `origin` remote is already configured.)
2. **Vercel**: [vercel.com/new](https://vercel.com/new) → Import `jfisher907-max/repair-tracker` → deploy. `vercel.json` pins the Next.js framework preset, so no build settings are needed.
3. **Env vars** (Vercel → Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://kccmalbgfekapedgvhar.supabase.co` *(optional — hardcoded fallback exists)*
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the publishable key from Supabase → Settings → API *(optional — fallback exists)*
   - `ANTHROPIC_API_KEY` = **server-only** key from [console.anthropic.com](https://console.anthropic.com) — enables AI receipt reading. Without it, receipts still work; you type lines in manually. Never expose this with a `NEXT_PUBLIC_` prefix.
4. Every later `git push` to `main` deploys automatically.

## The one account (auth)

There is **no signup page**. The single login is `jfisher907@gmail.com` (already provisioned). Sessions are long-lived — you stay signed in on the phone.

- **Change the password**: Supabase dashboard → Authentication → Users → `jfisher907@gmail.com` → ⋮ → Reset/Update password. Do this on first use — the initial password was set at build time.
- **Lock signups** (recommended): Supabase dashboard → Authentication → Sign In / Providers → Email → disable "Allow new users to sign up". Even without this, Row-Level Security only grants data access to `jfisher907@gmail.com`.
- **If the account email ever changes**: update the `is_owner()` SQL function (Database → Functions) — every RLS policy checks it.

## Receipt scanning

Photo → private Storage bucket → server route (`app/api/extract-receipt`) calls Claude (`claude-haiku-4-5`) with a strict JSON schema → **review screen** (nothing is saved unreviewed) → confirmed lines become `part_lines` tied to the receipt. Extraction failures and missing API keys drop to the identical manual-entry screen. Settings shows AI status and has a "Test extraction" button.

## Customer report

Job detail / customer page / vehicle page → **Print history**. Scope by customer, single vehicle, or date range; prices can be excluded entirely. Print from Safari or desktop; "Save as PDF" in the print dialog is the PDF export. The report never shows parts cost, markup, or profit — and when a parts-charge override is set, per-line receipt prices are omitted so markup can't be inferred.

## Phone install (PWA)

Open the deployed URL in Safari → Share → **Add to Home Screen**. It opens fullscreen like an app. The shell is cached for instant opening; a red banner appears when offline (data entry needs a connection — offline sync is deliberately out of scope).

## Database schema

Applied as Supabase migration `initial_schema`: `customers`, `vehicles`, `jobs` (auto job numbers `J001…` via `job_number_seq`, never reused), `part_lines` (line_total generated; negatives legal for returns), `receipts`, single-row `settings`, `job_totals` view, RLS on everything via `is_owner()`, private `receipts` storage bucket. Soft delete (`deleted_at`) on customers/vehicles/jobs with restore in Settings.
