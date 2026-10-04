const STAGE_LABELS = {
  LEAGUE_STAGE: "League phase",
  PLAYOFFS: "Knockout play-offs",
  LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals",
  FINAL: "Final",
};
const LIVE = new Set(["IN_PLAY", "PAUSED", "LIVE"]);

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function loadJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function zone(pos) {
  if (pos <= 8) return "z-r16";
  if (pos <= 24) return "z-po";
  return "z-out";
}

function crest(url) {
  return url ? `<img class="crest" src="${esc(url)}" alt="" loading="lazy">` : `<span class="crest"></span>`;
}

/* ---------- Feature switches ---------- */

// The simulation is paused for now. Each part can be switched back on separately.
const FEATURES = {
  simulationTab: false, // the Simulation tab
  tablePredictions: false, // Top 8 / Top 24 columns in the table
  matchOddsBars: false, // home/draw/away bars under upcoming matches
};

/* ---------- Competition (switch at the top: ?comp=el / ?comp=ecl) ---------- */

const COMPS = {
  cl: { key: "cl", name: "Champions League", base: "data", pots: "pots.json", potCount: 4, games: 8,
        source: ["football-data.org", "https://www.football-data.org"] },
  el: { key: "el", name: "Europa League", base: "data/el", pots: "pots-el.json", potCount: 4, games: 8,
        source: ["UEFA", "https://www.uefa.com/uefaeuropaleague/"] },
  ecl: { key: "ecl", name: "Conference League", base: "data/ecl", pots: "pots-ecl.json", potCount: 6, games: 6,
         source: ["UEFA", "https://www.uefa.com/uefaconferenceleague/"] },
};
const COMP = COMPS[new URLSearchParams(location.search).get("comp")] || COMPS.cl;
const POT_KEYS = Array.from({ length: COMP.potCount }, (_, i) => String(i + 1));
// Champions/Europa League: two opponents per pot (home + away). Conference League: one per pot.
const TWO_PER_POT = COMP.games / COMP.potCount === 2;
const SLOTS = TWO_PER_POT ? POT_KEYS.flatMap((p) => [`${p}H`, `${p}A`]) : POT_KEYS;
const TABLE_COLS = 2 + SLOTS.length + 8 + 3; // rank, team, pot slots, P..Pts, Top 8, Top 24, Result

// Short codes where football-data's TLA is ambiguous or unclear.
const ABBR = { 5: "BAY", 81: "BAR", 5721: "BOD" };
const abbr = (t) => ABBR[t.id] || t.tla || (t.shortName || t.name).slice(0, 3).toUpperCase();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const shortDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// teamId -> { "1H": match, "1A": match, ... } (or { "1": match, ... } with one opponent per pot).
function buildOpponentGrid(matches, pots) {
  const potOf = {};
  for (const [pot, ids] of Object.entries(pots)) if (Array.isArray(ids)) ids.forEach((id) => (potOf[id] = pot));
  const grid = {};
  for (const m of matches) {
    if (m.stage !== "LEAGUE_STAGE" || !m.homeTeam?.id || !m.awayTeam?.id) continue;
    (grid[m.homeTeam.id] ??= {})[`${potOf[m.awayTeam.id]}${TWO_PER_POT ? "H" : ""}`] = m;
    (grid[m.awayTeam.id] ??= {})[`${potOf[m.homeTeam.id]}${TWO_PER_POT ? "A" : ""}`] = m;
  }
  return grid;
}

function opponentCell(m, slot, teamId) {
  const start = !TWO_PER_POT || slot.endsWith("H") ? " pot-start" : "";
  if (!m) return `<td class="opp-cell${start}"></td>`;
  const home = m.homeTeam.id === teamId;
  const opp = home ? m.awayTeam : m.homeTeam;
  const ft = m.score?.fullTime ?? {};
  const live = LIVE.has(m.status);
  const date = shortDate(m.utcDate);
  let res, label;
  if (m.status === "FINISHED" || live) {
    // Colour from the perspective of this row's team.
    const mine = home ? ft.home : ft.away;
    const theirs = home ? ft.away : ft.home;
    const outcome = live ? "live" : mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
    label = `${ft.home ?? 0}–${ft.away ?? 0}`;
    res = `<span class="res ${outcome}">${label}</span>`;
  } else {
    label = date;
    res = `<span class="res up">${date}</span>`;
  }
  const title = `${home ? "vs" : "at"} ${opp.name} · ${label}${m.status === "FINISHED" || live ? ` · ${date}` : ""}`;
  return `<td class="opp-cell${start}" title="${esc(title)}">
    <div class="opp">
      <span class="opp-team">${TWO_PER_POT ? "" : `<small class="opp-ha">${home ? "H" : "A"}</small>`}${crest(opp.crest)}<span>${esc(abbr(opp))}</span></span>
      ${res}
    </div>
  </td>`;
}

/* ---------- Through / out ---------- */

const LEAGUE_GAMES = COMP.games;
const STATUS = {
  r16: { label: "R16 ✓", title: "Round of 16 secured", cls: "z1" },
  top24: { label: "Top 24 ✓", title: "At least the play-offs secured", cls: "z2" },
  po: { label: "Play-offs", title: "Play-offs secured, top 8 out of reach", cls: "z2" },
  out: { label: "Out", title: "Eliminated", cls: "z3" },
};

// Conservative, points-only check: a team is "safe" for the top N only if at most N-1
// others could still reach its current points, and "out" only if at least N others
// already have more points than it can still reach. Ties count against the team.
function clinchStatus(table, games = LEAGUE_GAMES) {
  if (!table.length || table.every((r) => r.playedGames >= games)) return null;
  const rows = table.map((r) => ({ id: r.team.id, min: r.points, max: r.points + 3 * (games - r.playedGames) }));
  const status = new Map();
  for (const t of rows) {
    const canCatch = rows.filter((o) => o !== t && o.max >= t.min).length;
    const surelyAhead = rows.filter((o) => o !== t && o.min > t.max).length;
    const top8 = canCatch <= 7 ? "yes" : surelyAhead >= 8 ? "no" : "open";
    const top24 = canCatch <= 23 ? "yes" : surelyAhead >= 24 ? "no" : "open";
    let s = null;
    if (top8 === "yes") s = "r16";
    else if (top24 === "no") s = "out";
    else if (top24 === "yes") s = top8 === "no" ? "po" : "top24";
    else if (top8 === "no") s = "no-top8";
    if (s) status.set(t.id, s);
  }
  return status;
}

const statusBadge = (s) => (STATUS[s] ? `<span class="status-badge ${STATUS[s].cls}" title="${STATUS[s].title}">${STATUS[s].label}</span>` : "");

const RESULT = {
  LEAGUE: { label: "League phase", cls: "" },
  PLAYOFFS: { label: "Play-offs", cls: "" },
  LAST_16: { label: "Round of 16", cls: "" },
  QUARTER_FINALS: { label: "Quarter-finals", cls: "" },
  SEMI_FINALS: { label: "Semi-finals", cls: "res-strong" },
  FINAL: { label: "Final", cls: "res-final" },
  WINNER: { label: "Winner", cls: "res-winner" },
};

// Furthest stage each team reached; only once the final has been played.
function finalResults(matches) {
  const final = matches.find((m) => m.stage === "FINAL" && m.status === "FINISHED");
  if (!final) return null;
  const order = ["PLAYOFFS", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL"];
  const best = new Map();
  for (const m of matches) {
    const rank = order.indexOf(m.stage);
    if (rank === -1) continue;
    for (const id of [m.homeTeam?.id, m.awayTeam?.id]) {
      if (id && rank > (best.get(id) ?? -1)) best.set(id, rank);
    }
  }
  const out = new Map([...best].map(([id, rank]) => [id, order[rank]]));
  const w = final.score.winner;
  const winnerId = w === "HOME_TEAM" ? final.homeTeam.id : w === "AWAY_TEAM" ? final.awayTeam.id : null;
  if (winnerId) out.set(winnerId, "WINNER");
  return out;
}

function resultCell(results, id) {
  if (!results) return "";
  const r = RESULT[results.get(id) || "LEAGUE"];
  return `<td class="result-col"><span class="result ${r.cls}">${esc(r.label)}</span></td>`;
}

/* ---------- Prediction ---------- */

// The Top 8 / Top 24 columns come from the season simulation (see Simulation below).

function potIndex(pots) {
  const potOf = {};
  for (const [pot, ids] of Object.entries(pots || {})) if (Array.isArray(ids)) ids.forEach((id) => (potOf[id] = pot));
  return potOf;
}

const logit = (p) => { const c = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(c / (1 - c)); };
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// One simulation per season and data update, shared by the table and the Simulation tab.
const simCache = new Map();
function seasonSimulation(seasonId) {
  if (!simCache.has(seasonId)) {
    simCache.set(seasonId, (async () => {
      const pots = allPots[seasonId];
      if (!pots) return null;
      const [standings, matches] = await fetchSeason(seasonId);
      const league = (matches.matches || []).filter((m) => m.stage === "LEAGUE_STAGE");
      if (!league.length || league.every((m) => m.status === "FINISHED")) return { finished: true };
      const past = [];
      for (const meta of seasonIndex) {
        if (meta.id === seasonId || !allPots[meta.id]) continue;
        const [, m] = await fetchSeason(meta.id);
        const pastLeague = (m.matches || []).filter((x) => x.stage === "LEAGUE_STAGE");
        if (pastLeague.length && pastLeague.every((x) => x.status === "FINISHED")) past.push({ matches: m.matches, pots: allPots[meta.id] });
      }
      if (!past.length) return null;
      const sim = simulateSeason(standings.table, league, potIndex(pots), buildOddsModel(past), { seed: simSeed(standings.updated) });
      return { sim, ...mostLikelyTable(standings.table, sim.games) };
    })().catch((err) => { console.error(err); return null; }));
  }
  return simCache.get(seasonId);
}

const pctText = (p) => `${Math.round(p * 100)}%`;

function predCells(pred) {
  if (!pred) return "";
  const t8 = pred.top8, t24 = pred.top24;
  const cell = (p, first) => `<td class="pred-col${first ? " pred-first" : ""}">
    <span class="pred-num">${pctText(p)}</span><span class="pred-bar"><span style="width:${p * 100}%"></span></span></td>`;
  return cell(t8, true) + cell(t24, false);
}

function renderTable(rows, grid, status, results, preds) {
  const body = $("#table-body");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${TABLE_COLS}" class="empty">No standings yet.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    const gd = r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference;
    // Use the row index, not r.position: tied teams share a position in the data.
    const cut = i === 7 || i === 23 ? " cut" : "";
    const cells = grid[r.team.id] || {};
    return `<tr class="${zone(i + 1)}${cut}">
      <td class="pos sticky">${r.position}</td>
      <td class="team sticky"><div class="team-cell"><a class="team-link" href="${clubHref(r.team.id)}" data-club="${r.team.id}" title="Open club page">${crest(r.team.crest)}<span class="team-name">${esc(r.team.shortName || r.team.name)}</span></a>${status ? statusBadge(status.get(r.team.id)) : ""}</div></td>
      ${SLOTS.map((s) => opponentCell(cells[s], s, r.team.id)).join("")}
      <td class="pot-start">${r.playedGames}</td>
      <td>${r.won}</td>
      <td>${r.draw}</td>
      <td>${r.lost}</td>
      <td class="hide-sm goals">${r.goalsFor}</td>
      <td class="hide-sm goals">${r.goalsAgainst}</td>
      <td class="goals">${gd}</td>
      <td class="pts">${r.points}</td>
      ${preds ? predCells(preds.get(r.team.id)) : ""}
      ${resultCell(results, r.team.id)}
    </tr>`;
  }).join("");
}

/* ---------- Matches ---------- */

let rounds = [];
// Home/draw/away chances for upcoming matches of the season on screen (from the simulation).
let matchOddsById = new Map();

function roundKey(m) {
  return m.stage === "LEAGUE_STAGE" ? `LEAGUE_STAGE:${m.matchday}` : m.stage;
}

function roundLabel(key) {
  const [stage, md] = key.split(":");
  return md ? `Matchday ${md}` : STAGE_LABELS[stage] || stage.replace(/_/g, " ").toLowerCase();
}

function buildRounds(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = roundKey(m);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, label: roundLabel(key), matches: list.sort((a, b) => a.utcDate.localeCompare(b.utcDate)) }))
    .sort((a, b) => a.matches[0].utcDate.localeCompare(b.matches[0].utcDate));
}

