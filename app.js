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

function renderTable(rows, grid) {
  const body = $("#table-body");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="18" class="empty">No standings yet.</td></tr>`;
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
      <td class="team sticky"><div class="team-cell">${crest(r.team.crest)}<span class="team-name">${esc(r.team.shortName || r.team.name)}</span></div></td>
      ${SLOTS.map((s) => opponentCell(cells[s], s)).join("")}
      <td class="pot-start">${r.playedGames}</td>
      <td>${r.won}</td>
      <td>${r.draw}</td>
      <td>${r.lost}</td>
      <td class="hide-sm">${r.goalsFor}</td>
      <td class="hide-sm">${r.goalsAgainst}</td>
      <td class="${gdClass}">${gd}</td>
      <td class="pts">${r.points}</td>
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
  renderTable(standings.table || [], buildOpponentGrid(matches.matches || [], pots || {}));
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
    `<tr><td colspan="18" class="empty">No data yet. It appears after the GitHub Action has run once.</td></tr>`;
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
  return { meta, complete, played: finished.length, home, draw, away, cutoff: table[23], potPositions };
}

function renderStats(stats) {
  const cutoffRows = stats.filter((s) => s.cutoff && s.played).map((s) => `
    <tr class="${s.complete ? "" : "ongoing"}">
      <td class="season-cell">${esc(s.meta.label)}${s.complete ? "" : ` <span class="tag">so far</span>`}</td>
      <td class="big">${s.cutoff.points}</td>
      <td class="big">${signed(s.cutoff.goalDifference)}</td>
      <td class="team"><div class="team-cell">${crest(s.cutoff.team.crest)}<span>${esc(s.cutoff.team.shortName || s.cutoff.team.name)}</span></div></td>
    </tr>`).join("");

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
    <div class="card stat-card">
      <h2>Needed for the play-offs</h2>
      <p class="hint">Points and goal difference of the team in 24th place after the league phase.</p>
      <table class="mini">
        <thead><tr><th>Season</th><th>Pts</th><th>GD</th><th class="team">24th place</th></tr></thead>
        <tbody>${cutoffRows || `<tr><td colspan="4" class="empty">No data.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card stat-card">
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
