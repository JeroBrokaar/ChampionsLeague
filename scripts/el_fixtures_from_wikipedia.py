"""Create empty Europa League score sheets (CSV) from Wikipedia's fixture lists.

Usage:  python scripts/el_fixtures_from_wikipedia.py 2026
        (2026 = season 2026/27; writes europa-league/2026-27.csv and adds the pots to europa-league/pots.csv)

Never overwrites an existing season sheet, so scores you have typed in are safe.
"""
import csv, os, re, sys, urllib.parse, urllib.request
from collections import defaultdict

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "europa-league")
COLUMNS = ["Date", "Round", "Home", "Away", "Home goals", "Away goals", "Penalties winner"]
KO_ROUNDS = {"Knockout phase play-offs": "Play-offs", "Round of 16": "Round of 16",
             "Quarter-finals": "Quarter-finals", "Semi-finals": "Semi-finals"}


def wikitext(title):
    url = "https://en.wikipedia.org/w/index.php?" + urllib.parse.urlencode({"title": title, "action": "raw"})
    req = urllib.request.Request(url, headers={"User-Agent": "ChampionsLeagueSite/1.0"})
    try:
        with urllib.request.urlopen(req) as res:
            return res.read().decode("utf-8")
    except Exception:
        return ""


def clean_team(raw):
    raw = re.sub(r"\{\{(?:#invoke:flag\|)?fbaicon\|[^}]*\}\}", "", raw)
    raw = re.sub(r"\{\{[^{}]*\}\}", "", raw)
    m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", raw)
    name = (m.group(2) or m.group(1)) if m else raw
    return re.sub(r"\s+", " ", name).strip()


def field(block, key):
    m = re.search(r"^\|\s*" + key + r"\s*=(.*)$", block, re.M)
    return m.group(1).strip() if m else ""


def matches(text):
    """(date, top-level heading, sub heading, home, away) for every match box, in page order."""
    out, headings = [], {}
    pattern = re.compile(r"^(={2,4})\s*(.+?)\s*\1\s*$|\{\{(?:#invoke:)?[Ff]ootball box(?:\|main)?\s*\n(.*?)\n\}\}", re.M | re.S)
    for m in pattern.finditer(text):
        if m.group(1):
            level = len(m.group(1))
            headings = {k: v for k, v in headings.items() if k < level}
            headings[level] = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", m.group(2))
            continue
        d = re.search(r"\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})", field(m.group(3), "date"))
        date = f"{d.group(1)}-{int(d.group(2)):02d}-{int(d.group(3)):02d}" if d else ""
        out.append((date, headings.get(2, ""), headings.get(3, ""),
                    clean_team(field(m.group(3), "team1")), clean_team(field(m.group(3), "team2"))))
    return out


def pots(text):
    result = {}
    for m in re.finditer(r"\|\+\s*Pot (\d)\s*\n(.*?)\n\|\}", text, re.S):
        result[m.group(1)] = [clean_team(line.split("||")[0]) for line in m.group(2).splitlines()
                              if line.startswith("|") and "[[" in line and not line.startswith("|+")]
    return result


def main(year):
    label = f"{year}-{str(year + 1)[-2:]}"
    title = f"{year}–{str(year + 1)[-2:]}_UEFA_Europa_League"
    sheet = os.path.join(OUT_DIR, f"{label}.csv")
    if os.path.exists(sheet):
        sys.exit(f"{sheet} already exists - not overwriting.")

    league_text = wikitext(f"{title}_league_phase")
    rows = []
    for date, _, sub, home, away in matches(league_text):
        md = re.search(r"Matchday (\d)", sub)
        rows.append([date, f"League Stage {md.group(1) if md else '?'}", home, away, "", "", ""])

    # Knockouts: two legs per tie (first by date = 1st leg), then the final.
    seen = defaultdict(int)
    for date, top, _, home, away in matches(wikitext(f"{title}_knockout_phase")):
        if top not in KO_ROUNDS:
            continue
        key = (top, frozenset((home, away)))
        seen[key] += 1
        rows.append([date, f"{KO_ROUNDS[top]} - {'1st' if seen[key] == 1 else '2nd'} leg", home, away, "", "", ""])
    for date, _, _, home, away in matches(wikitext(f"{year + 1}_UEFA_Europa_League_final"))[:1]:
        rows.append([date, "Final", home, away, "", "", ""])

    # Drop knockout ties that aren't drawn yet ("Winner SF1", "Winner of play-off 3", ...).
    rows = [r for r in rows if not re.match(r"(Winner|Loser|Runner-up)\b", r[2]) and not re.match(r"(Winner|Loser|Runner-up)\b", r[3])]

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(sheet, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        w.writerows(sorted(rows, key=lambda r: r[0]))  # stable: keeps page order within a day

    pots_file = os.path.join(OUT_DIR, "pots.csv")
    existing = []
    if os.path.exists(pots_file):
        with open(pots_file, encoding="utf-8-sig") as f:
            existing = [r for r in csv.reader(f)][1:]
    existing = [r for r in existing if r and r[0] != label]
    for pot, teams in sorted(pots(league_text).items()):
        existing += [[label, pot, t] for t in teams]
    with open(pots_file, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Season", "Pot", "Team"])
        w.writerows(existing)

    league = sum(1 for r in rows if r[1].startswith("League"))
    print(f"{sheet}: {league} league-phase matches, {len(rows) - league} knockout matches")


if __name__ == "__main__":
    main(int(sys.argv[1]))
