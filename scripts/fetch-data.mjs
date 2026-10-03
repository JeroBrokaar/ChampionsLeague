// Fetches Champions League standings + matches from football-data.org
// and writes them to data/*.json for the static site.
// Usage: FOOTBALL_DATA_TOKEN=xxx node scripts/fetch-data.mjs

import { mkdir, writeFile } from "node:fs/promises";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error("Missing FOOTBALL_DATA_TOKEN environment variable.");
  process.exit(1);
}

const API = "https://api.football-data.org/v4/competitions/CL";

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const team = (t) => t && { id: t.id, name: t.name, shortName: t.shortName, tla: t.tla, crest: t.crest };

const [standings, matches] = await Promise.all([get("/standings"), get("/matches")]);

const total = standings.standings.find((s) => s.type === "TOTAL") ?? standings.standings[0];
const updated = new Date().toISOString();

const standingsOut = {
  updated,
  season: standings.season,
  table: (total?.table ?? []).map((r) => ({
    position: r.position,
    team: team(r.team),
    playedGames: r.playedGames,
    form: r.form,
    won: r.won,
    draw: r.draw,
    lost: r.lost,
    points: r.points,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalDifference,
  })),
};

const matchesOut = {
  updated,
  matches: matches.matches.map((m) => ({
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    matchday: m.matchday,
    stage: m.stage,
    homeTeam: team(m.homeTeam),
    awayTeam: team(m.awayTeam),
    score: { winner: m.score?.winner, fullTime: m.score?.fullTime },
  })),
};

await mkdir("data", { recursive: true });
await writeFile("data/standings.json", JSON.stringify(standingsOut, null, 2));
await writeFile("data/matches.json", JSON.stringify(matchesOut, null, 2));
console.log(`Wrote ${standingsOut.table.length} teams and ${matchesOut.matches.length} matches.`);
