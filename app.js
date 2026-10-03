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

function renderTable(rows, grid, status, results) {
  const body = $("#table-body");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="19" class="empty">No standings yet.</td></tr>`;
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
    scoreHtml = `<div class="score${LIVE.has(m.status) ? " live" : ""}">${ft.home ?? 0} – ${ft.away ?? 0}</div>`;
  } else if (m.status === "POSTPONED" || m.status === "CANCELLED") {
    scoreHtml = `<div class="score time">${m.status === "POSTPONED" ? "PPD" : "CANC"}</div>`;
  } else {
    scoreHtml = `<div class="score time">${time}</div>`;
  }
  const winner = m.status === "FINISHED" ? m.score?.winner : null;
  const name = (t, side) =>
    `<span class="${winner && winner !== side && winner !== "DRAW" ? "loser" : ""}">${esc(t?.shortName || t?.name || "TBD")}</span>`;
  return `<div class="match">
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
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

/* ---------- Seasons ---------- */

let allPots = {};

const seasonCache = new Map();
function fetchSeason(id) {
  const base = id ? `data/${id}` : "data";
  if (!seasonCache.has(base)) {
    seasonCache.set(base, Promise.all([
      loadJson(`${base}/standings.json`),
      loadJson(`${base}/matches.json`).catch(() => ({ matches: [] })),
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
  $(".standings").classList.toggle("no-result", !results);
  renderTable(standings.table || [], buildOpponentGrid(matches.matches || [], pots || {}), clinchStatus(standings.table || []), results);
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
    `<tr><td colspan="19" class="empty">No data yet. It appears after the GitHub Action has run once.</td></tr>`;
  $("#match-list").innerHTML = `<div class="card empty">No data yet.</div>`;
}

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
    if (startView === "matches" || startView === "stats") showView(startView);
    await loadSeason(id);
  } catch (err) {
    showError(err);
  }
})();
