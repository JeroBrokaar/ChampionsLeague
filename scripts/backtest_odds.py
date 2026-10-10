"""Backtest match-odds models: pot-only vs pots on one scale + country rating (+ club rating).

Trains on 2024/25 and tests on 2025/26 (all three competitions). Run from the repo root after
downloading the live data (see CLAUDE.md). The site uses "pots + country, pull 10" (fitRatingModel in app.js).
"""
import json, math, random, re, unicodedata
from collections import defaultdict

COMPS = {"cl": ("data", "pots.json", 4, 8), "el": ("data/el", "pots-el.json", 4, 8), "ecl": ("data/ecl", "pots-ecl.json", 6, 6)}
ALIASES = {"man utd": "manchester united", "man city": "manchester city", "nott m forest": "nottingham forest",
           "paris": "paris saint germain", "psg": "paris saint germain", "atleti": "atletico madrid", "spurs": "tottenham hotspur",
           "tottenham": "tottenham hotspur", "bayern": "bayern munich", "inter": "inter milan", "crvena zvezda": "red star belgrade",
           "leverkusen": "bayer leverkusen", "stuttgart": "vfb stuttgart", "frankfurt": "eintracht frankfurt", "salzburg": "austria salzburg"}


def club_key(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())
    strip = lambda x: " ".join(re.sub(r"\b(fc|cf|ac|afc|sc|sk|fk|club|de|the|ssc|as|ss|kv|1)\b", " ", x).split())
    return strip(ALIASES.get(s) or ALIASES.get(strip(s)) or s)


def same_name(a, b):
    for n in (a["name"], a.get("shortName")):
        for m in (b["name"], b.get("shortName")):
            x, y = club_key(n), club_key(m)
            if x and y and (x == y or (x.startswith(y + " ") and len(y) >= 4) or (y.startswith(x + " ") and len(x) >= 4)):
                return True
    return False


def load():
    seasons = {}
    for comp, (base, potsfile, npots, games) in COMPS.items():
        pots = json.load(open(potsfile, encoding="utf-8"))["seasons"]
        for y in ("2024", "2025"):
            st = json.load(open(f"{base}/{y}/standings.json", encoding="utf-8"))["table"]
            ms = json.load(open(f"{base}/{y}/matches.json", encoding="utf-8"))["matches"]
            tm = json.load(open(f"{base}/{y}/teams.json", encoding="utf-8"))["teams"]
            pot_of = {i: int(p) for p, ids in pots[y].items() if isinstance(ids, list) for i in ids}
            league = []
            for m in ms:
                if m["stage"] != "LEAGUE_STAGE" or m["status"] != "FINISHED":
                    continue
                ft, p = m["score"]["fullTime"], m["score"].get("penalties") or {"home": 0, "away": 0}
                league.append((m["homeTeam"]["id"], m["awayTeam"]["id"], ft["home"] - p["home"], ft["away"] - p["away"], m["matchday"]))
            seasons[(comp, y)] = {"table": st, "league": league, "pot_of": pot_of, "npots": npots, "games": games,
                                  "country": {t["id"]: ("France" if t.get("country") == "Monaco" else t.get("country")) for t in tm}}
    # club identities across competitions: id within a competition, name across competitions
    ident, clubs = {}, []
    for (comp, y), s in sorted(seasons.items()):
        for r in s["table"]:
            t = r["team"]
            if t["id"] in ident:
                continue
            c = next((c for c in clubs if comp not in c["comps"] and same_name(c["team"], t)), None)
            if c is None:
                c = {"team": t, "comps": set(), "n": len(clubs)}
                clubs.append(c)
            c["comps"].add(comp)
            ident[t["id"]] = c["n"]
    return seasons, ident


def pot_score(pot, npots):
    return ((npots + 1) / 2 - pot) / ((npots - 1) / 2)  # +1 = pot 1, -1 = last pot


def probs(x, c):
    sig = lambda v: 1 / (1 + math.exp(-v))
    ph, pa = sig(x - c), sig(-x - c)
    return ph, max(1 - ph - pa, 1e-6), pa


def fit(train, ident, use_club, use_country, lam_club=3.0, lam_country=3.0, iters=400, lr=0.05):
    """Ordered-logit style model: x = h + b_pot[comp]*dpot + (club_h - club_a) + (country_h - country_a)."""
    h, c = 0.3, 0.5
    bpot = defaultdict(float)
    club, ctry = defaultdict(float), defaultdict(float)
    rows = []
    for key, s in train.items():
        comp = key[0]
        for hi, ai, hg, ag, md in s["league"]:
            out = 0 if hg > ag else 2 if hg < ag else 1
            dp = pot_score(s["pot_of"][hi], s["npots"]) - pot_score(s["pot_of"][ai], s["npots"])
            rows.append((comp, dp, ident[hi], ident[ai], s["country"].get(hi), s["country"].get(ai), out))
    n = len(rows)
    for _ in range(iters):
        gh = gc = 0.0
        gb, gk, gn = defaultdict(float), defaultdict(float), defaultdict(float)
        for comp, dp, ch, ca, nh, na, out in rows:
            x = h + bpot[comp] * dp + (club[ch] - club[ca] if use_club else 0) + (ctry[nh] - ctry[na] if use_country else 0)
            sig = lambda v: 1 / (1 + math.exp(-v))
            sh, sa = sig(x - c), sig(-x - c)
            # d log P / d x and d log P / d c for the observed outcome
            if out == 0:
                dx, dc = 1 - sh, -(1 - sh)
            elif out == 2:
                dx, dc = -(1 - sa), -(1 - sa)
            else:
                pd = max(1 - sh - sa, 1e-9)
                dx = (-sh * (1 - sh) + sa * (1 - sa)) / pd
                dc = (sh * (1 - sh) + sa * (1 - sa)) / pd
            gh += dx; gc += dc; gb[comp] += dx * dp
            if use_club:
                gk[ch] += dx; gk[ca] -= dx
            if use_country:
                gn[nh] += dx; gn[na] -= dx
        h += lr * gh / n * 10; c = max(0.05, c + lr * gc / n * 10)
        for k in gb: bpot[k] += lr * gb[k] / n * 10
        if use_club:
            for k in set(gk) | set(club): club[k] += lr * (gk[k] - lam_club * club[k]) / 30
        if use_country:
            for k in set(gn) | set(ctry): ctry[k] += lr * (gn[k] - lam_country * ctry[k]) / 30
    return {"h": h, "c": c, "bpot": dict(bpot), "club": club, "ctry": ctry, "use_club": use_club, "use_country": use_country}


