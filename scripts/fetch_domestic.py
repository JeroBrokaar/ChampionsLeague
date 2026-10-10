"""Fetch domestic league results from football-data.org (free plan) for the Elo ratings.

Writes compact files elo-data/<CODE>-<season>.json with every finished match and the clubs.
Usage: FOOTBALL_DATA_TOKEN=xxx python scripts/fetch_domestic.py <out_dir> <season> [<season> ...]
  season = start year (2025 = 2025/26). Respects the free plan's 10 requests/minute.
"""
import json, os, sys, time, urllib.request

LEAGUES = {  # football-data code -> country (as used in the site's data)
    "PL": "England", "ELC": "England", "BL1": "Germany", "SA": "Italy",
    "PD": "Spain", "FL1": "France", "DED": "Netherlands", "PPL": "Portugal",
}
TOKEN = os.environ.get("FOOTBALL_DATA_TOKEN")
PAUSE = 6.5  # seconds between requests (free plan: 10 per minute)
CURRENT = 2026  # the season in progress is always fetched again; finished seasons only once


def get(path):
    req = urllib.request.Request(f"https://api.football-data.org/v4{path}", headers={"X-Auth-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fetch(code, season, out_dir):
    data = get(f"/competitions/{code}/matches?season={season}")
    teams, matches = {}, []
    for m in data.get("matches", []):
        for t in (m["homeTeam"], m["awayTeam"]):
            if t.get("id"):
                teams[t["id"]] = {"id": t["id"], "name": t.get("name"), "shortName": t.get("shortName"), "tla": t.get("tla")}
        ft = (m.get("score") or {}).get("fullTime") or {}
        if m.get("status") == "FINISHED" and ft.get("home") is not None:
            matches.append([m["utcDate"], m["homeTeam"]["id"], m["awayTeam"]["id"], ft["home"], ft["away"]])
    out = {"code": code, "country": LEAGUES[code], "season": season, "teams": list(teams.values()), "matches": matches}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{code}-{season}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{code} {season}: {len(teams)} clubs, {len(matches)} finished matches")


def main():
    if not TOKEN:
        sys.exit("Missing FOOTBALL_DATA_TOKEN")
    out_dir, seasons = sys.argv[1], [int(s) for s in sys.argv[2:]]
    first = True
    for season in seasons:
        for code in LEAGUES:
            if not first:
                time.sleep(PAUSE)
            first = False
            if season < CURRENT and os.path.exists(os.path.join(out_dir, f"{code}-{season}.json")):
                first = True  # finished season already stored - no request needed
                continue
            try:
                fetch(code, season, out_dir)
            except Exception as err:  # e.g. a season the free plan doesn't cover
                print(f"{code} {season}: skipped ({err})")


if __name__ == "__main__":
    main()