function currentRoundIndex() {
  // First round that still has unfinished matches; otherwise the last one.
  const i = rounds.findIndex((r) => r.matches.some((m) => m.status !== "FINISHED"));
  return i === -1 ? rounds.length - 1 : i;
}

function matchRow(m) {
  const ft = m.score?.fullTime ?? {};
  const played = m.status === "FINISHED" || LIVE.has(m.status);
  const time = new Date(m.utcDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  let scoreHtml;
  if (played) {
    const pens = m.score?.pens ? `<small class="pens">pens ${m.score.pens.home}–${m.score.pens.away}</small>` : "";
    scoreHtml = `<div class="score${LIVE.has(m.status) ? " live" : ""}">${ft.home ?? 0} – ${ft.away ?? 0}${pens}</div>`;
  } else if (m.status === "POSTPONED" || m.status === "CANCELLED") {
    scoreHtml = `<div class="score time">${m.status === "POSTPONED" ? "PPD" : "CANC"}</div>`;
  } else {
    scoreHtml = `<div class="score time">${time}</div>`;
  }
  const winner = m.status === "FINISHED" ? m.score?.winner : null;
  const name = (t, side) =>
    `<span class="${winner && winner !== side && winner !== "DRAW" ? "loser" : ""}">${esc(t?.shortName || t?.name || "TBD")}</span>`;
  const known = m.homeTeam?.id && m.awayTeam?.id;
  return `<div class="match${known ? " clickable" : ""}"${known ? ` data-match="${m.id}" role="button" tabindex="0" aria-label="Match details"` : ""}>
    <div class="side home">${name(m.homeTeam, "HOME_TEAM")}${crest(m.homeTeam?.crest)}</div>
    ${scoreHtml}
    <div class="side away">${crest(m.awayTeam?.crest)}${name(m.awayTeam, "AWAY_TEAM")}</div>
    ${oddsBar(matchOddsById.get(m.id))}
  </div>`;
}

function oddsBar(o) {
  if (!o) return "";
  const title = `Home win ${pctText(o.h)} · Draw ${pctText(o.d)} · Away win ${pctText(o.a)}`;
  return `<div class="odds-bar" title="${title}" aria-label="${title}">
    <span class="home-win" style="flex:${o.h}"></span><span class="draw" style="flex:${o.d}"></span><span class="away-win" style="flex:${o.a}"></span>
  </div>`;
}

function renderRound(i) {
  const round = rounds[i];
  $("#md-select").value = String(i);
  $("#md-prev").disabled = i <= 0;
  $("#md-next").disabled = i >= rounds.length - 1;

  const byDay = new Map();
  for (const m of round.matches) {
    const day = new Date(m.utcDate).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }
  $("#match-list").innerHTML = [...byDay.entries()].map(([day, list]) =>
    `<div class="day"><h3>${esc(day)}</h3><div class="card">${list.map(matchRow).join("")}</div></div>`
  ).join("");
}

function setupMatches(matches) {
  rounds = buildRounds(matches);
  if (!rounds.length) {
    $("#match-list").innerHTML = `<div class="card empty">No matches yet.</div>`;
    $(".matchday-bar").hidden = true;
    return;
  }
  $(".matchday-bar").hidden = false;
  const select = $("#md-select");
  select.innerHTML = rounds.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join("");
  select.onchange = () => renderRound(Number(select.value));
  $("#md-prev").onclick = () => renderRound(Number(select.value) - 1);
  $("#md-next").onclick = () => renderRound(Number(select.value) + 1);
  renderRound(currentRoundIndex());
}

/* ---------- Tabs ---------- */

function showView(view) {
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.view === view;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active);
  });
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  document.body.dataset.view = view;
  history.replaceState(null, "", `${location.pathname}${location.search}${view === "table" ? "" : `#${view}`}`);
  if (view === "stats") loadStats();
  if (view === "sim" && FEATURES.simulationTab) loadSim();
  if (view === "club") loadClub();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

// Clicking a match on the Matches tab opens its detail page.
function onMatchActivate(e) {
  const el = e.target.closest("[data-match]");
  if (!el || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  const comp = el.dataset.comp;
  if (comp && comp !== COMP.key) {
    // Match of another competition: open it there (full page in that competition).
    const params = new URLSearchParams(location.search);
    params.delete("season");
    if (comp === "cl") params.delete("comp"); else params.set("comp", comp);
    location.href = `${location.pathname}?${params}#match-${el.dataset.match}`;
    return;
  }
  openMatch(Number(el.dataset.match), true, e.currentTarget.id === "club-body" ? "club" : "matches");
}
for (const id of ["match-list", "club-body"]) {
  $(`#${id}`).addEventListener("click", onMatchActivate);
  $(`#${id}`).addEventListener("keydown", onMatchActivate);
}

window.addEventListener("popstate", () => {
  const h = location.hash.slice(1);
  if (h.startsWith("match-")) openMatch(Number(h.slice(6)), false);
  else showView(["matches", "stats", "club", ...(FEATURES.simulationTab ? ["sim"] : [])].includes(h) ? h : "table");
  const club = Number(new URLSearchParams(location.search).get("club"));
  if (h === "club" && clubLoaded && club && europe?.byId.has(club)) {
    $("#club-select").value = String(club);
    renderClub(club);
  }
});

/* ---------- Seasons ---------- */

let allPots = {};

// football-data's fullTime includes penalty shoot-out goals. Take them out so every score
// is the result after 90/120 minutes, and keep the shoot-out as score.pens.
function removeShootouts(data) {
  for (const m of data.matches || []) {
    const p = m.score?.penalties, ft = m.score?.fullTime;
    if (p && ft && ft.home != null && p.home != null) {
      m.score.pens = p;
      m.score.fullTime = { home: ft.home - p.home, away: ft.away - p.away };
    }
  }
  return data;
}

// Club badges that differ from football-data's (team id -> image in assets/crests).
// Ajax: the classic crest (1928-1991) is the club's official logo again since 2025/26.
const CREST_OVERRIDES = { 678: "assets/crests/ajax.png", 1050143: "assets/crests/ajax.png" }; // football-data and UEFA ids

function applyCrests(teams) {
  for (const t of teams) if (t && CREST_OVERRIDES[t.id]) t.crest = CREST_OVERRIDES[t.id];
}

const seasonCache = new Map();
function fetchSeason(id, comp = COMP) {
  const base = id ? `${comp.base}/${id}` : comp.base;
  if (!seasonCache.has(base)) {
    seasonCache.set(base, Promise.all([
      loadJson(`${base}/standings.json`),
      loadJson(`${base}/matches.json`).then(removeShootouts).catch(() => ({ matches: [] })),
      loadJson(`${base}/teams.json`).catch(() => ({ teams: [] })),
    ]).then((data) => {
      const [standings, matches] = data;
      applyCrests((standings.table || []).map((r) => r.team));
      applyCrests((matches.matches || []).flatMap((m) => [m.homeTeam, m.awayTeam]));
      return data;
    }));
  }
  return seasonCache.get(base);
}

async function loadSeason(id) {
  const [standings, matches] = await fetchSeason(id);
  const s = new Date(standings.season.startDate).getFullYear();
  const pots = allPots[String(s)];
  $(".standings").classList.toggle("no-pots", !pots);
  $("#season").textContent = `Season ${s}/${String(s + 1).slice(-2)} · League phase`;
  const results = finalResults(matches.matches || []);
  const table = standings.table || [];
  const status = clinchStatus(table);
  // Predictions only while the league phase is running.
  let preds = null;
  if (status && pots && (FEATURES.tablePredictions || FEATURES.matchOddsBars)) {
    const result = await seasonSimulation(String(s));
    if (result?.sim && FEATURES.tablePredictions) preds = new Map(result.sim.teams.map((t) => [t.team.id, t]));
    matchOddsById = FEATURES.matchOddsBars ? new Map((result?.sim?.games || []).map((g) => [g.m.id, g.o])) : new Map();
  } else {
    matchOddsById = new Map();
  }
  $(".standings").classList.toggle("no-result", !results);
  $(".standings").classList.toggle("no-pred", !preds);
  renderTable(table, buildOpponentGrid(matches.matches || [], pots || {}), status, results, preds);
  setupMatches(matches.matches || []);
  $("#updated").textContent = standings.updated
    ? `Updated ${new Date(standings.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "";
}

function setupSeasonPicker(seasons) {
  const select = $("#season-select");
  const wanted = new URLSearchParams(location.search).get("season");
  const initial = seasons.find((x) => x.id === wanted) || seasons.find((x) => x.current) || seasons[0];
  select.innerHTML = seasons.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join("");
  select.value = initial.id;
  select.hidden = seasons.length < 2;
  select.onchange = () => {
    const chosen = seasons.find((x) => x.id === select.value);
    const params = new URLSearchParams(location.search);
    chosen.current ? params.delete("season") : params.set("season", chosen.id);
    const qs = params.toString();
    history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
    loadSeason(chosen.id).catch(showError);
  };
  return initial.id;
}

function showError(err) {
  console.error(err);
  $("#table-body").innerHTML =
    `<tr><td colspan="${TABLE_COLS}" class="empty">No data yet. It appears after the GitHub Action has run once.</td></tr>`;
  $("#match-list").innerHTML = `<div class="card empty">No data yet.</div>`;
}

/* ---------- Simulation ---------- */

const SIM_RUNS = 10000;
const ODDS_PRIOR = 3;   // pulls thin pot-vs-pot samples toward the overall home/draw/away split
const FORM_SHRINK = 3;  // extra "games" of zero form, so one result doesn't swing a team too far
// Log-odds shift per point-per-game of form difference. Backtests on 2024/25 and 2025/26 were
// most accurate at 0 (points already in the table carry the form), so it is off for now.
const FORM_WEIGHT = 0;

// Home/draw/away rates for every (home pot, away pot) pair in past league phases.
function buildOddsModel(pastSeasons) {
  const counts = {}, all = { h: 0, d: 0, a: 0 };
  for (const { matches, pots } of pastSeasons) {
    const potOf = potIndex(pots);
    for (const m of matches) {
      if (m.stage !== "LEAGUE_STAGE" || m.status !== "FINISHED") continue;
      const hp = potOf[m.homeTeam.id], ap = potOf[m.awayTeam.id];
      if (!hp || !ap) continue;
      const { home: h, away: a } = m.score.fullTime;
      const k = h > a ? "h" : h < a ? "a" : "d";
      const c = (counts[`${hp}${ap}`] ??= { h: 0, d: 0, a: 0 });
      c[k]++; all[k]++;
    }
  }
  const n = all.h + all.d + all.a || 1;
  const overall = { h: all.h / n, d: all.d / n, a: all.a / n };
  return (hp, ap) => {
    const c = counts[`${hp}${ap}`] || { h: 0, d: 0, a: 0 };
    const t = c.h + c.d + c.a + ODDS_PRIOR;
    return { h: (c.h + ODDS_PRIOR * overall.h) / t, d: (c.d + ODDS_PRIOR * overall.d) / t, a: (c.a + ODDS_PRIOR * overall.a) / t };
  };
}

// Form: points per game above/below what the pot odds expected, shrunk toward zero.
function teamForm(table, finishedLeague, potOf, odds) {
  const exp = new Map(), act = new Map(), games = new Map();
  for (const m of finishedLeague) {
    const hp = potOf[m.homeTeam.id], ap = potOf[m.awayTeam.id];
    if (!hp || !ap) continue;
    const o = odds(hp, ap);
    const { home: h, away: a } = m.score.fullTime;
    const add = (map, id, v) => map.set(id, (map.get(id) || 0) + v);
    add(exp, m.homeTeam.id, 3 * o.h + o.d); add(exp, m.awayTeam.id, 3 * o.a + o.d);
    add(act, m.homeTeam.id, h > a ? 3 : h === a ? 1 : 0); add(act, m.awayTeam.id, a > h ? 3 : h === a ? 1 : 0);
    add(games, m.homeTeam.id, 1); add(games, m.awayTeam.id, 1);
  }
  return new Map(table.map((r) => {
    const id = r.team.id;
    return [id, ((act.get(id) || 0) - (exp.get(id) || 0)) / ((games.get(id) || 0) + FORM_SHRINK)];
  }));
}

// Match odds: pot-vs-pot rates, with the win/loss split tilted by the form difference.
function matchOdds(m, potOf, odds, form, formWeight = FORM_WEIGHT) {
  const o = odds(potOf[m.homeTeam.id], potOf[m.awayTeam.id]);
  const shift = formWeight * ((form.get(m.homeTeam.id) || 0) - (form.get(m.awayTeam.id) || 0));
  const r = sigmoid(logit(o.h / (o.h + o.a)) + shift);
  return { h: (1 - o.d) * r, d: o.d, a: (1 - o.d) * (1 - r) };
}

// Small seeded RNG so the same data always gives the same simulation.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function simulateSeason(table, league, potOf, odds, { runs = SIM_RUNS, seed = 1, formWeight = FORM_WEIGHT } = {}) {
  const finished = league.filter((m) => m.status === "FINISHED");
  const remaining = league.filter((m) => m.status !== "FINISHED" && m.homeTeam?.id && m.awayTeam?.id);
  const form = teamForm(table, finished, potOf, odds);
  const ids = table.map((r) => r.team.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const basePts = table.map((r) => r.points), baseGd = table.map((r) => r.goalDifference);
  const games = remaining.map((m) => ({ m, hi: idx.get(m.homeTeam.id), ai: idx.get(m.awayTeam.id), o: matchOdds(m, potOf, odds, form, formWeight) }));
  const n = ids.length;
  const posCounts = ids.map(() => new Array(n).fill(0));
  const ptsSum = new Array(n).fill(0);
  const rand = rng(seed);
  const pts = new Array(n), order = ids.map((_, i) => i), tie = new Array(n);
  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++) { pts[i] = basePts[i]; tie[i] = rand(); }
    for (const g of games) {
      const u = rand();
      if (u < g.o.h) pts[g.hi] += 3;
      else if (u < g.o.h + g.o.d) { pts[g.hi] += 1; pts[g.ai] += 1; }
      else pts[g.ai] += 3;
    }
    // Points first; current goal difference and then chance break ties.
    order.sort((x, y) => pts[y] - pts[x] || baseGd[y] - baseGd[x] || tie[y] - tie[x]);
    for (let p = 0; p < n; p++) { posCounts[order[p]][p]++; ptsSum[order[p]] += pts[order[p]]; }
  }
  const teams = table.map((r, i) => {
    const pc = posCounts[i].map((c) => c / runs);
    const sum = (a, b) => pc.slice(a, b).reduce((s, v) => s + v, 0);
    return {
      team: r.team, points: r.points, expPts: ptsSum[i] / runs,
      avgPos: pc.reduce((s, v, p) => s + v * (p + 1), 0),
      top8: sum(0, 8), top24: sum(0, 24), out: sum(24, n), dist: pc,
    };
  });
  return { teams, games, remaining: remaining.length };
}

// The single most likely result of every remaining match, and the table it leads to.
function mostLikelyTable(table, games) {
  const pts = new Map(table.map((r) => [r.team.id, r.points]));
  const picks = games.map((g) => {
    const best = g.o.h >= g.o.a && g.o.h >= g.o.d ? "h" : g.o.a >= g.o.d ? "a" : "d";
    const h = g.m.homeTeam.id, a = g.m.awayTeam.id;
    if (best === "h") pts.set(h, pts.get(h) + 3);
    else if (best === "a") pts.set(a, pts.get(a) + 3);
    else { pts.set(h, pts.get(h) + 1); pts.set(a, pts.get(a) + 1); }
    return { ...g, pick: best };
  });
  const final = table.map((r) => ({ team: r.team, now: r.points, points: pts.get(r.team.id), gd: r.goalDifference }))
    .sort((x, y) => y.points - x.points || y.gd - x.gd);
  return { picks, final };
}

let simLoaded = false;

function simSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function distStrip(dist) {
  const max = Math.max(...dist, 0.0001);
  const best = dist.indexOf(Math.max(...dist));
  return `<div class="dist" title="Most likely position: ${best + 1} (${pctText(dist[best])})">${dist.map((p, i) =>
    `<span class="${posZone(i + 1)}" style="opacity:${p > 0 ? 0.12 + 0.88 * (p / max) : 0.04}"></span>`).join("")}</div>`;
}

function simChancesHtml(sim) {
  const rows = sim.teams.slice().sort((a, b) => a.avgPos - b.avgPos);
  const pctCell = (p) => `<td class="sim-pct">${p >= 0.995 ? "100%" : p > 0 && p < 0.005 ? "<1%" : pctText(p)}</td>`;
  return `<div class="table-scroll"><table class="mini sim-table">
    <thead><tr><th>#</th><th class="team">Team</th><th>Pts now</th><th>Exp. pts</th><th>Top 8</th><th>Top 24</th><th>Out</th><th class="dist-head">Final position · 1 → 36</th></tr></thead>
    <tbody>${rows.map((t, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td class="team"><div class="team-cell">${crest(t.team.crest)}<span>${esc(t.team.shortName || t.team.name)}</span></div></td>
      <td>${t.points}</td>
      <td><b>${t.expPts.toFixed(1)}</b></td>
      ${pctCell(t.top8)}${pctCell(t.top24)}${pctCell(t.out)}
      <td>${distStrip(t.dist)}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function simPicksHtml(picks, md) {
  const list = picks.filter((g) => g.m.matchday === md).sort((a, b) => a.m.utcDate.localeCompare(b.m.utcDate));
  const name = (t) => esc(t.shortName || t.name);
  return list.map((g) => {
    const seg = (cls, v, key) => `<span class="seg ${cls}${g.pick === key ? " picked" : ""}" style="flex:${Math.max(v * 100, 1)}">${v >= 0.12 ? pctText(v) : ""}</span>`;
    const pickText = g.pick === "h" ? `${name(g.m.homeTeam)} win` : g.pick === "a" ? `${name(g.m.awayTeam)} win` : "Draw";
    return `<div class="pick-row">
      <div class="pick-teams">
        <span class="side home ${g.pick === "h" ? "fav" : ""}">${name(g.m.homeTeam)}${crest(g.m.homeTeam.crest)}</span>
        <span class="vs">–</span>
        <span class="side away ${g.pick === "a" ? "fav" : ""}">${crest(g.m.awayTeam.crest)}${name(g.m.awayTeam)}</span>
      </div>
      <div class="pvp-bar">${seg("home-win", g.o.h, "h")}${seg("draw", g.o.d, "d")}${seg("away-win", g.o.a, "a")}</div>
      <div class="pick-label">Most likely: <b>${pickText}</b> · ${shortDate(g.m.utcDate)}</div>
    </div>`;
  }).join("");
}

function simFinalHtml(final) {
  return `<table class="mini sim-final">
    <thead><tr><th>#</th><th class="team">Team</th><th>Now</th><th>Final</th></tr></thead>
    <tbody>${final.map((t, i) => `<tr class="${zone(i + 1)}${i === 7 || i === 23 ? " cut" : ""}">
      <td class="pos">${i + 1}</td>
      <td class="team"><div class="team-cell">${crest(t.team.crest)}<span>${esc(t.team.shortName || t.team.name)}</span></div></td>
      <td>${t.now}</td><td><b>${t.points}</b></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

async function loadSim() {
  if (simLoaded) return;
  simLoaded = true;
  const box = $("#sim");
  try {
    const current = seasonIndex.find((x) => x.current);
    if (!current) throw new Error("No current season.");
    const result = await seasonSimulation(current.id);
    if (result?.finished) {
      box.innerHTML = `<div class="card empty">The league phase of ${esc(current.label)} is finished, so there is nothing left to simulate.</div>`;
      return;
    }
    if (!result?.sim) throw new Error("Simulation needs the current season's draw pots and a finished past season.");
    const { sim, picks, final } = result;
    const mds = [...new Set(picks.map((g) => g.m.matchday))].sort((a, b) => a - b);

    box.innerHTML = `
      <div class="card stat-card wide">
        <h2>Simulated chances · ${esc(current.label)}</h2>
        <p class="hint">The ${sim.remaining} remaining league-phase matches played ${SIM_RUNS.toLocaleString()} times, starting from the current table.
          Updated after every matchday. The strip shows how often each team ended in each position (brighter = more often).</p>
        ${simChancesHtml(sim)}
      </div>
      <div class="card stat-card">
        <h2>Most likely results</h2>
        <p class="hint">Chance of a home win, draw or away win for every remaining match.</p>
        ${mds.length ? `<div class="seg-buttons" role="group" aria-label="Matchday">${mds.map((md, i) =>
          `<button type="button" data-simmd="${md}" class="${i === 0 ? "active" : ""}">MD ${md}</button>`).join("")}</div>` : ""}
        <div id="sim-picks">${mds.length ? simPicksHtml(picks, mds[0]) : `<p class="empty-note">No matches left.</p>`}</div>
      </div>
      <div class="card stat-card">
        <h2>Final table if every match goes the most likely way</h2>
        <p class="hint">One possible outcome: each remaining match ends in its most likely result. Draws are rarely the single most
          likely result, so this table has fewer draws than reality; the chances above are the better guide.</p>
        ${simFinalHtml(final)}
      </div>`;

    box.querySelectorAll("[data-simmd]").forEach((btn) => btn.addEventListener("click", () => {
      box.querySelectorAll("[data-simmd]").forEach((b) => b.classList.toggle("active", b === btn));
      $("#sim-picks").innerHTML = simPicksHtml(picks, Number(btn.dataset.simmd));
    }));
  } catch (err) {
    console.error(err);
    simLoaded = false;
    box.innerHTML = `<div class="card empty">The simulation is not available right now.</div>`;
  }
}

/* ---------- Club ---------- */

let clubData = null; // { seasons: [{ meta, standings, matches }], clubs: Map(id -> team) }

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const ZONE_TEXT = { z1: "Round of 16 places", z2: "Play-off places", z3: "Elimination places" };

async function loadClubData() {
  if (clubData) return clubData;
  const seasons = [];
  const countryOf = new Map();
  for (const meta of seasonIndex) {
    const [standings, matches, teams] = await fetchSeason(meta.id);
    seasons.push({ meta, table: standings.table || [], matches: matches.matches || [] });
    for (const t of teams.teams || []) if (t.country && !countryOf.has(t.id)) countryOf.set(t.id, t.country);
  }
  const clubs = new Map();
  for (const s of seasons) for (const r of s.table) if (!clubs.has(r.team.id)) clubs.set(r.team.id, r.team);
  // Finals of the three European cups. Europa Cup I also gets finals from our own data
  // for seasons after the list.
  const competitions = (await loadJson("finals.json").catch(() => ({ competitions: [] }))).competitions || [];
  const ec1 = competitions.find((c) => c.key === "ec1");
  const finals = ec1 ? ec1.finals : [];
  const listed = new Set(finals.map((f) => f.season));
  for (const s of seasons) {
    const final = s.matches.find((m) => m.stage === "FINAL" && m.status === "FINISHED");
    if (!final || listed.has(s.meta.label)) continue;
    const homeWon = final.score.winner === "HOME_TEAM";
    const [w, r] = homeWon ? [final.homeTeam, final.awayTeam] : [final.awayTeam, final.homeTeam];
    finals.push({ season: s.meta.label, winner: { name: w.shortName, id: w.id }, runnerUp: { name: r.shortName, id: r.id } });
  }
  clubData = { seasons, clubs, countryOf, competitions };
  return clubData;
}

// "2024" for season "2023/24": finals are usually referred to by the year they were played.
const finalYear = (season) => String(Number(season.slice(0, 4)) + 1);

// Club name for comparing across sources (finals list vs UEFA's names, e.g. "Man Utd").
const CLUB_ALIASES = { "man utd": "manchester united", "man city": "manchester city", "nott m forest": "nottingham forest",
  "paris": "paris saint germain", "psg": "paris saint germain", "atleti": "atletico madrid", "spurs": "tottenham hotspur",
  "tottenham": "tottenham hotspur", "bayern": "bayern munich", "inter": "inter milan", "crvena zvezda": "red star belgrade",
  "leverkusen": "bayer leverkusen", "stuttgart": "vfb stuttgart", "frankfurt": "eintracht frankfurt", "salzburg": "austria salzburg" }; // finals list uses the 1994 name
function clubKey(name) {
  let s = (name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const strip = (x) => x.replace(/\b(fc|cf|ac|afc|sc|sk|fk|club|de|the|ssc|as|ss|kv|1)\b/g, " ").replace(/\s+/g, " ").trim();
  // Aliases are checked on the full and the stripped name ("FK Crvena Zvezda" -> "crvena zvezda").
  return strip(CLUB_ALIASES[s] || CLUB_ALIASES[strip(s)] || s);
}
// Finals are stored with football-data ids; clubs from UEFA's data are matched by name.
function sameClub(entry, team) {
  if (entry.id === team.id) return true;
  if (team.id < 1000000) return false;
  const a = clubKey(entry.name), b = clubKey(team.name);
  // Equal, or one is the start of the other ("ajax" ~ "ajax amsterdam"); never in the middle ("milan" vs "inter milan").
  return a === b || (a.startsWith(`${b} `) && b.length >= 4) || (b.startsWith(`${a} `) && a.length >= 4);
}

// European titles, one line per cup.
function honoursHtml(teams, competitions) {
  const years = (list, key) => list.map((f) => {
    const other = key === "winner" ? f.runnerUp.name : f.winner.name;
    return `<span class="final-year" title="${esc(f.season)} final: ${key === "winner" ? "beat" : "lost to"} ${esc(other)}">${finalYear(f.season)}</span>`;
  }).join("");
  const group = (cls, heading, key) => {
    const lines = competitions.map((c) => {
      const list = c.finals.filter((f) => teams.some((t) => sameClub(f[key], t)));
      return list.length ? `<div class="honour ${cls}">
          <div class="honour-head"><b>${list.length}×</b><span>${esc(c.title)}</span></div>
          <div class="final-years">${years(list, key)}</div>
        </div>` : "";
    }).join("");
    return lines ? `<h3 class="sub-head">${heading}</h3>${lines}` : "";
  };
  const html = group("won", "Winner", "winner");
  return html || `<p class="empty-note">No European title yet.</p>`;
}

function stageLabel(m) {
  return m.stage === "LEAGUE_STAGE" ? `Matchday ${m.matchday}` : STAGE_LABELS[m.stage] || m.stage;
}

function recordTableHtml(rec) {
  const line = (label, r, cls = "") => `<tr class="${cls}">
      <td class="season-cell">${label}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
      <td class="goals goals-start">${r.gf}</td><td class="goals">${r.ga}</td><td class="goals">${signed(r.gf - r.ga)}</td>
    </tr>`;
  const group = (title) => `<tr class="group"><td colspan="8">${title}</td></tr>`;
  const ko = rec.ko.total.p
    ? group("Knockout phase") + line("Home", rec.ko.home) + line("Away", rec.ko.away) +
      (rec.ko.final.p ? line("Final", rec.ko.final) : "") + line("Total", rec.ko.total, "subtotal")
    : group("Knockout phase") + `<tr><td colspan="8" class="muted">No knockout matches yet.</td></tr>`;
  return `<table class="mini club-record">
    <thead><tr><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th class="goals-start">GF</th><th>GA</th><th>GD</th></tr></thead>
    <tbody>
      ${group("League phase")}${line("Home", rec.league.home)}${line("Away", rec.league.away)}${line("Total", rec.league.total, "subtotal")}
      ${ko}
      ${line("All matches", rec.total, "total")}
    </tbody>
  </table>`;
}

function fixtureLine(m, id, posOf, big, compKey) {
  const home = m.homeTeam.id === id;
  const opp = home ? m.awayTeam : m.homeTeam;
  const when = new Date(m.utcDate);
  const date = `${WEEKDAYS[when.getDay()]} ${shortDate(m.utcDate)}`;
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const extra = posOf.get(opp.id) ? `${ordinal(posOf.get(opp.id))} now` : "";
  const attrs = `data-match="${m.id}" data-comp="${compKey}" role="button" tabindex="0" aria-label="Match details"`;
  if (big) {
    return `<div class="next-match clickable" ${attrs}>
      <div class="next-opp">${crest(opp.crest)}<div><div class="next-name">${home ? "vs" : "at"} ${esc(opp.name)}</div>
        <div class="next-meta">${home ? "Home" : "Away"} · ${esc(stageLabel(m))}${extra ? ` · ${esc(extra)}` : ""}</div></div></div>
      <div class="next-when"><b>${esc(date)}</b><span>${time}</span></div>
    </div>`;
  }
  return `<div class="fixture-row clickable" ${attrs}>
    <span class="fx-when">${esc(date)}</span>
    <span class="fx-ha ${home ? "h" : "a"}">${home ? "H" : "A"}</span>
    <span class="fx-opp">${crest(opp.crest)}${esc(opp.shortName || opp.name)}</span>
    <span class="fx-extra">${esc(extra)}</span>
  </div>`;
}

/* ---------- Club page: independent of the competition switch ---------- */

// Clubs across all three competitions. Within a competition a club is its team id; across
// competitions (football-data vs UEFA ids) the same club is recognised by name.
let europe = null; // { seasons: [{ comp, meta, table, matches }], clubs: [identity], byId: Map(id -> identity), competitions }

const sameTeamName = (a, b) => [a.name, a.shortName].some((n) => [b.name, b.shortName].some((m) => {
  const x = clubKey(n), y = clubKey(m);
  return x && y && (x === y || (x.startsWith(`${y} `) && y.length >= 4) || (y.startsWith(`${x} `) && x.length >= 4));
}));

async function loadEurope() {
  if (europe) return europe;
  const seasons = [];
  for (const comp of Object.values(COMPS)) {
    const index = await loadJson(`${comp.base}/seasons.json`).catch(() => null);
    for (const meta of index?.seasons || []) {
      try {
        const [standings, matches] = await fetchSeason(meta.id, comp);
        seasons.push({ comp, meta, table: standings.table || [], matches: matches.matches || [] });
      } catch { /* season not available */ }
    }
  }
  const clubs = [], byId = new Map();
  for (const s of seasons) {
    for (const r of s.table) {
      if (byId.has(r.team.id)) continue;
      // Same club in another competition? (never merge two teams of the same competition by name)
      let club = clubs.find((c) => !c.comps.has(s.comp.key) && sameTeamName(c.team, r.team));
      if (!club) { club = { ids: new Set(), comps: new Set(), team: r.team }; clubs.push(club); }
      club.ids.add(r.team.id);
      club.comps.add(s.comp.key);
      byId.set(r.team.id, club);
    }
  }
  const { competitions } = await loadClubData();
  europe = { seasons, clubs, byId, competitions };
  return europe;
}

function compSticker(c) {
  return `<span class="comp-sticker ${c.key}" title="${esc(c.name)}"><span class="long">${esc(c.name)}</span><span class="short">${c.key.toUpperCase()}</span></span>`;
}

// Record split into league phase (home/away) and knockout phase (home/away/final at a neutral venue).
function clubRecord(ids, seasons) {
  const blank = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const rec = { league: { home: blank(), away: blank() }, ko: { home: blank(), away: blank(), final: blank() } };
  for (const s of seasons) {
    for (const m of s.matches) {
      if (m.status !== "FINISHED") continue;
      const home = ids.has(m.homeTeam?.id);
      if (!home && !ids.has(m.awayTeam?.id)) continue;
      const { home: h, away: a } = m.score.fullTime;
      const gf = home ? h : a, ga = home ? a : h;
      const phase = m.stage === "LEAGUE_STAGE" ? rec.league : rec.ko;
      const r = m.stage === "FINAL" ? phase.final : home ? phase.home : phase.away;
      r.p++; r.gf += gf; r.ga += ga;
      if (gf > ga) r.w++; else if (gf < ga) r.l++; else r.d++;
    }
  }
  const sum = (...parts) => parts.reduce((t, r) => { for (const f of Object.keys(t)) t[f] += r[f]; return t; }, blank());
  rec.league.total = sum(rec.league.home, rec.league.away);
  rec.ko.total = sum(rec.ko.home, rec.ko.away, rec.ko.final);
  rec.total = sum(rec.league.total, rec.ko.total);
  return rec;
}

function renderClub(anyId) {
  const club = europe?.byId.get(anyId); // data may still be loading; loadClub renders when it's ready
  if (!club) return;
  const currentSeasons = europe.seasons.filter((s) => s.meta.current);
  const now = currentSeasons.map((s) => ({ s, i: s.table.findIndex((r) => club.ids.has(r.team.id)) })).find((x) => x.i !== -1);
  const seasonLabel = currentSeasons[0]?.meta.label || "";
  const team = now ? now.s.table[now.i].team : club.team;
  const id = team.id;

  // This season, in whichever competition the club plays
  let nowHtml, resultsHtml, nextHtml;
  if (now) {
    const { s, i } = now;
    const row = s.table[i], pos = i + 1, z = posZone(pos);
    const leagueDone = s.table.every((r) => r.playedGames >= s.comp.games);
    const result = finalResults(s.matches);
    const status = clinchStatus(s.table, s.comp.games)?.get(id);
    nowHtml = `<div class="club-now">
        <div class="club-pos"><span class="pchip ${z}">${pos}</span><div><b>${ordinal(pos)} of ${s.table.length}</b>
          <span>${leagueDone ? "Final league-phase position" : ZONE_TEXT[z]}${status && STATUS[status] ? ` · ${STATUS[status].title}` : ""}</span></div></div>
        <div class="club-stats">
          <div><b>${row.points}</b><span>Points</span></div>
          <div><b>${row.playedGames}</b><span>Played</span></div>
          <div><b>${row.won}-${row.draw}-${row.lost}</b><span>W-D-L</span></div>
          <div><b>${signed(row.goalDifference)}</b><span>Goal diff.</span></div>
        </div>
        ${result ? `<div class="club-result">Result: <span class="result ${RESULT[result.get(id) || "LEAGUE"].cls}">${RESULT[result.get(id) || "LEAGUE"].label}</span></div>` : ""}
      </div>`;
    const posOf = new Map(s.table.map((r, k) => [r.team.id, k + 1]));
    const mine = s.matches.filter((m) => m.homeTeam?.id === id || m.awayTeam?.id === id);
    const upcoming = mine.filter((m) => m.status !== "FINISHED" && m.homeTeam?.id && m.awayTeam?.id).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    nextHtml = upcoming.length
      ? fixtureLine(upcoming[0], id, posOf, true, s.comp.key) +
        (upcoming.length > 1 ? `<h3 class="sub-head">After that</h3>${upcoming.slice(1).map((m) => fixtureLine(m, id, posOf, false, s.comp.key)).join("")}` : "")
      : `<p class="empty-note">No upcoming matches scheduled.</p>`;
    const played = mine.filter((m) => m.status === "FINISHED").sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    resultsHtml = played.length
      ? played.map((m) => {
          const home = m.homeTeam.id === id;
          const opp = home ? m.awayTeam : m.homeTeam;
          const { home: h, away: a } = m.score.fullTime;
          const my = home ? h : a, their = home ? a : h;
          const outcome = my > their ? "win" : my < their ? "loss" : "draw";
          const pens = m.score.pens ? ` <small class="muted">pens ${m.score.pens.home}–${m.score.pens.away}</small>` : "";
          return `<div class="fixture-row result-row clickable" data-match="${m.id}" data-comp="${s.comp.key}" role="button" tabindex="0" aria-label="Match details">
            <span class="fx-when">${esc(shortDate(m.utcDate))}</span>
            <span class="fx-ha ${home ? "h" : "a"}">${home ? "H" : "A"}</span>
            <span class="fx-opp">${crest(opp.crest)}${esc(opp.shortName || opp.name)}</span>
            <span class="fx-score"><span class="res ${outcome}">${h}–${a}</span>${pens}</span>
            <span class="fx-extra">${esc(stageLabel(m))}</span>
          </div>`;
        }).join("")
      : `<p class="empty-note">No matches played yet.</p>`;
  } else {
    nowHtml = `<p class="empty-note">${esc(team.shortName || team.name)} is not in a European league phase in ${esc(seasonLabel)}.</p>`;
    resultsHtml = nextHtml = `<p class="empty-note">Not taking part this season.</p>`;
  }

  // Recent seasons, oldest first: the competition the club played in, and how it went
  const pastIds = [...new Set(europe.seasons.filter((s) => !s.meta.current).map((s) => s.meta.id))].sort();
  const pastHtml = pastIds.map((sid) => {
    const found = europe.seasons.filter((s) => s.meta.id === sid)
      .map((s) => ({ s, i: s.table.findIndex((r) => club.ids.has(r.team.id)) })).find((x) => x.i !== -1);
    const label = europe.seasons.find((s) => s.meta.id === sid).meta.label;
    if (!found) return `<div class="past-row"><span class="past-season">${esc(label)}</span><span class="comp-sticker none">–</span><span class="muted">No European league phase</span></div>`;
    const { s, i } = found;
    const res = finalResults(s.matches);
    const key = res ? res.get(s.table[i].team.id) || "LEAGUE" : null;
    return `<div class="past-row">
      <span class="past-season">${esc(label)}</span>
      ${compSticker(s.comp)}
      <span class="pchip ${posZone(i + 1)}">${i + 1}</span>
      <span class="past-pts">${s.table[i].points} pts</span>
      ${key ? `<span class="result ${RESULT[key].cls}">${RESULT[key].label}</span>` : ""}
    </div>`;
  }).join("");

  // Titles: match the finals list against every name the club has in our data
  const members = europe.seasons.flatMap((s) => s.table.map((r) => r.team)).filter((t) => club.ids.has(t.id));
  const honours = honoursHtml(members, europe.competitions);

  const rec = clubRecord(club.ids, europe.seasons);
  const first = pastIds.length ? europe.seasons.find((s) => s.meta.id === pastIds[0]).meta.label : seasonLabel;

  $("#club-body").innerHTML = `
    <div class="card stat-card wide club-head">
      ${team.crest ? `<img class="club-crest" src="${esc(team.crest)}" alt="">` : ""}
      <div class="club-title"><h2>${esc(team.name)}</h2>
        <p class="hint">${now ? `${compSticker(now.s.comp)} ` : ""}${esc(seasonLabel)} · League phase</p></div>
      ${nowHtml}
    </div>
    <div class="card stat-card">
      <h2>Matches this season</h2>
      <h3 class="sub-head first">Results</h3>
      ${resultsHtml}
      <h3 class="sub-head">Next match</h3>
      ${nextHtml}
    </div>
    <div class="card stat-card">
      <h2>Previous seasons</h2>
      ${honours}
      <h3 class="sub-head">Recent seasons</h3>
      <p class="hint">League-phase position and how far the club got.</p>
      ${pastHtml || `<p class="empty-note">No earlier seasons in this format.</p>`}
    </div>
    <div class="card stat-card wide">
      <h2>European record in this format</h2>
      <p class="hint">All Champions League, Europa League and Conference League matches since ${esc(first)}, when the
        36-team league phase started. The final is played at a neutral venue. Penalty shoot-outs count as draws.</p>
      ${rec.total.p ? recordTableHtml(rec) : `<p class="empty-note">No matches played yet.</p>`}
    </div>`;
}

// One remembered club for the whole site (the Club page doesn't depend on the competition switch).
const CLUB_KEY = "club";

function chooseClub(id) {
  try { localStorage.setItem(CLUB_KEY, String(id)); } catch {}
  const params = new URLSearchParams(location.search);
  params.set("club", id);
  history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`);
  $("#club-select").value = String(id);
  renderClub(id);
}

let clubLoaded = false;
async function loadClub() {
  if (clubLoaded) return;
  clubLoaded = true;
  try {
    await loadEurope();
    // Dropdown: every club in a league phase this season, grouped by competition, alphabetical.
    const byName = (a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name);
    const groups = europe.seasons.filter((s) => s.meta.current).map((s) =>
      `<optgroup label="${esc(s.comp.name)}">${s.table.map((r) => r.team).sort(byName)
        .map((t) => `<option value="${t.id}">${esc(t.shortName || t.name)}</option>`).join("")}</optgroup>`);
    const select = $("#club-select");
    select.innerHTML = groups.join("");

    // Requested club (link, or saved choice) -> the option that represents that club this season
    let saved = null;
    try { saved = localStorage.getItem(CLUB_KEY) ?? localStorage.getItem(`club-${COMP.key}`); } catch {}
    const wanted = europe.byId.get(Number(new URLSearchParams(location.search).get("club") || saved));
    const options = [...select.options].map((o) => Number(o.value));
    const id = (wanted && options.find((o) => wanted.ids.has(o))) || options[0];
    select.value = String(id);
    select.onchange = () => chooseClub(Number(select.value));
    renderClub(wanted && !options.some((o) => wanted.ids.has(o)) ? [...wanted.ids][0] : id);
  } catch (err) {
    console.error(err);
    clubLoaded = false;
    $("#club-body").innerHTML = `<div class="card empty">Club pages are not available right now.</div>`;
  }
}

/* ---------- Match detail ---------- */

const longDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const tname = (t) => esc(t.shortName || t.name);

// A team's finished matches in this competition before `before`, newest first.
function teamHistory(id, seasons, before) {
  const out = [];
  for (const s of seasons) {
    const posOf = new Map(s.table.map((r, i) => [r.team.id, i + 1]));
    for (const m of s.matches) {
      if (m.status !== "FINISHED" || m.utcDate >= before) continue;
      const home = m.homeTeam?.id === id;
      if (!home && m.awayTeam?.id !== id) continue;
      const { home: h, away: a } = m.score.fullTime;
      const gf = home ? h : a, ga = home ? a : h;
      const opp = home ? m.awayTeam : m.homeTeam;
      out.push({ m, home, gf, ga, opp, season: s.meta.label, res: gf > ga ? "W" : gf < ga ? "L" : "D", oppTop8: (posOf.get(opp.id) || 99) <= 8, final: m.stage === "FINAL" });
    }
  }
  return out.sort((x, y) => y.m.utcDate.localeCompare(x.m.utcDate));
}

function recordOf(list) {
  const r = { p: list.length, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (const g of list) { r.gf += g.gf; r.ga += g.ga; r[g.res === "W" ? "w" : g.res === "D" ? "d" : "l"]++; }
  r.ppg = r.p ? (r.w * 3 + r.d) / r.p : null;
  return r;
}

const streak = (list, test) => { let n = 0; for (const g of list) { if (!test(g)) break; n++; } return n; };

const RESULT_WORD = { W: "won", D: "drew", L: "lost" };

// "won 3 and drew 1" — only the parts that occurred, in W/D/L order.
function wdlText(r) {
  const parts = [["won", r.w], ["drew", r.d], ["lost", r.l]].filter(([, n]) => n).map(([v, n]) => `${v} ${n}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}

// Current run of identical results, and when the team last had a longer one.
function streakHistoryFact(name, hist) {
  if (!hist.length) return null;
  const type = hist[0].res;
  const n = streak(hist, (g) => g.res === type);
  if (n < (type === "D" ? 2 : 3)) return null;
  // Older runs (newest first); find the most recent one of at least n + 1.
  let i = n, found = null;
  while (i < hist.length) {
    if (hist[i].res !== type) { i++; continue; }
    let j = i;
    while (j < hist.length && hist[j].res === type) j++;
    if (j - i >= n + 1) { found = hist[j - 1 - n]; break; } // the match that made it n + 1
    i = j;
  }
  const verb = RESULT_WORD[type];
  const kind = { W: "winning", D: "drawing", L: "losing" }[type];
  const now = `${name} have ${verb} their last ${n} matches.`;
  return {
    type,
    fact: found
      ? { topic: "run", score: n + 1.5, text: `${now} The last time they ${verb} ${n + 1} in a row was ${longDate(found.m.utcDate)}.` }
      : { topic: "run", score: n + 2.5, text: `${now} This is their longest ${kind} run in this format.` },
  };
}

// "lost all 5 games …" / "drew 1 and lost 3 of their 4 games …" (with last: "… of their last 4 …")
function ofText(r, n, what, last = false) {
  const single = [r.w, r.d, r.l].filter(Boolean).length === 1;
  const verb = r.w ? "won" : r.d ? "drew" : "lost";
  if (single) return last ? `${verb} their last ${n} ${what}` : `${verb} all ${n} ${what}`;
  return `${wdlText(r)} of their ${last ? "last " : ""}${n} ${what}`;
}
const ofShort = (r, n) => ([r.w, r.d, r.l].filter(Boolean).length === 1 ? `${r.w ? "won" : r.d ? "drew" : "lost"} all ${n}` : `${wdlText(r)} of ${n}`);

// Record against a group of opponents (top-8 teams, or clubs from one country).
function groupFact(name, games, label, topic) {
  if (games.length < 3) return null;
  const r = recordOf(games);
  if (r.l === 0) return { topic, trend: "up", score: games.length + 1, text: `${name} are unbeaten against ${label} in this format (${ofShort(r, games.length)}).` };
  if (r.w === 0) return { topic, trend: "down", score: games.length + 1, text: `${name} ${ofText(r, games.length, `games against ${label}`)} in this format.` };
  const lastLoss = games.find((g) => g.res === "L"), sinceLoss = games.indexOf(lastLoss);
  if (sinceLoss >= 3) return { topic, trend: "up", score: sinceLoss + 1, text: `${name} are unbeaten in their last ${sinceLoss} games against ${label} (last defeat: ${longDate(lastLoss.m.utcDate)}).` };
  const lastWin = games.find((g) => g.res === "W"), sinceWin = games.indexOf(lastWin);
  if (sinceWin >= 3) return { topic, trend: "down", score: sinceWin, text: `${name} ${ofText(recordOf(games.slice(0, sinceWin)), sinceWin, `games against ${label}`, true)} (last win: ${longDate(lastWin.m.utcDate)}).` };
  return null;
}

// Interesting facts about one team going into the match: at most one per topic,
// phrased positively ("lost their last 3", not "haven't won"), most notable first.
function teamFacts(team, hist, venue, oppCountry, countryOf, oppTop8) {
  const name = tname(team);
  if (!hist.length) return []; // debut: added separately at the top of the talking points
  const facts = [];
  const add = (topic, score, text) => facts.push({ topic, score, text });
  const where = venue === "home" ? "home" : "away";
  const atVenue = hist.filter((g) => !g.final && g.home === (venue === "home"));

  // Overall run (all matches)
  const run = streakHistoryFact(name, hist);
  if (run) facts.push(run.fact);

  // Results at this venue. A current streak is preferred over "whole format" records, and
  // skipped when the overall run already says it (lost 7 in a row implies the home games).
  const w = streak(atVenue, (g) => g.res === "W"), lost = streak(atVenue, (g) => g.res === "L");
  const unb = streak(atVenue, (g) => g.res !== "L"), winless = streak(atVenue, (g) => g.res !== "W");
  const impliedByRun = (type) => run && run.type === type;
  if (w >= 3 && !impliedByRun("W")) add("venue", w + 3, `${name} won their last ${w} ${where} games.`);
  else if (lost >= 2 && !impliedByRun("L")) add("venue", lost + 3, `${name} lost their last ${lost} ${where} games.`);
  else if (unb >= 4 && !run) add("venue", unb + 1, `${name} ${ofText(recordOf(atVenue.slice(0, unb)), unb, `${where} games`, true)}.`);
  else if (winless >= 3 && !run) add("venue", winless + 1, `${name} ${ofText(recordOf(atVenue.slice(0, winless)), winless, `${where} games`, true)}.`);
  else if (!run) {
    const rec = recordOf(atVenue);
    if (rec.p >= 4 && (rec.l === 0 || rec.w === 0)) add("venue", 4, `${name} ${ofText(rec, rec.p, `${where} games`)} in this format.`);
  }

  // Against top-8 teams and against clubs from the opponent's country
  // Only relevant when this match is against a top-8 team.
  const top8 = oppTop8 ? groupFact(name, hist.filter((g) => g.oppTop8), "top-8 teams", "top8") : null;
  if (top8) facts.push(top8);
  if (oppCountry && countryOf) {
    const c = groupFact(name, hist.filter((g) => countryOf.get(g.opp.id) === oppCountry), `teams from ${oppCountry}`, "country");
    if (c) facts.push(c);
  }

  // No draws at all in this format (penalty shoot-outs count as draws)
  // At least one full league phase (8 games, 6 in the Conference League) without a single draw.
  if (hist.length >= COMP.games && hist.every((g) => g.res !== "D")) {
    add("draws", hist.length / 4, `Every one of ${name}'s ${hist.length} matches in this format had a winner: no draws.`);
  }

  // Scoring and defence
  const scored = streak(hist, (g) => g.gf > 0), blank = streak(hist, (g) => g.gf === 0), clean = streak(hist, (g) => g.ga === 0);
  if (scored >= 6) add("goals", scored / 2, `${name} scored in each of their last ${scored} matches.`);
  else if (blank >= 2) add("goals", blank + 1, `${name} failed to score in their last ${blank} matches.`);
  if (clean >= 3) add("defence", clean + 1, `${name} kept a clean sheet in their last ${clean} matches.`);

  // A winless/unbeaten record against a group says the same as a current losing/winning run.
  const repeatsRun = (f) => run && f.trend && ((run.type === "L" && f.trend === "down") || (run.type === "W" && f.trend === "up"));
  const seen = new Set();
  return facts.filter((f) => !repeatsRun(f)).sort((a, b) => b.score - a.score)
    .filter((f) => !seen.has(f.topic) && seen.add(f.topic)).slice(0, 3);
}

// Last 5 results, oldest first, grouped by season ("25/26 | 26/27").
function formChips(hist) {
  const last = hist.slice(0, 5).reverse();
  if (!last.length) return `<span class="muted">No matches yet</span>`;
  const groups = [];
  for (const g of last) {
    if (!groups.length || groups[groups.length - 1].season !== g.season) groups.push({ season: g.season, games: [] });
    groups[groups.length - 1].games.push(g);
  }
  return groups.map((grp) => `<span class="form-group">
      <span class="form-chips">${grp.games.map((g) => {
        const cls = g.res === "W" ? "win" : g.res === "L" ? "loss" : "draw";
        return `<span class="res ${cls}" title="${g.home ? "vs" : "at"} ${esc(g.opp.shortName || g.opp.name)} ${g.m.score.fullTime.home}–${g.m.score.fullTime.away} · ${shortDate(g.m.utcDate)}">${g.res}</span>`;
      }).join("")}</span>
      <small>${esc(grp.season.slice(2))}</small>
    </span>`).join("");
}

function compareRows(a, b) {
  const rows = [
    ["Played", a.p, b.p, null],
    ["Won", a.w, b.w, "high"],
    ["Drawn", a.d, b.d, null],
    ["Lost", a.l, b.l, "low"],
    ["Goals scored", a.gf, b.gf, "high"],
    ["Goals conceded", a.ga, b.ga, "low"],
    ["Points per game", a.ppg, b.ppg, "high"],
  ];
  const fmt = (v, i) => (v === null ? "–" : i === 6 ? v.toFixed(2) : v);
  return rows.map(([label, x, y, better], i) => {
    // Compare per game so teams with more matches don't look better by default.
    const px = i === 6 ? x : a.p ? x / a.p : null, py = i === 6 ? y : b.p ? y / b.p : null;
    const winX = better && px !== null && py !== null && (better === "high" ? px > py : px < py);
    const winY = better && px !== null && py !== null && (better === "high" ? py > px : py < px);
    return `<div class="cmp-row"><span class="cmp-val ${winX ? "better" : ""}">${fmt(x, i)}</span><span class="cmp-label">${label}</span><span class="cmp-val ${winY ? "better" : ""}">${fmt(y, i)}</span></div>`;
  }).join("");
}

async function renderMatch(id) {
  const box = $("#match-detail");
  const { seasons, countryOf } = await loadClubData();
  let season = null, m = null;
  for (const s of seasons) { m = s.matches.find((x) => x.id === id); if (m) { season = s; break; } }
  if (!m || !m.homeTeam?.id || !m.awayTeam?.id) {
    box.innerHTML = `<div class="card empty">Match not found.</div>`;
    return;
  }
  const H = m.homeTeam, A = m.awayTeam;
  const posOf = new Map(season.table.map((r, i) => [r.team.id, i + 1]));
  const played = m.status === "FINISHED" || LIVE.has(m.status);
  const ft = m.score.fullTime;
  const when = new Date(m.utcDate);
  const centre = played
    ? `<div class="md-score${LIVE.has(m.status) ? " live" : ""}">${ft.home}–${ft.away}</div>${m.score.pens ? `<div class="md-sub">pens ${m.score.pens.home}–${m.score.pens.away}</div>` : ""}<div class="md-sub">${LIVE.has(m.status) ? "Live" : "Full time"}</div>`
    : `<div class="md-time">${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div><div class="md-sub">${WEEKDAYS[when.getDay()]} ${longDate(m.utcDate)}</div>`;
  const posText = (t) => posOf.get(t.id) ? `${ordinal(posOf.get(t.id))} in ${esc(season.meta.label)}` : "";

  // Everything below is "going into the match": only matches before kick-off count.
  const before = m.utcDate;
  const hHist = teamHistory(H.id, seasons, before), aHist = teamHistory(A.id, seasons, before);
  const meetings = hHist.filter((g) => g.opp.id === A.id);
  let hw = 0, dr = 0, aw = 0;
  for (const g of meetings) { if (g.res === "W") hw++; else if (g.res === "L") aw++; else dr++; }
  // Debuts: first match at all, or the home team's first home / away team's first away game.
  // Counts every earlier fixture (played or not), so a future match isn't called a debut
  // just because the games before it haven't been played yet.
  const earlier = (team) => seasons.flatMap((s) => s.matches).filter((x) => x.utcDate < m.utcDate && x.status !== "CANCELLED" &&
    (x.homeTeam?.id === team.id || x.awayTeam?.id === team.id));
  const debut = (team, venue) => {
    const prev = earlier(team);
    if (!prev.length) return `This is ${tname(team)}'s first ${COMP.name} match in this format.`;
    const atVenue = prev.filter((x) => x.stage !== "FINAL" && (x.homeTeam?.id === team.id) === (venue === "home"));
    return atVenue.length ? "" : `This is ${tname(team)}'s first ${COMP.name} ${venue} game in this format.`;
  };
  const debutFacts = [[H, debut(H, "home")], [A, debut(A, "away")]].filter(([, text]) => text).map(([team, text]) => ({ team, text }));
  const h2hHtml = meetings.length
    ? `<div class="h2h-wrap"><div class="h2h-summary">
        <div><b>${hw}</b><span>${tname(H)} wins</span></div>
        <div><b>${dr}</b><span>Draws</span></div>
        <div><b>${aw}</b><span>${tname(A)} wins</span></div>
      </div>
      <div class="h2h-list">${meetings.map((g) => `<div class="h2h-row">
        <span class="fx-when">${longDate(g.m.utcDate)}</span>
        <span class="h2h-teams">${tname(g.m.homeTeam)} <b>${g.m.score.fullTime.home}–${g.m.score.fullTime.away}</b> ${tname(g.m.awayTeam)}${g.m.score.pens ? ` <small class="muted">(pens ${g.m.score.pens.home}–${g.m.score.pens.away})</small>` : ""}</span>
        <span class="fx-extra">${esc(stageLabel(g.m))}</span>
      </div>`).join("")}</div></div>`
    : `<p class="empty-note">${tname(H)} and ${tname(A)} haven't met in the ${COMP.name} since ${esc(seasons[seasons.length - 1].meta.label)}. This is their first meeting in this format.</p>`;

  const hHome = hHist.filter((g) => g.home && !g.final), aAway = aHist.filter((g) => !g.home && !g.final);
  const thisSeason = (g) => g.m.utcDate >= (season.matches.map((x) => x.utcDate).sort()[0] || "");
  const isTop8 = (t) => (posOf.get(t.id) || 99) <= 8;
  const facts = [...teamFacts(H, hHist, "home", countryOf.get(A.id), countryOf, isTop8(A)).map((f) => ({ ...f, team: H })),
    ...teamFacts(A, aHist, "away", countryOf.get(H.id), countryOf, isTop8(H)).map((f) => ({ ...f, team: A }))]
    .sort((a, b) => b.score - a.score);
  facts.unshift(...debutFacts);

  box.innerHTML = `
    <div class="card stat-card wide md-head">
      <div class="md-round">${esc(stageLabel(m))} · ${esc(season.meta.label)}</div>
      <div class="md-teams">
        <div class="md-side">
          <a class="md-team" href="${clubHref(H.id)}" data-club="${H.id}" title="Open club page">${H.crest ? `<img src="${esc(H.crest)}" alt="">` : ""}<b>${tname(H)}</b><span>${posText(H)}</span></a>
          <div class="md-form" aria-label="Last 5 matches">${formChips(hHist)}</div>
        </div>
        <div class="md-centre">${centre}</div>
        <div class="md-side">
          <a class="md-team" href="${clubHref(A.id)}" data-club="${A.id}" title="Open club page">${A.crest ? `<img src="${esc(A.crest)}" alt="">` : ""}<b>${tname(A)}</b><span>${posText(A)}</span></a>
          <div class="md-form" aria-label="Last 5 matches">${formChips(aHist)}</div>
        </div>
      </div>
    </div>
    <div class="card stat-card wide">
      <h2>Talking points</h2>
      <p class="hint">${played ? "Going into this match" : "Going into the match"}, based on ${COMP.name} matches since ${esc(seasons[seasons.length - 1].meta.label)}.
        A top-8 team is one in the top 8 of that season's league table.</p>
      ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${crest(f.team.crest)}<span>${f.text}</span></li>`).join("")}</ul>`
        : `<p class="empty-note">Nothing remarkable yet.</p>`}
    </div>
    <div class="card stat-card wide h2h-card">
      <h2>Head to head</h2>
      ${h2hHtml}
    </div>
    <div class="card stat-card wide">
      <h2>${tname(H)} at home vs ${tname(A)} away</h2>
      <div class="cmp-wrap">
        <div class="seg-buttons" role="group" aria-label="Period">
          <button type="button" data-cmp="all" class="active">Since ${esc(seasons[seasons.length - 1].meta.label)}</button>
          <button type="button" data-cmp="season">This season</button>
        </div>
        <div class="cmp-head"><span>${crest(H.crest)}${tname(H)} home</span><span>${tname(A)} away${crest(A.crest)}</span></div>
        <div id="cmp-body">${compareRows(recordOf(hHome), recordOf(aAway))}</div>
      </div>
    </div>`;

  box.querySelectorAll("[data-cmp]").forEach((btn) => btn.addEventListener("click", () => {
    box.querySelectorAll("[data-cmp]").forEach((b) => b.classList.toggle("active", b === btn));
    const pick = (list) => (btn.dataset.cmp === "season" ? list.filter(thisSeason) : list);
    $("#cmp-body").innerHTML = compareRows(recordOf(pick(hHome)), recordOf(pick(aAway)));
  }));
}

function openMatch(id, push, from = "matches") {
  if (push) history.pushState({ fromList: true, from }, "", `${location.pathname}${location.search}#match-${id}`);
  const origin = history.state?.from || "matches";
  $("#match-back").textContent = origin === "club" ? "‹ Back to club" : "‹ Back to matches";
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === origin);
    t.setAttribute("aria-selected", t.dataset.view === origin);
  });
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-match"));
  document.body.dataset.view = "match";
  scrollTo(0, 0);
  $("#match-detail").innerHTML = `<div class="card empty">Loading…</div>`;
  renderMatch(id).catch((err) => {
    console.error(err);
    $("#match-detail").innerHTML = `<div class="card empty">Match details are not available right now.</div>`;
  });
}

function clubHref(id) {
  const params = new URLSearchParams(location.search);
  params.set("club", id);
  return `${location.pathname}?${params}#club`;
}

// Go to the Club tab with this club selected (back button returns to the match).
function openClub(id) {
  history.pushState({ fromMatch: true }, "", clubHref(id));
  showView("club");
  if (clubLoaded && europe) {
    $("#club-select").value = String(id);
    chooseClub(id);
  }
}

// Club links on the match page and in the table open the Club tab.
function onClubLink(e) {
  const a = e.target.closest("[data-club]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // let new-tab clicks through
  e.preventDefault();
  openClub(Number(a.dataset.club));
}
$("#match-detail").addEventListener("click", onClubLink);
$("#table-body").addEventListener("click", onClubLink);

$("#match-back").addEventListener("click", () => {
  if (history.state?.fromList) history.back();
  else showView("matches");
});

/* ---------- Statistics ---------- */

let seasonIndex = [];
let statsLoaded = false;

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const posZone = (pos) => (pos <= 8 ? "z1" : pos <= 24 ? "z2" : "z3");
const signed = (n) => (n > 0 ? `+${n}` : String(n));

function seasonStats(meta, standings, matches) {
  const league = matches.filter((m) => m.stage === "LEAGUE_STAGE");
  const finished = league.filter((m) => m.status === "FINISHED");
  const complete = league.length > 0 && finished.length === league.length;
  let home = 0, draw = 0, away = 0;
  for (const m of finished) {
    const { home: h, away: a } = m.score.fullTime;
    if (h > a) home++; else if (h < a) away++; else draw++;
  }
  const table = standings.table || [];
  // Final position = row order (the data can list tied teams with the same position).
  const posOf = new Map(table.map((r, i) => [r.team.id, { pos: i + 1, team: r.team }]));
  const pots = allPots[meta.id];
  const potPositions = pots
    ? POT_KEYS.map((k) => (pots[k] || []).map((id) => posOf.get(id)).filter(Boolean).sort((a, b) => a.pos - b.pos))
    : null;
  return {
    meta, complete, played: finished.length, home, draw, away,
    cutoff8: table[7], cutoff24: table[23], potPositions,
    potVsPot: pots ? potVsPot(finished, pots) : null,
    draws: drawDifficulty(table, league, pots),
    table, status: clinchStatus(table),
    knockout: complete ? knockoutProgress(table, matches) : null,
  };
}

const KO_STAGES = [
  ["PLAYOFFS", "Play-offs"],
  ["LAST_16", "Round of 16"],
  ["QUARTER_FINALS", "Quarter-finals"],
  ["SEMI_FINALS", "Semi-finals"],
  ["FINAL", "Final"],
];
const KO_GROUPS = [["1–8", 1, 8], ["9–16", 9, 16], ["17–24", 17, 24]];

// Which teams from each league-phase group reached each knockout stage (and won it all).
function knockoutProgress(table, matches) {
  const ko = matches.filter((m) => m.stage !== "LEAGUE_STAGE");
  if (!ko.length) return null;
  const posOf = new Map(table.map((r, i) => [r.team.id, i + 1]));
  const nameOf = new Map(table.map((r) => [r.team.id, r.team.shortName || r.team.name]));
  const reached = {};
  for (const [stage] of KO_STAGES) {
    reached[stage] = new Set();
    for (const m of ko.filter((x) => x.stage === stage)) [m.homeTeam?.id, m.awayTeam?.id].forEach((id) => id && reached[stage].add(id));
  }
  const final = ko.find((m) => m.stage === "FINAL" && m.status === "FINISHED");
  const winnerId = final ? (final.score.winner === "HOME_TEAM" ? final.homeTeam.id : final.score.winner === "AWAY_TEAM" ? final.awayTeam.id : null) : null;
  const started = KO_STAGES.filter(([stage]) => reached[stage].size).map(([stage]) => stage);
  return KO_GROUPS.map(([label, lo, hi]) => {
    const ids = table.slice(lo - 1, hi).map((r) => r.team.id);
    const cols = {};
    for (const [stage] of KO_STAGES) {
      // Top-8 teams skip the play-offs, so that column doesn't apply to them.
      if (stage === "PLAYOFFS" && lo === 1) { cols[stage] = null; continue; }
      cols[stage] = started.includes(stage) ? ids.filter((id) => reached[stage].has(id)).map((id) => nameOf.get(id)) : undefined;
    }
    cols.WINNER = winnerId ? (ids.includes(winnerId) ? [nameOf.get(winnerId)] : []) : undefined;
    return { label, size: ids.length, cols, positions: ids.map((id) => posOf.get(id)) };
  });
}

// Combine several seasons; team names get a season tag (e.g. "Arsenal 24/25") when combined.
function sumKnockout(seasons) {
  return KO_GROUPS.map((_, gi) => {
    const rows = seasons.map((s) => s.knockout[gi]);
    const cols = {};
    for (const key of [...KO_STAGES.map(([st]) => st), "WINNER"]) {
      const vals = rows.map((r) => r.cols[key]);
      if (vals.some((v) => v === null)) cols[key] = null;
      else if (vals.every((v) => v === undefined)) cols[key] = undefined;
      else cols[key] = vals.flatMap((v, i) => (v || []).map((name) => (seasons.length > 1 ? `${name} ${seasons[i].meta.label.slice(2)}` : name)));
    }
    return { label: rows[0].label, size: rows.reduce((sum, r) => sum + r.size, 0), cols };
  });
}

function knockoutTableHtml(groups) {
  const keys = [...KO_STAGES, ["WINNER", "Winner"]];
  const cell = (g, key) => {
    const v = g.cols[key];
    if (v === null) return `<td class="ko-cell na" title="Top-8 teams skip the play-offs">—</td>`;
    if (v === undefined) return `<td class="ko-cell na" title="Not played yet">·</td>`;
    const share = v.length / g.size;
    return `<td class="ko-cell" title="${esc(v.join(", ") || "None")}">
      <div class="ko-num"><b>${v.length}</b> / ${g.size}</div>
      <div class="ko-bar"><span style="width:${share * 100}%"></span></div>
    </td>`;
  };
  return `<table class="pvp ko">
    <thead><tr><th class="corner">League position</th>${keys.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>
    <tbody>${groups.map((g) => `<tr><th>${g.label}</th>${keys.map(([key]) => cell(g, key)).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function knockoutCard(stats) {
  const withData = stats.filter((s) => s.knockout);
  if (!withData.length) return "";
  const options = withData.length > 1
    ? [{ id: "all", label: "All seasons" }, ...withData.map((s) => ({ id: s.meta.id, label: s.meta.label }))]
    : withData.map((s) => ({ id: s.meta.id, label: s.meta.label }));
  return `<div class="card stat-card wide" id="ko-card">
      <h2>What happened next</h2>
      <p class="hint">How far teams got in the knockouts, by where they finished in the league phase.
        Places 1–8 go straight to the Round of 16; 9–16 are seeded in the play-offs, 17–24 unseeded. Hover a cell to see the teams.</p>
      <div class="seg-buttons" role="group" aria-label="Season">
        ${options.map((o, i) => `<button type="button" data-ko="${o.id}" class="${i === 0 ? "active" : ""}">${esc(o.label)}</button>`).join("")}
      </div>
      <div class="pvp-scroll" id="ko-matrix">${knockoutHtmlFor(options[0].id, withData)}</div>
    </div>`;
}

function knockoutHtmlFor(id, withData) {
  const chosen = id === "all" ? withData : withData.filter((s) => s.meta.id === id);
  return knockoutTableHtml(sumKnockout(chosen));
}

function wireKnockout(stats) {
  const card = $("#ko-card");
  if (!card) return;
  const withData = stats.filter((s) => s.knockout);
  card.querySelectorAll("[data-ko]").forEach((btn) => btn.addEventListener("click", () => {
    card.querySelectorAll("[data-ko]").forEach((b) => b.classList.toggle("active", b === btn));
    $("#ko-matrix").innerHTML = knockoutHtmlFor(btn.dataset.ko, withData);
  }));
}

const THROUGH_OUT_FROM = Math.round(COMP.games * 0.625); // games played before the card shows (5 of 8, 4 of 6)

function throughOutCard(stats) {
  const s = stats.find((x) => x.status && x.played);
  if (!s || Math.min(...s.table.map((r) => r.playedGames)) < THROUGH_OUT_FROM) return "";
  const groups = [
    ["r16", "Round of 16 secured", "z1"],
    ["top24", "At least the play-offs", "z2"],
    ["po", "Play-offs (top 8 out of reach)", "z2"],
    ["no-top8", "Top 8 out of reach, top 24 still open", "z2"],
    ["out", "Eliminated", "z3"],
  ];
  const teamsWith = (key) => s.table.filter((r) => s.status.get(r.team.id) === key);
  const open = s.table.filter((r) => !s.status.has(r.team.id)).length;
  const blocks = groups.map(([key, title, cls]) => {
    const teams = teamsWith(key);
    if (!teams.length) return "";
    return `<div class="status-group">
      <h3><span class="dot ${cls}-dot"></span>${esc(title)} <span class="count">${teams.length}</span></h3>
      <div class="status-teams">${teams.map((r) => `<span class="status-team">${crest(r.team.crest)}${esc(r.team.shortName || r.team.name)}</span>`).join("")}</div>
    </div>`;
  }).join("");
  const played = Math.min(...s.table.map((r) => r.playedGames));
  return `<div class="card stat-card wide">
      <h2>Already through or out · ${esc(s.meta.label)}</h2>
      <p class="hint">Decided on points alone, assuming the worst case for each team: a team only counts as safe when
        nobody can catch it any more. Tiebreakers aren't used, so a status can appear a little later than in the media.</p>
      ${blocks || `<p class="empty-note">Nothing is decided yet after ${played} matchdays.</p>`}
      ${blocks ? `<p class="hint">Still open: ${open} team${open === 1 ? "" : "s"}.</p>` : ""}
    </div>`;
}

// For each team: average points per game of its 8 league-phase opponents,
// leaving out the opponents' match against that team. Higher = harder draw.
function drawDifficulty(table, league, pots) {
  const potOf = {};
  if (pots) for (const [pot, ids] of Object.entries(pots)) if (Array.isArray(ids)) ids.forEach((id) => (potOf[id] = pot));
  const rowOf = new Map(table.map((r, i) => [r.team.id, { ...r, pos: i + 1 }]));
  const list = [];
  for (const r of table) {
    const id = r.team.id;
    const opps = [];
    for (const m of league) {
      if (m.homeTeam.id !== id && m.awayTeam.id !== id) continue;
      const isHome = m.homeTeam.id === id;
      const opp = rowOf.get(isHome ? m.awayTeam.id : m.homeTeam.id);
      if (!opp) continue;
      let pts = opp.points, games = opp.playedGames;
      if (m.status === "FINISHED") {
        const { home: h, away: a } = m.score.fullTime;
        const oppGoals = isHome ? a : h, ownGoals = isHome ? h : a;
        pts -= oppGoals > ownGoals ? 3 : oppGoals === ownGoals ? 1 : 0;
        games -= 1;
      }
      opps.push({ team: opp.team, pos: opp.pos, home: isHome, ppg: games > 0 ? pts / games : null });
    }
    const rated = opps.filter((o) => o.ppg !== null);
    if (!rated.length) continue;
    const value = rated.reduce((s, o) => s + o.ppg, 0) / rated.length;
    list.push({ team: r.team, pos: rowOf.get(id).pos, pot: potOf[id], value, opps });
  }
  return list.sort((a, b) => b.value - a.value);
}

function drawRowsHtml(list, offset, maxValue) {
  return list.map((d, i) => {
    const oppTitle = d.opps.map((o) => `${o.home ? "vs" : "at"} ${o.team.shortName || o.team.name} (${o.pos}${o.ppg === null ? "" : `, ${o.ppg.toFixed(2)}`})`).join("\n");
    return `<tr title="${esc(oppTitle)}">
      <td class="rank">${offset + i + 1}</td>
      <td class="team"><div class="team-cell">${crest(d.team.crest)}<span>${esc(d.team.shortName || d.team.name)}</span></div></td>
      <td>${d.pot ? `<span class="pot-badge">P${d.pot}</span>` : ""}</td>
      <td><span class="pchip ${posZone(d.pos)}">${d.pos}</span></td>
      <td class="draw-val"><div class="draw-bar"><span style="width:${(d.value / maxValue) * 100}%"></span></div><b>${d.value.toFixed(2)}</b></td>
    </tr>`;
  }).join("");
}

function drawTableHtml(list, offset, maxValue) {
  return `<table class="mini draws">
    <thead><tr><th>#</th><th class="team">Team</th><th>Pot</th><th>Pos</th><th class="draw-val">Opp. pts/game</th></tr></thead>
    <tbody>${drawRowsHtml(list, offset, maxValue)}</tbody>
  </table>`;
}

function drawsHtml(s) {
  const list = s.draws;
  const max = Math.max(...list.map((d) => d.value), 0.01);
  const n = list.length;
  const note = s.complete ? "" : `<p class="hint ongoing-note">${esc(s.meta.label)} is still running, so these numbers will change.</p>`;
  return `${note}
    <div class="draw-cols">
      <div><h3>Hardest draws</h3>${drawTableHtml(list.slice(0, 10), 0, max)}</div>
      <div><h3>Easiest draws</h3>${drawTableHtml(list.slice(-10).reverse(), 0, max).replace(/<td class="rank">(\d+)<\/td>/g, (_, k) => `<td class="rank">${n + 1 - Number(k)}</td>`)}</div>
    </div>
    <details class="chart-table">
      <summary>Show all ${n} teams</summary>
      ${drawTableHtml(list, 0, max)}
    </details>`;
}

function drawsCard(stats) {
  const withData = stats.filter((s) => s.draws.length && s.played);
  if (!withData.length) return "";
  const initial = withData.find((s) => s.complete) || withData[0];
  return `<div class="card stat-card wide" id="draws-card">
      <h2>Hardest draw</h2>
      <p class="hint">How strong each team's 8 league-phase opponents turned out to be: their average points per game,
        not counting their match against that team. Higher = harder draw. Hover a row to see the opponents.</p>
      <div class="seg-buttons" role="group" aria-label="Season">
        ${withData.map((s) => `<button type="button" data-draws="${s.meta.id}" class="${s === initial ? "active" : ""}">${esc(s.meta.label)}</button>`).join("")}
      </div>
      <div id="draws-body">${drawsHtml(initial)}</div>
    </div>`;
}

function wireDraws(stats) {
  const card = $("#draws-card");
  if (!card) return;
  card.querySelectorAll("[data-draws]").forEach((btn) => btn.addEventListener("click", () => {
    card.querySelectorAll("[data-draws]").forEach((b) => b.classList.toggle("active", b === btn));
    $("#draws-body").innerHTML = drawsHtml(stats.find((s) => s.meta.id === btn.dataset.draws));
  }));
}

// grid[rowPot][colPot] = results of row-pot teams against col-pot teams (both sides counted).
function potVsPot(finished, pots) {
  const potOf = {};
  for (const [pot, ids] of Object.entries(pots)) if (Array.isArray(ids)) ids.forEach((id) => (potOf[id] = pot));
  const grid = {};
  for (const r of POT_KEYS) { grid[r] = {}; for (const c of POT_KEYS) grid[r][c] = { w: 0, d: 0, l: 0 }; }
  for (const m of finished) {
    const hp = potOf[m.homeTeam.id], ap = potOf[m.awayTeam.id];
    if (!hp || !ap) continue;
    const { home: h, away: a } = m.score.fullTime;
    const hk = h > a ? "w" : h < a ? "l" : "d";
    const ak = hk === "w" ? "l" : hk === "l" ? "w" : "d";
    grid[hp][ap][hk]++;
    grid[ap][hp][ak]++;
  }
  return grid;
}

function sumPotVsPot(grids) {
  const out = {};
  for (const r of POT_KEYS) {
    out[r] = {};
    for (const c of POT_KEYS) {
      out[r][c] = { w: 0, d: 0, l: 0 };
      for (const g of grids) for (const k of "wdl") out[r][c][k] += g[r][c][k];
    }
  }
  return out;
}

function potMatrixHtml(grid) {
  const cell = (rec, same) => {
    const n = rec.w + rec.d + rec.l;
    if (!n) return `<td class="pvp-cell"><span class="pvp-empty">–</span></td>`;
    const w = pct(rec.w, n), d = pct(rec.d, n), l = 100 - w - d;
    const ppg = ((rec.w * 3 + rec.d) / n).toFixed(2);
    // Same-pot games are counted from both sides, so each match appears twice.
    const games = same ? n / 2 : n;
    const seg = (cls, v) => (v ? `<span class="seg ${cls}" style="flex:${v}">${v >= 12 ? `${v}%` : ""}</span>` : "");
    return `<td class="pvp-cell" title="${rec.w} won · ${rec.d} drawn · ${rec.l} lost · ${games} matches">
      <div class="pvp-bar">${seg("home-win", w)}${seg("draw", d)}${seg("away-win", l)}</div>
      <div class="pvp-meta"><b>${ppg}</b> pts/game · ${games} m</div>
    </td>`;
  };
  return `<table class="pvp">
    <thead><tr><th class="corner">vs →</th>${POT_KEYS.map((c) => `<th>Pot ${c}</th>`).join("")}</tr></thead>
    <tbody>${POT_KEYS.map((r) => `<tr><th>Pot ${r}</th>${POT_KEYS.map((c) => cell(grid[r][c], r === c)).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function potVsPotCard(stats) {
  const withData = stats.filter((s) => s.potVsPot && s.played);
  if (!withData.length) return "";
  const options = [{ id: "all", label: "All seasons" }, ...withData.map((s) => ({ id: s.meta.id, label: s.meta.label }))];
  return `<div class="card stat-card wide" id="pvp-card">
      <h2>Pot vs pot</h2>
      <p class="hint">How teams from each pot (rows) did against teams from each pot (columns) in the league phase.
        Green = won, yellow = draw, red = lost. Hover a cell for the exact numbers.</p>
      <div class="seg-buttons" role="group" aria-label="Season">
        ${options.map((o, i) => `<button type="button" data-pvp="${o.id}" class="${i === 0 ? "active" : ""}">${esc(o.label)}</button>`).join("")}
      </div>
      <div class="pvp-scroll" id="pvp-matrix">${potMatrixHtml(sumPotVsPot(withData.map((s) => s.potVsPot)))}</div>
    </div>`;
}

function wirePotVsPot(stats) {
  const card = $("#pvp-card");
  if (!card) return;
  const withData = stats.filter((s) => s.potVsPot && s.played);
  card.querySelectorAll("[data-pvp]").forEach((btn) => btn.addEventListener("click", () => {
    card.querySelectorAll("[data-pvp]").forEach((b) => b.classList.toggle("active", b === btn));
    const id = btn.dataset.pvp;
    const grids = (id === "all" ? withData : withData.filter((s) => s.meta.id === id)).map((s) => s.potVsPot);
    $("#pvp-matrix").innerHTML = potMatrixHtml(sumPotVsPot(grids));
  }));
}

function cutoffCard(title, hint, stats, field, placeLabel) {
  const rows = stats.filter((s) => s[field] && s.played).map((s) => `
    <tr class="${s.complete ? "" : "ongoing"}">
      <td class="season-cell">${esc(s.meta.label)}${s.complete ? "" : ` <span class="tag">so far</span>`}</td>
      <td class="big">${s[field].points}</td>
      <td class="big">${signed(s[field].goalDifference)}</td>
      <td class="team"><div class="team-cell">${crest(s[field].team.crest)}<span>${esc(s[field].team.shortName || s[field].team.name)}</span></div></td>
    </tr>`).join("");
  return `<div class="card stat-card">
      <h2>${esc(title)}</h2>
      <p class="hint">${esc(hint)}</p>
      <table class="mini">
        <thead><tr><th>Season</th><th>Pts</th><th>GD</th><th class="team">${esc(placeLabel)}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No data.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderStats(stats) {
  const hdaRows = stats.filter((s) => s.played).map((s) => {
    const n = s.played, h = pct(s.home, n), d = pct(s.draw, n), a = 100 - h - d;
    const seg = (cls, v, count, what) => (v ? `<span class="seg ${cls}" style="flex:${v}" title="${count} ${what}">${v}%</span>` : "");
    return `<div class="hda-row">
      <div class="hda-label">${esc(s.meta.label)}<small>${n} matches${s.complete ? "" : " so far"}</small></div>
      <div class="hda-bar">${seg("home-win", h, s.home, "home wins")}${seg("draw", d, s.draw, "draws")}${seg("away-win", a, s.away, "away wins")}</div>
    </div>`;
  }).join("");

  const potBlocks = stats.filter((s) => s.complete && s.potPositions).map((s) => `
    <div class="pot-season">
      <h3>${esc(s.meta.label)}</h3>
      ${s.potPositions.map((list, i) => `<div class="pot-row">
        <span class="pot-label">Pot ${i + 1}</span>
        <span class="chips">${list.map((x) => `<span class="pchip ${posZone(x.pos)}" title="${esc(x.team.shortName || x.team.name)}">${x.pos}</span>`).join("")}</span>
      </div>`).join("")}
    </div>`).join("");

  $("#stats").innerHTML = `
    ${throughOutCard(stats)}
    ${cutoffCard("Needed for the top 8", "Points and goal difference of the team in 8th place after the league phase.", stats, "cutoff8", "8th place")}
    ${cutoffCard("Needed for the play-offs", "Points and goal difference of the team in 24th place after the league phase.", stats, "cutoff24", "24th place")}
    ${potVsPotCard(stats)}
    ${drawsCard(stats)}
    ${knockoutCard(stats)}
    <div class="card stat-card wide">
      <h2>Home wins, draws, away wins</h2>
      <p class="hint">Share of league-phase matches.</p>
      ${hdaRows || `<p class="empty">No matches played yet.</p>`}
      <ul class="legend">
        <li><span class="dot" style="background:var(--win)"></span>Home win</li>
        <li><span class="dot" style="background:var(--draw-cell)"></span>Draw</li>
        <li><span class="dot" style="background:var(--loss)"></span>Away win</li>
      </ul>
    </div>
    <div class="card stat-card wide">
      <h2>Final positions per pot</h2>
      <p class="hint">Where the teams from each draw pot finished in the league phase. Hover a number to see the team.</p>
      <div class="pot-seasons">${potBlocks || `<p class="empty">Available once a league phase is finished.</p>`}</div>
      <ul class="legend">
        <li><span class="dot" style="background:var(--win)"></span>1–8 · Round of 16</li>
        <li><span class="dot" style="background:var(--draw-cell)"></span>9–24 · Play-offs</li>
        <li><span class="dot" style="background:var(--loss)"></span>25–36 · Eliminated</li>
      </ul>
    </div>`;
}

async function loadStats() {
  if (statsLoaded) return;
  statsLoaded = true;
  try {
    if (!seasonIndex.length) throw new Error("no season index");
    const stats = await Promise.all(seasonIndex.map(async (meta) => {
      const [standings, matches] = await fetchSeason(meta.id);
      return seasonStats(meta, standings, matches.matches || []);
    }));
    renderStats(stats);
    wirePotVsPot(stats);
    wireDraws(stats);
    wireKnockout(stats);
  } catch (err) {
    console.error(err);
    statsLoaded = false;
    $("#stats").innerHTML = `<div class="card empty">Statistics are not available yet.</div>`;
  }
}

/* ---------- Competition switch and per-competition page chrome ---------- */

function compHref(key) {
  // Switching competition starts fresh: season and club belong to the previous competition.
  const params = new URLSearchParams(location.search);
  params.delete("season");
  params.delete("club");
  if (key === "cl") params.delete("comp"); else params.set("comp", key);
  const qs = params.toString();
  const hash = location.hash.startsWith("#match-") ? "#matches" : location.hash;
  return `${location.pathname}${qs ? `?${qs}` : ""}${hash}`;
}

function setupCompetition() {
  $("#comp-switch").innerHTML = Object.values(COMPS).map((c) =>
    `<a href="${compHref(c.key)}" data-comp="${c.key}" class="${c === COMP ? "active" : ""}"${c === COMP ? ' aria-current="page"' : ""}>` +
    `<span class="long">${esc(c.name)}</span><span class="short">${esc(c.name.split(" ")[0])}</span></a>`).join("");
  $("#comp-switch").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a) a.href = compHref(a.dataset.comp); // recomputed on click, so the current tab is kept
  });
  $("#comp-title").textContent = COMP.name;
  document.title = `${COMP.name} Standings`;
  const [srcName, srcUrl] = COMP.source;
  $("#data-source").innerHTML = `Data: <a href="${srcUrl}" target="_blank" rel="noopener">${esc(srcName)}</a>`;
  // Table header: one column per pot (Conference League) or a home + away column per pot.
  $("#pot-heads").outerHTML = POT_KEYS.map((k) =>
    `<th class="pot-head pot-start" colspan="${TWO_PER_POT ? 2 : 1}">Pot ${k}</th>`).join("");
  $("#ha-row").innerHTML = POT_KEYS.map(() => TWO_PER_POT
    ? `<th class="pot-start" title="Home">H</th><th title="Away">A</th>`
    : `<th class="pot-start" title="Opponent from this pot, home (H) or away (A)">Opp.</th>`).join("");
}
setupCompetition();
if (!FEATURES.simulationTab) document.querySelector('.tab[data-view="sim"]').hidden = true;

/* ---------- Boot ---------- */

(async function init() {
  try {
    allPots = (await loadJson(COMP.pots).catch(() => ({ seasons: {} }))).seasons || {};
    // Older deploys only have data/standings.json; fall back to that.
    const index = await loadJson(`${COMP.base}/seasons.json`).catch(() => null);
    seasonIndex = index?.seasons || [];
    const id = seasonIndex.length ? setupSeasonPicker(seasonIndex) : null;
    const startView = location.hash.slice(1);
    if (["matches", "stats", "club", ...(FEATURES.simulationTab ? ["sim"] : [])].includes(startView)) showView(startView);
    else if (startView.startsWith("match-")) openMatch(Number(startView.slice(6)), false);
    await loadSeason(id);
  } catch (err) {
    showError(err);
  }
})();
