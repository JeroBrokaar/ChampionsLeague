"""Build finals.json: every final of the three European club cups, from Wikipedia.

  Europa Cup I   - European Cup / Champions League   (1956 - )
  Europa Cup II  - Cup Winners' Cup                   (1961 - 1999)
  Europa Cup III - UEFA Cup / Europa League           (1972 - )
  Conference League                                  (2022 - )

Clubs are linked to football-data.org team ids (as used on the site) by name, using the
club lists in data/*/standings.json, so download the site's data first.
Usage: python scripts/finals_from_wikipedia.py
"""
import glob, json, os, re, sys, unicodedata, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
COMPETITIONS = [
    ("ec1", "Europa Cup I & Champions League", "List_of_European_Cup_and_UEFA_Champions_League_finals"),
    ("ec2", "Europa Cup II (Cup Winners' Cup)", "List_of_UEFA_Cup_Winners'_Cup_finals"),
    ("ec3", "Europa Cup III (UEFA Cup & Europa League)", "List_of_UEFA_Cup_and_Europa_League_finals"),
    ("ec4", "Conference League", "List_of_UEFA_Conference_League_finals"),
]
# Wikipedia article -> football-data team id, where the names differ too much to match.
ALIASES = {
    "FC Bayern Munich": 5, "Inter Milan": 108, "Paris Saint-Germain FC": 524, "Atlético Madrid": 78,
    "Borussia Dortmund": 4, "PSV Eindhoven": 674, "Feyenoord": 675, "AFC Ajax": 678, "S.L. Benfica": 1903,
    "FC Porto": 503, "Celtic F.C.": 732, "Juventus FC": 109, "FC Barcelona": 81, "Bayer 04 Leverkusen": 3,
    "A.S. Roma": 100, "Red Star Belgrade": 7283, "Sporting CP": 498, "Athletic Bilbao": 77,
    "Galatasaray S.K. (football)": 610, "FC Shakhtar Donetsk": 1887, "S.S.C. Napoli": 113,
    "Olympiacos F.C.": 654, "Real Betis": 90,
}


def wikitext(title):
    url = "https://en.wikipedia.org/w/index.php?" + urllib.parse.urlencode({"title": title, "action": "raw"})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ChampionsLeagueSite/1.0"})) as r:
        return r.read().decode("utf-8")


def finals(text):
    """(season, winner, runner-up) per final; two-legged finals count once."""
    table = text[text.index("==List of finals=="):]
    table = table[:table.index("\n==", 5)]
    out = []
    for block in table.split("\n|-")[1:]:
        m = re.search(r'!\s*scope\s*=\s*"?row"?[^|]*\|\s*\[\[[^\]|]*\|(\d{4})–(\d{2,4})\]\]', block)
        if not m:
            continue
        cells = [l[1:] for l in block.strip().split("\n") if l.startswith("|") and not l.startswith("|}")]
        links = lambda c: re.findall(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", c)
        if len(cells) < 4 or not links(cells[1]) or not links(cells[3]):
            continue  # final not played yet
        (wa, wn), (ra, rn) = links(cells[1])[0], links(cells[3])[0]
        out.append((f"{m.group(1)}/{m.group(2)[-2:]}", (wa, wn or wa), (ra, rn or ra)))
    return out


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(fc|f c|cf|ac|afc|sc|sk|sl|club|de|futbol|football|calcio|ssc|as|ss|kv|psv)\b", " ", s)
    return " ".join(s.split())


def main():
    clubs = {}
    for f in glob.glob(os.path.join(ROOT, "data", "*", "standings.json")):
        for row in json.load(open(f, encoding="utf-8"))["table"]:
            clubs[row["team"]["id"]] = row["team"]
    if not clubs:
        sys.exit("No data/*/standings.json found - download the site's data first.")
    by_name = {norm(t["name"]): i for i, t in clubs.items()}
    match = lambda article: ALIASES.get(article) if ALIASES.get(article) in clubs else by_name.get(norm(article))

    result = []
    for key, title, page in COMPETITIONS:
        rows = []
        for season, (wa, wn), (ra, rn) in finals(wikitext(page)):
            entry = {"season": season, "winner": {"name": wn}, "runnerUp": {"name": rn}}
            for side, article in (("winner", wa), ("runnerUp", ra)):
                if match(article):
                    entry[side]["id"] = match(article)
            rows.append(entry)
        result.append((key, title, page, rows))
        print(f"{title}: {len(rows)} finals ({rows[0]['season']} - {rows[-1]['season']})")

    lines = ["{", '  "note": "Finals of the three European club cups, from Wikipedia. id = football-data.org team id '
             'where the club appears on this site. Europa Cup I finals after this list are added from the match data.",',
             '  "competitions": [']
    for n, (key, title, page, rows) in enumerate(result):
        lines.append(f'    {{ "key": "{key}", "title": {json.dumps(title)}, "source": "https://en.wikipedia.org/wiki/{page}", "finals": [')
        lines += ["      " + json.dumps(r, ensure_ascii=False) + ("," if i < len(rows) - 1 else "") for i, r in enumerate(rows)]
        lines.append("    ] }" + ("," if n < len(result) - 1 else ""))
    lines += ["  ]", "}"]
    with open(os.path.join(ROOT, "finals.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
