# Europa League & Conference League results

Hand-entered results, not used by the website yet.

| File | Contents |
|---|---|
| `uefa-results-2024-25_2025-26.xlsx` | Europa League and Conference League 2024/25 and 2025/26: league phase, play-offs, Round of 16, quarter-finals, semi-finals and final |
| `uefa-results-2026-27.xlsx` | Europa League and Conference League 2026/27 (current season): league phase so far |

Each file has one tab per competition and season, a **Pots** tab, and a **How to fill in** tab with an example row and a progress counter.

## Filling in

Type the scores in the **yellow** cells (Home goals, Away goals). Leave both empty for a match not played.

- Use the score **after extra time** if a knockout match went to extra time.
- **Penalties winner**: only when a match was decided on penalties - pick the team from the dropdown.
- Don't change dates, rounds or team names.

## New seasons and knockout rounds

`python scripts/uefa_results_workbook.py 2027` creates `uefa-results-2027-28.xlsx` from Wikipedia's season pages
(fixtures and pots). It never overwrites an existing file, so knockout rounds of a season in progress are added by hand
or into a fresh file once they are drawn.
