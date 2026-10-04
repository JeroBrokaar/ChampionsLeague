# Project notes for Claude

Static website with standings, matches and statistics for the **Champions League**, **Europa League** and
**Conference League** (36-team league-phase format, seasons since 2024/25).
Live: https://jerobrokaar.github.io/ChampionsLeague/ · Repo: https://github.com/JeroBrokaar/ChampionsLeague (public)

## How it works

- Plain HTML/CSS/JS, no build step: `index.html`, `style.css`, `app.js` (all logic in one file).
- GitHub Action `.github/workflows/deploy.yml` fetches data, assembles `_site/` and deploys to GitHub Pages.
  Runs on every push to `main`, every 3 hours, and every 30 min on Tue/Wed/Thu evenings (UTC).
  **Every push goes live within ~2 minutes** — the user expects changes to be pushed when done.
- CSS/JS are cache-busted with `?v=<commit>` at deploy; the HTML itself may be cached by browsers for 10 min
  (tell the user to press Ctrl+F5 if a change doesn't show).

## Data

| Competition | Source | Script | Output |
|---|---|---|---|
| Champions League | football-data.org free plan (secret `FOOTBALL_DATA_TOKEN`, 10 req/min) | `scripts/fetch-data.mjs` (Node, CI only) | `data/<startYear>/` |
| Europa League / Conference League | UEFA's public feeds `match.uefa.com/v5/matches` + `standings.uefa.com/v1/standings` (unofficial, may change) | `scripts/fetch_uefa.py` (Python) | `data/el/<startYear>/`, `data/ecl/<startYear>/` |

- Per season: `standings.json`, `matches.json`, `teams.json` (club countries) + `data/<comp>/seasons.json`.
  Current season + two previous. `data/` is **gitignored** (generated in CI).
- UEFA team/match ids are offset by **1,000,000** so they never clash with football-data ids.
- football-data's `fullTime` **includes penalty shoot-out goals**; `removeShootouts()` in app.js subtracts
  `score.penalties`. `fetch_uefa.py` writes the same convention. Shoot-out winner comes from the shoot-out.
- UEFA round names vary per season (e.g. "Knockout Phase Play-Offs" vs "Knock-out Play-off") — check
  `STAGES` / `ROUNDS` when a new season starts.
- Static files: `pots.json` (CL, football-data ids), `pots-el.json` / `pots-ecl.json` (UEFA ids, keyed by
  season start year), `finals.json` (all finals of Europa Cup I/II/III from Wikipedia, football-data ids;
  UEFA clubs matched by name via `clubKey()`/`CLUB_ALIASES`), `assets/crests/` (crest overrides, e.g. Ajax's
  classic crest via `CREST_OVERRIDES`).

## Competition differences

The **Club tab is independent of the switch**: its dropdown lists every club in a league phase this season,
grouped by competition; the page shows the club's current competition, recent seasons in any of the three,
and a combined European record. Clubs are linked across competitions by name (`loadEurope`, `sameTeamName`),
since football-data and UEFA ids differ. Matches clicked there open in their own competition.

`COMPS` in app.js: CL/EL = 4 pots × 9, 8 games (home + away vs each pot); ECL = 6 pots × 6, 6 games
(one opponent per pot, shown with an H/A marker). All competitions: 1–8 Round of 16, 9–24 knockout
play-offs (9–16 seeded), 25–36 out. Switch via `?comp=el` / `?comp=ecl` (full page reload).

## Feature switches

`FEATURES` at the top of app.js. The **simulation is paused** (user's request): Simulation tab, table
Top 8/Top 24 columns and match chance bars are all `false`. Code is intact; re-enable per part on request.

## User preferences (keep these)

- Site language English; dates like `4 nov`, weekdays always English (`Wed 14 oct`).
- Dark grey/black theme; **colour is reserved for results**: green win, yellow draw, red loss (from the row
  team's perspective in tables; home/draw/away in match-level bars). Gold (`--accent`) for titles/stars.
- GF/GA/GD always visually de-emphasised (muted grey).
- Talking points: one fact per topic per team, **positive phrasing** (no "never"/"haven't"), "in this format"
  (data only goes back to 2024/25), facts computed as of kick-off.
- Club page "Previous seasons": European titles per cup, then recent seasons (most recent on top) with a competition sticker.
- Don't use official UEFA logos (trademark); club crests come from the data sources.
- Ask before big redesigns; show test evidence (screenshots/checks) when reporting.

## Working in this repo (Windows)

- Shells: PowerShell is primary; Bash (Git Bash) available. **Commit with a Bash heredoc**
  (`git commit -F - <<'EOF' ... EOF`) — PowerShell here-strings break on double quotes in messages.
  End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Git identity is set locally in this repo (JeroBrokaar).
- No Node.js or LibreOffice locally; Python 3.14 + openpyxl available. Write new data scripts in Python
  so they can be tested locally. Python can't read files under `%APPDATA%\Claude` — keep temp files in `data/`.
- Local preview: `python -m http.server 8765` in the repo root, then open http://localhost:8765/.
  Download live data first, e.g. `curl -o data/2026/matches.json https://jerobrokaar.github.io/ChampionsLeague/data/2026/matches.json`
  (or run `python scripts/fetch_uefa.py` for EL/ECL). Force fresh JS/CSS in the browser with
  `fetch('app.js', {cache:'reload'})` + a real reload (hash-only navigation doesn't reload).
- Long Python patches via Bash heredoc sometimes fail to parse — write them to a file in `data/` and run that.

## Europa/Conference League Excel sheets (`europa-league/`)

User's own record (not used by the site). `scripts/uefa_results_workbook.py <years>` creates sheets from
Wikipedia fixtures; `scripts/fill_from_uefa.py <xlsx> <tab> <EL|ECL> <seasonYear> [--write]` fills scores
(dry run by default, only empty cells, refuses while the file is open in Excel — check for a `~$` lock file).
UEFA seasonYear = the year the season ends.

## Yearly to-dos (after the league-phase draw, late August)

1. CL pots: add the new season to `pots.json` (football-data ids; verify 1 home + 1 away per pot).
2. EL/ECL pots: `python scripts/fetch_uefa.py` then `python scripts/uefa_pots.py`.
3. After the May finals: `python scripts/finals_from_wikipedia.py` (needs local CL data) for Europa League finals
   (CL finals are added automatically from match data).
4. Optional: new Excel sheet with `scripts/uefa_results_workbook.py <year>`.
