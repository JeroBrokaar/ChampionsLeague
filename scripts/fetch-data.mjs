// Fetches Champions League standings + matches from football-data.org
// for the current season and the previous ones, writing data/<startYear>/*.json
// plus data/seasons.json (the list the site's season dropdown uses).
// Usage: FOOTBALL_DATA_TOKEN=xxx node scripts/fetch-data.mjs

import { mkdir, writeFile } from "node:fs/promises";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error("Missing FOOTBALL_DATA_TOKEN environment variable.");
  process.exit(1);
}

const API = "https://api.football-data.org/v4/competitions/CL";
const PAST_SEASONS = 2;

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const team = (t) => t && { id: t.id, name: t.name, shortName: t.shortName, tla: t.tla, crest: t.crest };
const label = (y) => `${y}/${String(y + 1).slice(-2)}`;

async function fetchSeason(year) {
  const q = year ? `?season=${year}` : "";
  const [standings, matches] = await Promise.all([get(`/standings${q}`), get(`/matches${q}`)]);
  const total = standings.standings.find((s) => s.type === "TOTAL") ?? standings.standings[0];
  const updated = new Date().toISOString();
  const startYear = new Date(standings.season.startDate).getUTCFullYear();

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

  const dir = `data/${startYear}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/standings.json`, JSON.stringify(standingsOut, null, 2));
  await writeFile(`${dir}/matches.json`, JSON.stringify(matchesOut, null, 2));
  console.log(`${label(startYear)}: ${standingsOut.table.length} teams, ${matchesOut.matches.length} matches.`);
  return startYear;
}

// Current season must succeed; past seasons are best-effort.
const current = await fetchSeason();
const seasons = [{ id: String(current), label: label(current), current: true }];

for (let y = current - 1; y >= current - PAST_SEASONS; y--) {
  try {
    await fetchSeason(y);
    seasons.push({ id: String(y), label: label(y), current: false });
  } catch (err) {
    console.warn(`Skipping ${label(y)}: ${err.message}`);
  }
}

await writeFile("data/seasons.json", JSON.stringify({ updated: new Date().toISOString(), seasons }, null, 2));
