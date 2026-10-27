# PumpWatch Ireland

A free website where drivers and station owners post today's fuel prices around Ireland. It shows Petrol, Petrol Plus, Diesel and Diesel Plus on an OpenStreetMap map, and every price shows when it was last updated and whether a driver or the station posted it.

- **Map:** OpenStreetMap, drawn with [Leaflet](https://leafletjs.com).
- **Stations:** every fuel station in the Republic of Ireland that's on OpenStreetMap, refreshed automatically every week. People can add any that are missing.
- **Prices:** stored in a free [Supabase](https://supabase.com) database so everyone sees the same numbers, live.

## What's in this folder

| File | What it does |
|---|---|
| `index.html`, `style.css`, `app.js` | The website itself |
| `config.js` | Where you paste your Supabase details (step 3) |
| `stations.json` | The list of petrol stations. Filled in automatically by the GitHub Action (step 2) |
| `scripts/fetch-stations.mjs` | Downloads the stations from OpenStreetMap |
| `.github/workflows/update-stations.yml` | Runs that download every Monday |
| `supabase/schema.sql` | Sets up the price database (step 3) |

## Step 1: Put it on GitHub Pages

1. Sign in to [github.com](https://github.com) and create a **new repository**, for example `pumpwatch`. Make it **Public**.
2. Click **uploading an existing file**, drag in everything from this folder, and click **Commit changes**.
   - The `.github` folder starts with a dot, so your computer may hide it. If it doesn't upload, create the file on GitHub instead: **Add file → Create new file**, type the name `.github/workflows/update-stations.yml`, and paste in the contents.
3. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/pumpwatch/`.

It works straight away in **demo mode**: the map and stations load, but prices are saved only in your own browser. Steps 2 and 3 make it a real shared app.

## Step 2: Load the petrol stations

1. In your repository, open the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
2. Click **Update station list** on the left, then **Run workflow → Run workflow**.
3. In about a minute it saves every fuel station OpenStreetMap lists in the Republic into `stations.json`. It then repeats every Monday, so new stations added to OpenStreetMap show up on your map.

Until this has run, the site downloads the stations directly from OpenStreetMap in each visitor's browser, which is slower. Running the Action makes it fast for everyone.

If the Action fails with "permission denied", go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, save, and run it again.

## Step 3: Share prices between everyone (Supabase)

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Pick the **West EU (Ireland)** region if offered.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and press **Run**. You should see "Success".
3. Open **Project Settings → API** (in newer versions: **Project Settings → Data API** and **API Keys**). Copy:
   - the **Project URL**
   - the **anon public** key
4. On GitHub, open `config.js`, click the pencil icon, paste them in between the quotes, and **Commit changes**:
   ```js
   supabaseUrl: "https://abcdefghijkl.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```
5. Wait a minute for GitHub Pages to update, then reload your site. The yellow "Demo mode" bar disappears, and prices posted on one phone appear on everyone else's map within seconds.

The anon key is designed to be public. The database rules only let visitors **read prices and add new ones**. Nobody can edit or delete through the website. You can see and remove anything in Supabase under **Table Editor**.

## How prices work

- Prices are in **cent per litre**, as on Irish forecourt signs (e.g. `174.9`). Typing `1.749` is converted automatically.
- Each fuel grade keeps its own "last updated" date and time. Prices older than 3 days are shown in amber as possibly out of date. You can change that number in `config.js`.
- Every report is kept, so you build up a price history you could chart later.
- Map pins are coloured **green / grey / red** for the cheapest, middle and dearest third of stations nationwide for the selected fuel.

## Before you launch publicly

- **Name:** "GasBuddy" is a registered trademark of an existing fuel-price app, so pick your own name before promoting the site. Change it in `index.html` (the `<title>` and the `<h1>`).
- **Station owners:** the "I run this station" option is self-declared. To verify owners you'd add Supabase sign-in and a manual approval step.
- **Spam:** anyone can post. Watch the `reports` table at first. If it gets abused, turn on Supabase's CAPTCHA protection or require sign-in to post.
- **Map tiles:** the free OpenStreetMap tile server is fine for a small site. If you get lots of traffic, switch to a tile provider such as MapTiler or Stadia Maps (both have free tiers) by changing the one `L.tileLayer(...)` line in `app.js`. See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- **Credit:** keep the "© OpenStreetMap contributors" credits on the page. They're required by OpenStreetMap's licence.
