# Champions League Standings

Covers the **Champions League**, **Europa League** and **Conference League** (switch at the top of the page).
Champions League data comes from football-data.org; Europa League and Conference League data from UEFA's
public match feeds (`scripts/fetch_uefa.py`), with league-phase pots in `pots-el.json` / `pots-ecl.json`
(rebuilt with `scripts/uefa_pots.py` after each draw).

A static website showing the Champions League league-phase table, results and fixtures.
Data comes from [football-data.org](https://www.football-data.org) (free tier) and is refreshed by a GitHub Action, which then deploys the site to GitHub Pages.

## Setup

1. Register for a free API key at <https://www.football-data.org/client/register>.
2. In this repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FOOTBALL_DATA_TOKEN`
   - Value: your API key
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Update data & deploy → Run workflow**.

The site will be live at `https://<your-username>.github.io/<repo-name>/`.

## How it works

- `scripts/fetch-data.mjs` downloads standings and matches, writing `data/standings.json` and `data/matches.json`.
- `.github/workflows/deploy.yml` runs that script every 3 hours (every 30 minutes on Tuesday-Thursday evenings), then publishes the site.
- `index.html`, `style.css`, `app.js` are the site itself: plain HTML/CSS/JS, no build step.

## Run locally

```bash
FOOTBALL_DATA_TOKEN=your-key node scripts/fetch-data.mjs
python -m http.server 8000
```

Then open <http://localhost:8000>.
