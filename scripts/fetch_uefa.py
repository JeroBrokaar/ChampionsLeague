"""Fetch Europa League and Conference League data from UEFA's public match feeds.

Writes the same files the site uses for the Champions League (football-data format):
  data/<comp>/<startYear>/standings.json, matches.json, teams.json
  data/<comp>/seasons.json
for the current season and the two before it.
Usage: python scripts/fetch_uefa.py            (all competitions)
       python scripts/fetch_uefa.py el         (one competition)
"""
import json, os, sys, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
COMPETITIONS = {"el": 14, "ecl": 2019}
PAST_SEASONS = 2
# UEFA ids are offset so they can never clash with football-data ids used for the Champions League.
ID_OFFSET = 1_000_000
STAGES = {
    "League Phase": "LEAGUE_STAGE",
    "Knockout Phase Play-Offs": "PLAYOFFS", "Knock-out Play-off": "PLAYOFFS",
    "Round of 16": "LAST_16", "Quarter-finals": "QUARTER_FINALS", "Semi-finals": "SEMI_FINALS", "Final": "FINAL",
}
STATUS = {"FINISHED": "FINISHED", "LIVE": "IN_PLAY", "PLAYING": "IN_PLAY", "HALF_TIME": "PAUSED"}
COUNTRIES = {
    "ALB": "Albania", "AND": "Andorra", "ARM": "Armenia", "AUT": "Austria", "AZE": "Azerbaijan", "BEL": "Belgium",
    "BIH": "Bosnia and Herzegovina", "BLR": "Belarus", "BUL": "Bulgaria", "CRO": "Croatia", "CYP": "Cyprus",
    "CZE": "Czech Republic", "DEN": "Denmark", "ENG": "England", "ESP": "Spain", "EST": "Estonia", "FIN": "Finland",
    "FRA": "France", "FRO": "Faroe Islands", "GEO": "Georgia", "GER": "Germany", "GIB": "Gibraltar", "GRE": "Greece",
    "HUN": "Hungary", "IRL": "Republic of Ireland", "ISL": "Iceland", "ISR": "Israel", "ITA": "Italy", "KAZ": "Kazakhstan",
    "KOS": "Kosovo", "LIE": "Liechtenstein", "LTU": "Lithuania", "LUX": "Luxembourg", "LVA": "Latvia", "MDA": "Moldova",
    "MKD": "North Macedonia", "MLT": "Malta", "MNE": "Montenegro", "NED": "Netherlands", "NIR": "Northern Ireland",
    "NOR": "Norway", "POL": "Poland", "POR": "Portugal", "ROU": "Romania", "RUS": "Russia", "SCO": "Scotland",
    "SMR": "San Marino", "SRB": "Serbia", "SUI": "Switzerland", "SVK": "Slovakia", "SVN": "Slovenia", "SWE": "Sweden",
    "TUR": "Turkey", "UKR": "Ukraine", "WAL": "Wales",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def team(t):
    return {
        "id": int(t["id"]) + ID_OFFSET,
        "name": t["internationalName"],
        "shortName": t["internationalName"],
        "tla": t.get("teamCode"),
        "crest": t.get("mediumLogoUrl") or t.get("logoUrl"),
    }


def convert_match(m):
    s = m.get("score") or {}
    total, pens = s.get("total"), s.get("penalty")
    status = STATUS.get(m.get("status"), "TIMED")
    full = None
    if total:
        # football-data style: fullTime includes shoot-out goals; the site subtracts "penalties".
        full = {"home": total["home"] + (pens["home"] if pens else 0), "away": total["away"] + (pens["away"] if pens else 0)}
    winner = None
    if status == "FINISHED" and total:
        # A shoot-out decides the winner on its own; otherwise the score after extra time does.
        h, a = (pens["home"], pens["away"]) if pens else (total["home"], total["away"])
        winner = "HOME_TEAM" if h > a else "AWAY_TEAM" if h < a else "DRAW"
    md = m.get("matchday") or {}
    out = {
        "id": int(m["id"]) + ID_OFFSET,
        "utcDate": m["kickOffTime"]["dateTime"].replace("+0000", "Z"),
        "status": status,
        "matchday": int(md["sequenceNumber"]) if md.get("sequenceNumber") else None,
        "stage": STAGES[m["round"]["metaData"]["name"]],
        "homeTeam": team(m["homeTeam"]),
        "awayTeam": team(m["awayTeam"]),
        "score": {"winner": winner, "duration": "PENALTY_SHOOTOUT" if pens else ("REGULAR" if full else None),
                  "fullTime": full or {"home": None, "away": None}},
    }
    if pens:
        out["score"]["penalties"] = {"home": pens["home"], "away": pens["away"]}
    return out


def fetch_season(comp, season_year):
    """season_year = UEFA's year (the year the season ends). Returns the start year, or None if empty."""
    cid = COMPETITIONS[comp]
    raw = get(f"https://match.uefa.com/v5/matches?competitionId={cid}&seasonYear={season_year}&limit=500&offset=0&order=ASC")
    raw = [m for m in raw if m.get("round", {}).get("metaData", {}).get("name") in STAGES
           and not m["homeTeam"].get("isPlaceHolder") and not m["awayTeam"].get("isPlaceHolder")]
    if not raw:
        return None
    matches = [convert_match(m) for m in raw]
    league = [m for m in matches if m["stage"] == "LEAGUE_STAGE"]
    start_year = int(min(m["utcDate"] for m in league)[:4]) if league else season_year - 1

    standings = get(f"https://standings.uefa.com/v1/standings?competitionId={cid}&seasonYear={season_year}")
    items = next((g["items"] for g in standings if g.get("round", {}).get("name") == "League Phase"), standings[0]["items"])
    table = [{
        "position": it["rank"], "team": team(it["team"]), "playedGames": it["played"],
        "won": it["won"], "draw": it["drawn"], "lost": it["lost"], "points": it["points"],
        "goalsFor": it["goalsFor"], "goalsAgainst": it["goalsAgainst"], "goalDifference": it["goalDifference"],
    } for it in sorted(items, key=lambda x: x["rank"])]

    teams = {}
    for m in raw:
        for t in (m["homeTeam"], m["awayTeam"]):
            teams[int(t["id"]) + ID_OFFSET] = {"id": int(t["id"]) + ID_OFFSET, "country": COUNTRIES.get(t.get("countryCode"), t.get("countryCode")), "code": t.get("countryCode")}

    updated = datetime.now(timezone.utc).isoformat()
    dates = sorted(m["utcDate"] for m in matches)
    season = {"startDate": dates[0][:10], "endDate": dates[-1][:10]}
    folder = os.path.join(ROOT, "data", comp, str(start_year))
    os.makedirs(folder, exist_ok=True)
    for name, payload in (("standings", {"updated": updated, "season": season, "table": table}),
                          ("matches", {"updated": updated, "matches": matches}),
                          ("teams", {"teams": list(teams.values())})):
        with open(os.path.join(folder, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
    played = sum(1 for m in matches if m["status"] == "FINISHED")
    print(f"{comp} {start_year}/{str(start_year + 1)[-2:]}: {len(table)} teams, {len(matches)} matches ({played} played)")
    return start_year


def main(comps):
    today = date.today()
    current = today.year + 1 if today.month >= 7 else today.year  # UEFA season year
    for comp in comps:
        seasons = []
        for i, year in enumerate(range(current, current - PAST_SEASONS - 1, -1)):
            try:
                start = fetch_season(comp, year)
            except Exception as err:  # past seasons are best-effort; the current one must work
                if i == 0:
                    raise
                print(f"{comp} {year}: skipped ({err})")
                continue
            if start is not None:
                seasons.append({"id": str(start), "label": f"{start}/{str(start + 1)[-2:]}", "current": not seasons})
        with open(os.path.join(ROOT, "data", comp, "seasons.json"), "w", encoding="utf-8") as f:
            json.dump({"updated": datetime.now(timezone.utc).isoformat(), "seasons": seasons}, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1:] or list(COMPETITIONS))
