# Party Floor Planner

An interactive, drag-and-drop floor planner for the 10th-floor venue. Drawn to scale
(75′ × 62′-6″) with all fixed structure shown: elevators, stairs, bathrooms, pantry,
employee zone, dressing suite, structural columns, and roof-below cutouts.

It's a static site with no build step and no backend, so it runs by opening `index.html`
and hosts on GitHub Pages as-is.

## Files

- `index.html` — page structure
- `styles.css` — all styling
- `app.js` — planner logic (rendering, drag, save/load, custom items, auth, floor plan)
- `config.js` — your Supabase URL + anon key (fill in for login + cloud sync)
- `schema.sql` — database table + security policies to run in Supabase
- `README.md` — this file

## Features

- **Drag, rotate, duplicate, delete** any furniture piece. Arrow keys nudge, `R` rotates, `Del` removes.
- **Hover any item to see its size** (e.g. `Dining · 8′ × 7′ · 10 seats`).
- **Live counters**: seats provided vs. 85 target, folding chairs used, and placed-vs-available for every inventory item.
- **Add your own inventory items** — name, width, depth, shape, color, seats, and quantity. They appear in the palette and on the floor.
- **Accounts + cloud storage** via Supabase: sign in and your saved layouts live in a database, synced across any device. Without setup it falls back to local-only mode.
- **Save and load named layouts**, plus **Export / Import** to a `.json` file to share with the venue.
- **Print / save as PDF** for a clean copy.
- Recommended 90-seat layout loads by default.

## Login & cloud storage (Supabase)

Storage and login run on [Supabase](https://supabase.com) (free tier is plenty). The
frontend stays static — Supabase is the backend. Setup is about five minutes:

1. Create a free account at supabase.com and start a **New project**. Pick a name and a
   database password (you won't need the password in the app).
2. When the project finishes provisioning, open **SQL Editor → New query**, paste the
   contents of `schema.sql`, and click **Run**. This creates the `layouts` table and the
   row-level-security policies that keep each account's data private.
3. Open **Project Settings → API** and copy two values:
   - **Project URL**
   - the **anon public** key
4. Paste them into `config.js`, replacing the placeholders.
5. (Optional, for faster testing) In **Authentication → Providers → Email**, turn off
   "Confirm email" so new accounts can sign in immediately. Otherwise users confirm via a
   link emailed to them.
6. In **Authentication → URL Configuration**, add your GitHub Pages URL (and
   `http://localhost` if testing locally) to the allowed redirect/site URLs.

That's it. Reload the app and you'll get a sign-in screen. Each account's named layouts and
its autosaved working copy are stored in the database, so you can open the planner on your
laptop and your phone and see the same plans.

If you leave `config.js` with the placeholder values, the app skips login and runs in
local-only mode (layouts saved in that browser), so it still works before you set anything up.

I can't create the Supabase project for you — it lives in your account — but everything
above is wired and ready; you only paste in two values and run one SQL script.

## Run locally

Open `index.html` in any browser, or run a tiny static server in the folder so the
relative files load cleanly:

```bash
python3 -m http.server
# then visit the printed http://localhost:8000
```

Without Supabase configured it runs in local-only mode. With `config.js` filled in you'll
get the login screen and cloud storage.

## Host on GitHub Pages

1. Create a new GitHub repository (e.g. `party-planner`).
2. Add the files to the repo:
   ```bash
   git init
   git add index.html styles.css app.js config.js schema.sql README.md
   git commit -m "Floor planner"
   git branch -M main
   git remote add origin https://github.com/<your-username>/party-planner.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   pick branch **main** and folder **/ (root)**, then **Save**.
4. Wait ~1 minute. Your planner will be live at
   `https://<your-username>.github.io/party-planner/`.

## How storage works

- **Signed in (Supabase configured):** named layouts and your autosaved working copy are
  written to the `layouts` table, scoped to your account. Open the app anywhere, sign in,
  and your plans are there.
- **Local-only mode (no Supabase, or "use without an account"):** layouts save in that
  browser's local storage.
- **Export / Import** works in both modes for backups or handing a plan to someone else.

## Adjusting the floor plan

All fixed structure is drawn in the `drawFloor()` function in `app.js`, using feet as the
unit (`px(ft)` maps feet to pixels). Inventory totals live in `BUILTIN_INV`, and the default
layout is in `recommended()`.
