# Europa League score sheets

Hand-entered results for the Europa League. Not used by the website yet.

| File | Contents |
|---|---|
| `2025-26.csv` | All 189 matches of 2025/26: league phase, play-offs, Round of 16, quarter-finals, semi-finals, final |
| `2026-27.csv` | The 144 league-phase matches of 2026/27 (knockout rows are added once they are drawn) |
| `pots.csv` | The league-phase draw pots per season |

## Filling in

Open a sheet in Excel or Google Sheets and type the score in **Home goals** and **Away goals**. Leave both empty for matches not played yet.

- Use the score **after extra time** if a knockout match went to extra time.
- **Penalties winner**: only when a match or two-legged tie was decided on penalties, type the winning team's name exactly as it appears in the sheet. Otherwise leave it empty.
- Don't change team names, dates or rounds, and keep the file as **CSV (UTF-8)** when saving.

## New season

`python scripts/el_fixtures_from_wikipedia.py 2027` creates `2027-28.csv` and adds that season's pots, using Wikipedia's fixture lists. It never overwrites a sheet that already exists.
