// Temporary: checks which Europa League seasons the API-Football plan can access,
// and writes a short report (no secrets) to data/el-probe.json.
// Usage: API_FOOTBALL_KEY=xxx node scripts/probe-api-football.mjs

import { mkdir, writeFile } from "node:fs/promises";

const KEY = process.env.API_FOOTBALL_KEY;
const API = "https://v3.football.api-sports.io";
const EUROPA_LEAGUE = 3;
const report = { checked: new Date().toISOString() };

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { "x-apisports-key": KEY } });
  const body = await res.json().catch(() => ({}));
  const errors = body.errors && (Array.isArray(body.errors) ? body.errors : Object.values(body.errors));
  return { status: res.status, errors: errors?.length ? errors : null, results: body.results, response: body.response };
}

if (!KEY) {
  report.error = "API_FOOTBALL_KEY secret is not set";
} else {
  const status = await get("/status");
  const acc = status.response || {};
  report.plan = acc.subscription?.plan ?? null;
  report.requests = acc.requests ?? null;
  report.statusErrors = status.errors;

  const league = await get(`/leagues?id=${EUROPA_LEAGUE}`);
  report.leagueErrors = league.errors;
  report.seasonsListed = (league.response?.[0]?.seasons || []).map((s) => s.year).slice(-5);

  report.seasons = {};
  for (const season of [2026, 2025, 2024]) {
    const fixtures = await get(`/fixtures?league=${EUROPA_LEAGUE}&season=${season}`);
    const standings = await get(`/standings?league=${EUROPA_LEAGUE}&season=${season}`);
    const table = standings.response?.[0]?.league?.standings?.[0] || [];
    report.seasons[season] = {
      fixtures: fixtures.errors ? { errors: fixtures.errors } : { count: fixtures.results, rounds: [...new Set((fixtures.response || []).map((f) => f.league.round))].slice(0, 12) },
      standings: standings.errors ? { errors: standings.errors } : { teams: table.length, sample: table.slice(0, 3).map((r) => `${r.rank}. ${r.team.name} ${r.points}`) },
    };
  }
}

await mkdir("data", { recursive: true });
await writeFile("data/el-probe.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