def match_probs(model, comp, s, hi, ai, ident):
    dp = pot_score(s["pot_of"][hi], s["npots"]) - pot_score(s["pot_of"][ai], s["npots"])
    x = model["h"] + model["bpot"].get(comp, 0) * dp
    if model["use_club"]:
        x += model["club"].get(ident[hi], 0) - model["club"].get(ident[ai], 0)
    if model["use_country"]:
        x += model["ctry"].get(s["country"].get(hi), 0) - model["ctry"].get(s["country"].get(ai), 0)
    return probs(x, model["c"])


def cell_model(train_s):
    """The current site model: home/draw/away rates per (home pot, away pot), shrunk toward the overall split."""
    cnt, tot = defaultdict(lambda: [0, 0, 0]), [0, 0, 0]
    for hi, ai, hg, ag, md in train_s["league"]:
        k = 0 if hg > ag else 2 if hg < ag else 1
        cnt[(train_s["pot_of"][hi], train_s["pot_of"][ai])][k] += 1
        tot[k] += 1
    n = sum(tot); ov = [t / n for t in tot]
    def f(s, hi, ai):
        cc = cnt[(s["pot_of"][hi], s["pot_of"][ai])]; t = sum(cc) + 3
        return tuple((cc[k] + 3 * ov[k]) / t for k in range(3))
    return f


def simulate(s, prob_fn, runs=3000, seed=1):
    rnd = random.Random(seed)
    ids = [r["team"]["id"] for r in s["table"]]
    exp = defaultdict(float); top8 = defaultdict(int); top24 = defaultdict(int)
    games = [(hi, ai, prob_fn(hi, ai)) for hi, ai, *_ in s["league"]]
    for _ in range(runs):
        pts = defaultdict(int)
        for hi, ai, (ph, pd, pa) in games:
            u = rnd.random()
            if u < ph: pts[hi] += 3
            elif u < ph + pd: pts[hi] += 1; pts[ai] += 1
            else: pts[ai] += 3
        order = sorted(ids, key=lambda i: (-pts[i], rnd.random()))
        for k, i in enumerate(order):
            exp[i] += pts[i] / runs
            if k < 8: top8[i] += 1
            if k < 24: top24[i] += 1
    return exp, {i: top8[i] / runs for i in ids}, {i: top24[i] / runs for i in ids}


def main():
    seasons, ident = load()
    train = {k: v for k, v in seasons.items() if k[1] == "2024"}
    variants = {"Pots only (now)": None, "Pots (rating model)": fit(train, ident, False, False)}
    for lam in (3.0, 10.0, 30.0):
        variants[f"+ country  pull {lam:g}"] = fit(train, ident, False, True, lam_country=lam)
        variants[f"+ both     pull {lam:g}"] = fit(train, ident, True, True, lam_club=lam, lam_country=lam)
    print(f"{'':22}" + "".join(f"{c.upper():>34}" for c in COMPS))
    print(f"{'':22}" + "".join(f"{'logloss  brier8  brier24  spread':>34}" for c in COMPS))
    for name, model in variants.items():
        line = f"{name:22}"
        for comp in COMPS:
            s = seasons[(comp, "2025")]
            f = (lambda hi, ai, cm=cell_model(train[(comp, "2024")]), s=s: cm(s, hi, ai)) if model is None else \
                (lambda hi, ai, model=model, s=s, comp=comp: match_probs(model, comp, s, hi, ai, ident))
            ll = sum(-math.log(max(f(hi, ai)[0 if hg > ag else 2 if hg < ag else 1], 1e-9)) for hi, ai, hg, ag, md in s["league"]) / len(s["league"])
            exp, t8, t24 = simulate(s, f)
            pos = {r["team"]["id"]: k + 1 for k, r in enumerate(s["table"])}
            b8 = sum((t8[i] - (pos[i] <= 8)) ** 2 for i in pos) / 36
            b24 = sum((t24[i] - (pos[i] <= 24)) ** 2 for i in pos) / 36
            spread = max(exp.values()) - min(exp.values())
            line += f"{ll:>10.3f}{b8:>8.3f}{b24:>9.3f}{spread:>7.1f}"
        print(line)
    m = variants["+ both     pull 10"]
    print("\nhome adv", round(m["h"], 2), "| pot effect", {k: round(v, 2) for k, v in m["bpot"].items()})
    print("strongest countries:", sorted(((round(v, 2), k) for k, v in m["ctry"].items()), reverse=True)[:6])
    print("weakest countries:", sorted(((round(v, 2), k) for k, v in m["ctry"].items()))[:4])


if __name__ == "__main__":
    main()
