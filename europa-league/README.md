# Europa League & Conference League results

Hand-entered results, not used by the website yet.

| File | Contents |
|---|---|
| `uefa-results-2024-25_2025-26.xlsx` | **Main file.** One tab per competition and season: Europa League 2024/25 and 2025/26, Conference League 2024/25 and 2025/26 (league phase, play-offs, Round of 16, quarter-finals, semi-finals, final), plus a Pots tab and a progress counter |
| `2026-27.csv`, `pots.csv` | Europa League 2026/27 (current season) as a CSV sheet, and the Europa League pots |

## Filling in

Open the Excel file and type the scores in the **yellow** cells (Home goals, Away goals). Leave both empty for a match not played.

- Use the score **after extra time** if a knockout match went to extra time.
- **Penalties winner**: only when a match was decided on penalties - pick the team from the dropdown.
- Don't change dates, rounds or team names.
- The **How to fill in** tab shows an example row and how many matches per tab are still to do.

## Making new sheets

- `python scripts/uefa_results_workbook.py 2026 2027` - Excel file for other seasons (never overwrites an existing file)
- `python scripts/el_fixtures_from_wikipedia.py 2027` - Europa League CSV for one season

Fixtures and pots come from Wikipedia's season pages.
