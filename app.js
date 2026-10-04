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

// Short codes where football-data's TLA is ambiguous or unclear.
const ABBR = { 5: "BAY", 81: "BAR", 5721: "BOD" };
const abbr = (t) => ABBR[t.id] || t.tla || (t.shortName || t.name).slice(0, 3).toUpperCase();
const SLOTS = ["1H", "1A", "2H", "2A", "3H", "3A", "4H", "4A"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const shortDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// teamId -> { "1H": match, "1A": match, ... } for the league phase.
function buildOpponentGrid(matches, pots) {
  const potOf = {};
  for (const [pot, ids] of Object.entries(pots)) if (Array.isArray(ids)) ids.forEach((id) => (potOf[id] = pot));
  const grid = {};
  for (const m of matches) {
    if (m.stage !== "LEAGUE_STAGE" || !m.homeTeam?.id || !m.awayTeam?.id) continue;
    (grid[m.homeTeam.id] ??= {})[`${potOf[m.awayTeam.id]}H`] = m;
    (grid[m.awayTeam.id] ??= {})[`${potOf[m.homeTeam.id]}A`] = m;
  }
  return grid;
}

function opponentCell(m, slot) {
  const start = slot.endsWith("H") ? " pot-start" : "";
  if (!m) return `<td class="opp-cell${start}"></td>`;
  const home = slot.endsWith("H");
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
      <span class="opp-team">${crest(opp.crest)}<span>${esc(abbr(opp))}</span></span>
      ${res}
    </div>
  </td>`;
}

/* ---------- Through / out ---------- */

const LEAGUE_GAMES = 8;
const STATUS = {
  r16: { label: "R16 ✓", title: "Round of 16 secured", cls: "z1" },
  top24: { label: "Top 24 ✓", title: "At least the play-offs secured", cls: "z2" },
  po: { label: "Play-offs", title: "Play-offs secured, top 8 out of reach", cls: "z2" },
  out: { label: "Out", title: "Eliminated", cls: "z3" },
};

// Conservative, points-only check: a team is "safe" for the top N only if at most N-1
// others could still reach its current points, and "out" only if at least N others
// already have more points than it can still reach. Ties count against the team.
function clinchStatus(table) {
  if (!table.length || table.every((r) => r.playedGames >= LEAGUE_GAMES)) return null;
  const rows = table.map((r) => ({ id: r.team.id, min: r.points, max: r.points + 3 * (LEAGUE_GAMES - r.playedGames) }));
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
    body.innerHTML = `<tr><td colspan="21" class="empty">No standings yet.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    const gdClass = r.goalDifference > 0 ? "gd-pos" : r.goalDifference < 0 ? "gd-neg" : "";
    const gd = r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference;
    // Use the row index, not r.position: tied teams share a position in the data.
    const cut = i === 7 || i === 23 ? " cut" : "";
    const cells = grid[r.team.id] || {};
    return `<tr class="${zone(i + 1)}${cut}">
      <td class="pos sticky">${r.position}</td>
      <td class="team sticky"><div class="team-cell">${crest(r.team.crest)}<span class="team-name">${esc(r.team.shortName || r.team.name)}</span>${status ? statusBadge(status.get(r.team.id)) : ""}</div></td>
      ${SLOTS.map((s) => opponentCell(cells[s], s)).join("")}
      <td class="pot-start">${r.playedGames}</td>
      <td>${r.won}</td>
      <td>${r.draw}</td>
      <td>${r.lost}</td>
      <td class="hide-sm">${r.goalsFor}</td>
      <td class="hide-sm">${r.goalsAgainst}</td>
      <td class="${gdClass}">${gd}</td>
      <td class="pts">${r.points}</td>
      ${preds ? predCells(preds.get(r.team.id)) : ""}
      ${resultCell(results, r.team.id)}
    </tr>`;
  }).join("");
}

/* ---------- Matches ---------- */

let rounds = [];

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
  if (view === "sim") loadSim();
  if (view === "club") loadClub();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

