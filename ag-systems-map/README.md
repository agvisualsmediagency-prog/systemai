# AG Systems Map: online version

Static page (`index.html`) + one Vercel function (`api/notion.js`) + Supabase for saved maps.

## 1. Supabase (2 min)
1. Open your project → **SQL Editor** → **New query**.
2. Paste all of `supabase.sql` → **Run**.
   This creates the `maps` table, turns on live updates, and loads your Template and the Abarca November 2026 map.

The Supabase URL and anon key are already set inside `index.html`.

## 2. Vercel (3 min)
1. Put this folder in a GitHub repo (files at the repo root: `index.html`, `api/`, `package.json`).
2. Vercel → **Add New → Project** → import the repo. Framework preset: **Other**. No build command. Deploy.

The map works at this point: ticks, edits, new monthly maps, and live sync between everyone.

## 3. Notion calendar sync (optional, 3 min)
1. Go to notion.so/my-integrations → **New integration** (internal) → copy the secret.
2. In Notion, open the **General Calendar** database and the **Customers** database → `•••` → **Connections** → add your integration.
3. Vercel → Project → **Settings → Environment Variables** → add `NOTION_TOKEN` = the secret → **Redeploy**.

Without the token the map still works; you'd just type client names by hand and there'd be no calendar sync.

## Note on access
Anyone with the link can view and edit, the same as the shared artifact. The anon key is meant to be public, but if you need a login later, add Supabase Auth and change the two policies to `to authenticated`.
