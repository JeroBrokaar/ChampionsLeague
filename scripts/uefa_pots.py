"""Build pots-el.json and pots-ecl.json: league-phase draw pots with the site's team ids.

Pots come from Wikipedia's season pages; clubs are linked to the UEFA team ids in
data/<comp>/<year>/matches.json (run scripts/fetch_uefa.py first) by pairing Wikipedia's
fixture list with UEFA's on date and club names.
Usage: python scripts/uefa_pots.py
"""
import json, os, re, sys, unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from el_fixtures_from_wikipedia import matches as wiki_matches, pots as wiki_pots, wikitext  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
COMPS = {"el": ("UEFA_Europa_League", 4, 8), "ecl": ("UEFA_Conference_League", 6, 6)}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(fc|cf|ac|afc|sc|sk|fk|club|de|the|ssc|as|ss|kv|nk|bk|if|ff|cfr|1)\b", " ", s)
    return " ".join(s.split())


def similar(a, b):
    a, b = norm(a), norm(b)
    return a == b or (a and b and (a in b or b in a)) or (a.split()[:1] == b.split()[:1] and len(a.split()[0]) > 3)


def link_names(wiki_rows, uefa):
    """Wikipedia club name -> UEFA team (dict), by pairing fixtures on date and names."""
    by_date = defaultdict(list)
    for g in uefa:
        d = datetime.fromisoformat(g["utcDate"].replace("Z", "+00:00")).date()
        for off in (-1, 0, 1):
            by_date[str(d + timedelta(days=off))].append(g)
    name_map, used, progress = {}, set(), True
    strict = True
    while progress:
        progress = False
        for date, home, away in wiki_rows:
            cands = []
            for g in by_date[date]:
                if g["id"] in used:
                    continue
                gh, ga = g["homeTeam"], g["awayTeam"]
                hm = name_map[home]["id"] == gh["id"] if home in name_map else similar(home, gh["name"])
                am = name_map[away]["id"] == ga["id"] if away in name_map else similar(away, ga["name"])
                known = (home in name_map and name_map[home]["id"] == gh["id"]) or (away in name_map and name_map[away]["id"] == ga["id"])
                if (hm and am) or (not strict and known):
                    cands.append(g)
            if len(cands) == 1:
                g = cands[0]
                used.add(g["id"])
                for name, t in ((home, g["homeTeam"]), (away, g["awayTeam"])):
                    if name not in name_map:
                        name_map[name] = t
                        progress = True
        if not progress and strict:
            strict, progress = False, True
    return name_map


def main():
    for comp, (wiki, n_pots, games) in COMPS.items():
        seasons = json.load(open(os.path.join(ROOT, "data", comp, "seasons.json"), encoding="utf-8"))["seasons"]
        out = {}
        for s in seasons:
            year = int(s["id"])
            text = wikitext(f"{year}–{str(year + 1)[-2:]}_{wiki}_league_phase")
            rows = [(d, h, a) for d, _, _, h, a in wiki_matches(text)]
            pot_names = wiki_pots(text)
            uefa = [m for m in json.load(open(os.path.join(ROOT, "data", comp, str(year), "matches.json"), encoding="utf-8"))["matches"]
                    if m["stage"] == "LEAGUE_STAGE"]
            name_map = link_names(rows, uefa)
            pots = {p: [name_map[n]["id"] for n in names if n in name_map] for p, names in sorted(pot_names.items())}
            missing = [n for names in pot_names.values() for n in names if n not in name_map]
            # Check: 36 teams in n_pots pots, and every team meets each pot the right number of times
            pot_of = {i: p for p, ids in pots.items() for i in ids}
            per_pot = games // n_pots
            meet = defaultdict(Counter)
            for m in uefa:
                h, a = m["homeTeam"]["id"], m["awayTeam"]["id"]
                meet[h][pot_of.get(a)] += 1
                meet[a][pot_of.get(h)] += 1
            bad = [t for t, c in meet.items() if set(c) != set(pots) or set(c.values()) != {per_pot}]
            ok = not missing and len(pot_of) == 36 and len(pots) == n_pots and not bad
            print(f"{comp} {s['label']}: {len(pot_of)} teams in {len(pots)} pots - " + ("OK" if ok else f"PROBLEM missing={missing} bad={len(bad)}"))
            if ok:
                out[s["id"]] = {"source": f"https://en.wikipedia.org/wiki/{year}–{str(year + 1)[-2:]}_{wiki}_league_phase", **pots}
        lines = ["{", f'  "note": "League-phase draw pots ({comp.upper()}), keyed by season start year; ids as in data/{comp}.",', '  "seasons": {']
        for n, (sid, p) in enumerate(out.items()):
            lines.append(f'    "{sid}": {{')
            lines.append(f'      "source": {json.dumps(p["source"], ensure_ascii=False)},')
            keys = [k for k in p if k != "source"]
            lines += [f'      "{k}": {json.dumps(p[k])}' + ("," if j < len(keys) - 1 else "") for j, k in enumerate(keys)]
            lines.append("    }" + ("," if n < len(out) - 1 else ""))
        lines += ["  }", "}"]
        with open(os.path.join(ROOT, f"pots-{comp}.json"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