// Clicking a match on the Matches tab opens its detail page.
function onMatchActivate(e) {
  const el = e.target.closest("[data-match]");
  if (!el || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  openMatch(Number(el.dataset.match), true, e.currentTarget.id === "club-body" ? "club" : "matches");
}
for (const id of ["match-list", "club-body"]) {
  $(`#${id}`).addEventListener("click", onMatchActivate);
  $(`#${id}`).addEventListener("keydown", onMatchActivate);
}

window.addEventListener("popstate", () => {
  const h = location.hash.slice(1);
  if (h.startsWith("match-")) openMatch(Number(h.slice(6)), false);
  else showView(["matches", "stats", "sim", "club"].includes(h) ? h : "table");
  const club = Number(new URLSearchParams(location.search).get("club"));
  if (h === "club" && clubLoaded && club && clubData?.clubs.has(club)) {
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

const seasonCache = new Map();
function fetchSeason(id) {
  const base = id ? `data/${id}` : "data";
  if (!seasonCache.has(base)) {
    seasonCache.set(base, Promise.all([
      loadJson(`${base}/standings.json`),
      loadJson(`${base}/matches.json`).then(removeShootouts).catch(() => ({ matches: [] })),
    ]));
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
  if (status && pots) {
    const result = await seasonSimulation(String(s));
    if (result?.sim) preds = new Map(result.sim.teams.map((t) => [t.team.id, t]));
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
    `<tr><td colspan="21" class="empty">No data yet. It appears after the GitHub Action has run once.</td></tr>`;
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
  for (const meta of seasonIndex) {
    const [standings, matches] = await fetchSeason(meta.id);
    seasons.push({ meta, table: standings.table || [], matches: matches.matches || [] });
  }
  const clubs = new Map();
  for (const s of seasons) for (const r of s.table) if (!clubs.has(r.team.id)) clubs.set(r.team.id, r.team);
  clubData = { seasons, clubs };
  return clubData;
}

function stageLabel(m) {
  return m.stage === "LEAGUE_STAGE" ? `Matchday ${m.matchday}` : STAGE_LABELS[m.stage] || m.stage;
}

// Record split into league phase (home/away) and knockout phase (home/away/final at a neutral venue).
function clubRecord(id, seasons) {
  const blank = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const rec = { league: { home: blank(), away: blank() }, ko: { home: blank(), away: blank(), final: blank() } };
  for (const s of seasons) {
    for (const m of s.matches) {
      if (m.status !== "FINISHED") continue;
      const home = m.homeTeam?.id === id;
      if (!home && m.awayTeam?.id !== id) continue;
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

function fixtureLine(m, id, posOf, big) {
  const home = m.homeTeam.id === id;
  const opp = home ? m.awayTeam : m.homeTeam;
  const when = new Date(m.utcDate);
  const date = `${WEEKDAYS[when.getDay()]} ${shortDate(m.utcDate)}`;
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const extra = posOf.get(opp.id) ? `${ordinal(posOf.get(opp.id))} now` : "";
  if (big) {
    return `<div class="next-match clickable" data-match="${m.id}" role="button" tabindex="0" aria-label="Match details">
      <div class="next-opp">${crest(opp.crest)}<div><div class="next-name">${home ? "vs" : "at"} ${esc(opp.name)}</div>
        <div class="next-meta">${home ? "Home" : "Away"} · ${esc(stageLabel(m))}${extra ? ` · ${esc(extra)}` : ""}</div></div></div>
      <div class="next-when"><b>${esc(date)}</b><span>${time}</span></div>
    </div>`;
  }
  return `<div class="fixture-row clickable" data-match="${m.id}" role="button" tabindex="0" aria-label="Match details">
    <span class="fx-when">${esc(date)}</span>
    <span class="fx-ha ${home ? "h" : "a"}">${home ? "H" : "A"}</span>
    <span class="fx-opp">${crest(opp.crest)}${esc(opp.shortName || opp.name)}</span>
    <span class="fx-extra">${esc(extra)}</span>
  </div>`;
}

function renderClub(id) {
  const { seasons, clubs } = clubData;
  const team = clubs.get(id);
  if (!team) return;
  const current = seasons.find((s) => s.meta.current) || seasons[0];
  const past = seasons.filter((s) => s !== current);
  const idx = current.table.findIndex((r) => r.team.id === id);
  const row = current.table[idx];

  // Current season
  let nowHtml;
  if (row) {
    const pos = idx + 1, z = posZone(pos);
    const leagueDone = current.table.every((r) => r.playedGames >= LEAGUE_GAMES);
    const result = finalResults(current.matches);
    const status = clinchStatus(current.table)?.get(id);
    nowHtml = `<div class="club-now">
        <div class="club-pos"><span class="pchip ${z}">${pos}</span><div><b>${ordinal(pos)} of ${current.table.length}</b>
          <span>${leagueDone ? "Final league-phase position" : ZONE_TEXT[z]}${status && STATUS[status] ? ` · ${STATUS[status].title}` : ""}</span></div></div>
        <div class="club-stats">
          <div><b>${row.points}</b><span>Points</span></div>
          <div><b>${row.playedGames}</b><span>Played</span></div>
          <div><b>${row.won}-${row.draw}-${row.lost}</b><span>W-D-L</span></div>
          <div><b>${signed(row.goalDifference)}</b><span>Goal diff.</span></div>
        </div>
        ${result ? `<div class="club-result">Result: <span class="result ${RESULT[result.get(id) || "LEAGUE"].cls}">${RESULT[result.get(id) || "LEAGUE"].label}</span></div>` : ""}
      </div>`;
  } else {
    nowHtml = `<p class="empty-note">${esc(team.shortName || team.name)} is not in the ${esc(current.meta.label)} Champions League.</p>`;
  }

  // Upcoming fixtures
  const posOf = new Map(current.table.map((r, i) => [r.team.id, i + 1]));
  const upcoming = current.matches
    .filter((m) => m.status !== "FINISHED" && (m.homeTeam?.id === id || m.awayTeam?.id === id) && m.homeTeam?.id && m.awayTeam?.id)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const nextHtml = upcoming.length
    ? fixtureLine(upcoming[0], id, posOf, true) +
      (upcoming.length > 1 ? `<h3 class="sub-head">After that</h3>${upcoming.slice(1).map((m) => fixtureLine(m, id, posOf, false)).join("")}` : "")
    : `<p class="empty-note">${row ? "No upcoming matches scheduled." : "Not taking part this season."}</p>`;

  // Results this season (oldest first), coloured from the club's point of view
  const played = current.matches
    .filter((m) => m.status === "FINISHED" && (m.homeTeam?.id === id || m.awayTeam?.id === id))
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const resultsHtml = played.length
    ? played.map((m) => {
        const home = m.homeTeam.id === id;
        const opp = home ? m.awayTeam : m.homeTeam;
        const { home: h, away: a } = m.score.fullTime;
        const mine = home ? h : a, theirs = home ? a : h;
        const outcome = mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
        const pens = m.score.pens ? ` <small class="muted">pens ${m.score.pens.home}–${m.score.pens.away}</small>` : "";
        return `<div class="fixture-row result-row clickable" data-match="${m.id}" role="button" tabindex="0" aria-label="Match details">
          <span class="fx-when">${esc(shortDate(m.utcDate))}</span>
          <span class="fx-ha ${home ? "h" : "a"}">${home ? "H" : "A"}</span>
          <span class="fx-opp">${crest(opp.crest)}${esc(opp.shortName || opp.name)}</span>
          <span class="fx-score"><span class="res ${outcome}">${h}–${a}</span>${pens}</span>
          <span class="fx-extra">${esc(stageLabel(m))}</span>
        </div>`;
      }).join("")
    : `<p class="empty-note">${row ? "No matches played yet." : "Not taking part this season."}</p>`;

  // Previous seasons
  const pastHtml = past.map((s) => {
    const i = s.table.findIndex((r) => r.team.id === id);
    if (i === -1) return `<div class="past-row"><span class="past-season">${esc(s.meta.label)}</span><span class="muted">Did not take part</span></div>`;
    const res = finalResults(s.matches);
    const key = res ? res.get(id) || "LEAGUE" : null;
    return `<div class="past-row">
      <span class="past-season">${esc(s.meta.label)}</span>
      <span class="pchip ${posZone(i + 1)}">${i + 1}</span>
      <span class="past-pts">${s.table[i].points} pts</span>
      ${key ? `<span class="result ${RESULT[key].cls}">${RESULT[key].label}</span>` : ""}
    </div>`;
  }).join("");

  const rec = clubRecord(id, seasons);
  const first = seasons[seasons.length - 1].meta.label;

  $("#club-body").innerHTML = `
    <div class="card stat-card wide club-head">
      ${team.crest ? `<img class="club-crest" src="${esc(team.crest)}" alt="">` : ""}
      <div class="club-title"><h2>${esc(team.name)}</h2><p class="hint">${esc(current.meta.label)} · League phase</p></div>
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
      <p class="hint">League-phase position and how far the club got.</p>
      ${pastHtml || `<p class="empty-note">No earlier seasons in this format.</p>`}
    </div>
    <div class="card stat-card wide">
      <h2>Record in this format</h2>
      <p class="hint">All Champions League matches since ${esc(first)}, when the 36-team league phase started.
        The final is played at a neutral venue. Penalty shoot-outs count as draws.</p>
      ${rec.total.p ? recordTableHtml(rec) : `<p class="empty-note">No matches played yet.</p>`}
    </div>`;
}

function chooseClub(id) {
  try { localStorage.setItem("club", String(id)); } catch {}
  const params = new URLSearchParams(location.search);
  params.set("club", id);
  history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`);
  renderClub(id);
}

let clubLoaded = false;
async function loadClub() {
  if (clubLoaded) return;
  clubLoaded = true;
  try {
    const { seasons, clubs } = await loadClubData();
    const current = seasons.find((s) => s.meta.current) || seasons[0];
    const inCurrent = new Set(current.table.map((r) => r.team.id));
    const byName = (a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name);
    const nowList = [...clubs.values()].filter((t) => inCurrent.has(t.id)).sort(byName);
    const earlier = [...clubs.values()].filter((t) => !inCurrent.has(t.id)).sort(byName);
    const opt = (t) => `<option value="${t.id}">${esc(t.shortName || t.name)}</option>`;
    const select = $("#club-select");
    select.innerHTML = `<optgroup label="${esc(current.meta.label)}">${nowList.map(opt).join("")}</optgroup>` +
      (earlier.length ? `<optgroup label="Earlier seasons">${earlier.map(opt).join("")}</optgroup>` : "");

    let saved = null;
    try { saved = localStorage.getItem("club"); } catch {}
    const wanted = Number(new URLSearchParams(location.search).get("club") || saved);
    const id = clubs.has(wanted) ? wanted : current.table[0]?.team.id;
    select.value = String(id);
    select.onchange = () => chooseClub(Number(select.value));
    renderClub(id);
  } catch (err) {
    console.error(err);
    clubLoaded = false;
    $("#club-body").innerHTML = `<div class="card empty">Club pages are not available right now.</div>`;
  }
}

/* ---------- Match detail ---------- */

const longDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const tname = (t) => esc(t.shortName || t.name);

// A team's finished Champions League matches before `before`, newest first.
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

// Interesting facts about one team going into the match, most notable first.
function teamFacts(team, hist, venue) {
  const facts = [];
  const name = tname(team);
  const where = venue === "home" ? "home" : "away";
  const atVenue = hist.filter((g) => !g.final && g.home === (venue === "home"));
  const add = (score, text) => facts.push({ score, text });

  if (!hist.length) return [{ score: 1, text: `${name} play their first Champions League match in this format.` }];

  const w = streak(atVenue, (g) => g.res === "W"), unb = streak(atVenue, (g) => g.res !== "L");
  const winless = streak(atVenue, (g) => g.res !== "W"), lost = streak(atVenue, (g) => g.res === "L");
  if (w >= 3) add(w + 2, `${name} won their last ${w} ${where} games.`);
  else if (unb >= 4) add(unb, `${name} are unbeaten in their last ${unb} ${where} games.`);
  if (lost >= 2) add(lost + 2, `${name} lost their last ${lost} ${where} games.`);
  else if (winless >= 3) add(winless, `${name} haven't won any of their last ${winless} ${where} games.`);

  const venueRec = recordOf(atVenue);
  if (venueRec.p >= 4 && venueRec.l === 0) add(6, `${name} have never lost ${venue === "home" ? "at home" : "away"} in this format (${venueRec.p} games).`);
  if (venueRec.p >= 4 && venueRec.w === 0) add(6, `${name} have never won ${venue === "home" ? "at home" : "away"} in this format (${venueRec.p} games).`);

  // Against top-8 teams (top 8 of that season's table)
  const top8 = hist.filter((g) => g.oppTop8);
  if (top8.length >= 3) {
    const lastLoss = top8.find((g) => g.res === "L");
    const sinceLoss = lastLoss ? top8.indexOf(lastLoss) : top8.length;
    if (sinceLoss >= 3) add(sinceLoss + 1, lastLoss
      ? `${name} haven't lost against a top-8 team since ${longDate(lastLoss.m.utcDate)} (${sinceLoss} games).`
      : `${name} have never lost against a top-8 team in this format (${top8.length} games).`);
    const lastWin = top8.find((g) => g.res === "W");
    const sinceWin = lastWin ? top8.indexOf(lastWin) : top8.length;
    if (sinceWin >= 3) add(sinceWin, lastWin
      ? `${name} haven't beaten a top-8 team since ${longDate(lastWin.m.utcDate)} (${sinceWin} games).`
      : `${name} have never beaten a top-8 team in this format (${top8.length} games).`);
  }

  const scored = streak(hist, (g) => g.gf > 0), blank = streak(hist, (g) => g.gf === 0), clean = streak(hist, (g) => g.ga === 0);
  if (scored >= 6) add(scored / 2, `${name} scored in each of their last ${scored} matches.`);
  if (blank >= 2) add(blank + 1, `${name} failed to score in their last ${blank} matches.`);
  if (clean >= 3) add(clean + 1, `${name} kept a clean sheet in their last ${clean} matches.`);

  return facts.sort((a, b) => b.score - a.score).slice(0, 3);
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
  const { seasons } = await loadClubData();
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
  const h2hHtml = meetings.length
    ? `<div class="h2h-summary">
        <div><b>${hw}</b><span>${tname(H)} wins</span></div>
        <div><b>${dr}</b><span>Draws</span></div>
        <div><b>${aw}</b><span>${tname(A)} wins</span></div>
      </div>
      ${meetings.map((g) => `<div class="h2h-row">
        <span class="fx-when">${longDate(g.m.utcDate)}</span>
        <span class="h2h-teams">${tname(g.m.homeTeam)} <b>${g.m.score.fullTime.home}–${g.m.score.fullTime.away}</b> ${tname(g.m.awayTeam)}${g.m.score.pens ? ` <small class="muted">(pens ${g.m.score.pens.home}–${g.m.score.pens.away})</small>` : ""}</span>
        <span class="fx-extra">${esc(stageLabel(g.m))}</span>
      </div>`).join("")}`
    : `<p class="empty-note">${tname(H)} and ${tname(A)} haven't met in the Champions League since ${esc(seasons[seasons.length - 1].meta.label)}. This is their first meeting in this format.</p>`;

  const hHome = hHist.filter((g) => g.home && !g.final), aAway = aHist.filter((g) => !g.home && !g.final);
  const thisSeason = (g) => g.m.utcDate >= (season.matches.map((x) => x.utcDate).sort()[0] || "");
  const facts = [...teamFacts(H, hHist, "home").map((f) => ({ ...f, team: H })), ...teamFacts(A, aHist, "away").map((f) => ({ ...f, team: A }))]
    .sort((a, b) => b.score - a.score);

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
      <p class="hint">${played ? "Going into this match" : "Going into the match"}, based on Champions League matches since ${esc(seasons[seasons.length - 1].meta.label)}.
        A top-8 team is one in the top 8 of that season's league table.</p>
      ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${crest(f.team.crest)}<span>${f.text}</span></li>`).join("")}</ul>`
        : `<p class="empty-note">Nothing remarkable yet.</p>`}
    </div>
    <div class="card stat-card">
      <h2>Head to head</h2>
      ${h2hHtml}
    </div>
    <div class="card stat-card">
      <h2>${tname(H)} at home vs ${tname(A)} away</h2>
      <div class="seg-buttons" role="group" aria-label="Period">
        <button type="button" data-cmp="all" class="active">Since ${esc(seasons[seasons.length - 1].meta.label)}</button>
        <button type="button" data-cmp="season">This season</button>
      </div>
      <div class="cmp-head"><span>${crest(H.crest)}${tname(H)} home</span><span>${tname(A)} away${crest(A.crest)}</span></div>
      <div id="cmp-body">${compareRows(recordOf(hHome), recordOf(aAway))}</div>
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
  if (clubLoaded) {
    $("#club-select").value = String(id);
    chooseClub(id);
  }
}

$("#match-detail").addEventListener("click", (e) => {
  const a = e.target.closest("[data-club]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // let new-tab clicks through
  e.preventDefault();
  openClub(Number(a.dataset.club));
});

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
    ? ["1", "2", "3", "4"].map((k) => (pots[k] || []).map((id) => posOf.get(id)).filter(Boolean).sort((a, b) => a.pos - b.pos))
    : null;
  return {
    meta, complete, played: finished.length, home, draw, away,
    cutoff8: table[7], cutoff24: table[23], potPositions, byMatchday: cutoffByMatchday(league),
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

function throughOutCard(stats) {
  const s = stats.find((x) => x.status && x.played);
  if (!s) return "";
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
      ${blocks || `<p class="empty-note">Nothing is decided yet after ${played} matchday${played === 1 ? "" : "s"}. The first teams usually clinch something from matchday 5 or 6.</p>`}
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
  for (const r of "1234") { grid[r] = {}; for (const c of "1234") grid[r][c] = { w: 0, d: 0, l: 0 }; }
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
  for (const r of "1234") {
    out[r] = {};
    for (const c of "1234") {
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
    <thead><tr><th class="corner">vs →</th>${"1234".split("").map((c) => `<th>Pot ${c}</th>`).join("")}</tr></thead>
    <tbody>${"1234".split("").map((r) => `<tr><th>Pot ${r}</th>${"1234".split("").map((c) => cell(grid[r][c], r === c)).join("")}</tr>`).join("")}</tbody>
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

// Points of the 8th and 24th team after each fully played matchday.
function cutoffByMatchday(league) {
  const points = new Map();
  const add = (id, p) => points.set(id, (points.get(id) || 0) + p);
  const out = [];
  const matchdays = [...new Set(league.map((m) => m.matchday))].sort((a, b) => a - b);
  for (const md of matchdays) {
    const games = league.filter((m) => m.matchday === md);
    if (!games.every((m) => m.status === "FINISHED")) break;
    for (const m of games) {
      const { home: h, away: a } = m.score.fullTime;
      add(m.homeTeam.id, h > a ? 3 : h === a ? 1 : 0);
      add(m.awayTeam.id, a > h ? 3 : h === a ? 1 : 0);
    }
    const sorted = [...points.values()].sort((x, y) => y - x);
    out.push({ md, p8: sorted[7] ?? 0, p24: sorted[23] ?? 0 });
  }
  return out;
}

// Season line colours (validated for the dark surface): current, previous, the one before.
const SEASON_COLORS = ["#3987e5", "#d95926", "#199e70"];

function lineChart(title, key, series, yMax) {
  const W = 520, H = 250, L = 34, R = 74, T = 14, B = 30;
  const x = (md) => L + ((md - 1) / 7) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const step = yMax > 12 ? 4 : 2;
  let grid = "";
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  for (let md = 1; md <= 8; md++) grid += `<text class="tick" x="${x(md)}" y="${H - 10}" text-anchor="middle">${md}</text>`;

  const lines = series.map((s) => {
    const pts = s.points.map((p) => [x(p.md), y(p[key])]);
    if (!pts.length) return "";
    const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join("");
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      pts.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join("");
  }).join("");

  // Direct labels at each line's end, nudged apart so they don't overlap.
  const ends = series.filter((s) => s.points.length).map((s) => {
    const last = s.points[s.points.length - 1];
    return { label: s.label, color: s.color, x: x(last.md), y: y(last[key]) };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
  const labels = ends.map((e) => `<text class="end-label" x="${e.x + 8}" y="${e.y + 4}"><tspan fill="${e.color}">●</tspan> ${esc(e.label)}</text>`).join("");

  // Hover columns, one per matchday.
  const colW = (W - L - R) / 7;
  const hits = Array.from({ length: 8 }, (_, i) => {
    const md = i + 1;
    const rows = series.map((s) => {
      const p = s.points.find((q) => q.md === md);
      return p ? `${s.label}|${s.color}|${p[key]}` : null;
    }).filter(Boolean).join(";");
    return `<rect class="hit" x="${x(md) - colW / 2}" y="${T}" width="${colW}" height="${H - T - B}" data-md="${md}" data-x="${x(md)}" data-rows="${esc(rows)}"/>`;
  }).join("");

  return `<figure class="chart" data-w="${W}">
    <figcaption>${esc(title)}</figcaption>
    <div class="chart-box">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} by matchday">
        ${grid}
        <line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
        ${lines}${labels}${hits}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
  </figure>`;
}

function wireChartHover(root) {
  root.querySelectorAll(".chart").forEach((fig) => {
    const svg = fig.querySelector("svg");
    const tip = fig.querySelector(".chart-tip");
    const cross = fig.querySelector(".crosshair");
    const W = Number(fig.dataset.w);
    svg.addEventListener("pointerover", (e) => {
      const r = e.target.closest(".hit");
      if (!r || !r.dataset.rows) return;
      const cx = Number(r.dataset.x);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<strong>Matchday ${r.dataset.md}</strong>` + r.dataset.rows.split(";").map((row) => {
        const [label, color, v] = row.split("|");
        return `<div><i style="background:${color}"></i>${esc(label)}<b>${v} pts</b></div>`;
      }).join("");
      tip.hidden = false;
      const frac = cx / W;
      tip.style.left = `${frac * 100}%`;
      tip.style.transform = frac > 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)";
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  });
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

function cutoffChartsCard(stats) {
  const series = stats.map((s, i) => ({ label: s.meta.label, color: SEASON_COLORS[i] || "#8b8b92", points: s.byMatchday }));
  if (!series.some((s) => s.points.length)) return "";
  const max = Math.max(4, ...series.flatMap((s) => s.points.map((p) => p.p8)));
  const yMax = Math.ceil(max / 4) * 4;
  const tableRows = Array.from({ length: 8 }, (_, i) => `<tr><td>${i + 1}</td>${series.map((s) => {
    const p = s.points.find((q) => q.md === i + 1);
    return `<td>${p ? `${p.p8} / ${p.p24}` : "–"}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="card stat-card wide">
      <h2>Cut-off lines by matchday</h2>
      <p class="hint">Points of the team in 8th and 24th place after each matchday. Hover a matchday to compare seasons.</p>
      <ul class="legend chart-legend">${series.map((s) => `<li><span class="dot" style="background:${s.color}"></span>${esc(s.label)}</li>`).join("")}</ul>
      <div class="charts">
        ${lineChart("8th place · Round of 16", "p8", series, yMax)}
        ${lineChart("24th place · Play-offs", "p24", series, yMax)}
      </div>
      <details class="chart-table">
        <summary>Show as table</summary>
        <table class="mini">
          <thead><tr><th>Matchday</th>${series.map((s) => `<th>${esc(s.label)}<br><small>8th / 24th</small></th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </details>
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
    ${cutoffChartsCard(stats)}
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
    wireChartHover($("#stats"));
    wirePotVsPot(stats);
    wireDraws(stats);
    wireKnockout(stats);
  } catch (err) {
    console.error(err);
    statsLoaded = false;
    $("#stats").innerHTML = `<div class="card empty">Statistics are not available yet.</div>`;
  }
}

/* ---------- Boot ---------- */

(async function init() {
  try {
    allPots = (await loadJson("pots.json").catch(() => ({ seasons: {} }))).seasons || {};
    // Older deploys only have data/standings.json; fall back to that.
    const index = await loadJson("data/seasons.json").catch(() => null);
    seasonIndex = index?.seasons || [];
    const id = seasonIndex.length ? setupSeasonPicker(seasonIndex) : null;
    const startView = location.hash.slice(1);
    if (["matches", "stats", "sim", "club"].includes(startView)) showView(startView);
    else if (startView.startsWith("match-")) openMatch(Number(startView.slice(6)), false);
    await loadSeason(id);
  } catch (err) {
    showError(err);
  }
})();
