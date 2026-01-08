const API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

const form = document.getElementById("searchForm");
const loadMoreBtn = document.getElementById("loadMore");
const searchNextBtn = document.getElementById("searchNext");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");

let nextToken = null;
let lastParams = null; // API向けクエリ（year等整形済み）
let lastState = null; // URL同期用の状態（yearFrom/yearTo等を保持）
let totalLoaded = 0;
let maxResultsLimit = null;
let maxCitationLimit = null;
let currentMinCitation = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function esc(s) {
  return (s ?? "").toString().replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

function updateCurrentMinCitation(papers) {
  if (!papers || papers.length === 0) return;
  let min = currentMinCitation ?? Infinity;
  for (const p of papers) {
    const cited = p.citationCount ?? 0;
    if (cited < min) min = cited;
  }
  if (Number.isFinite(min)) currentMinCitation = min;
  if (searchNextBtn) searchNextBtn.disabled = currentMinCitation === null;
}

function renderRows(papers, selectedVenueForDisplay) {
  for (const p of papers) {
    const tr = document.createElement("tr");

    const title = esc(p.title);
    const year = esc(p.year);
    const citedBy = p.citationCount ?? 0;

    // 表示用Venue:
    // 検索で venue 指定している場合はそれを優先表示、なければAPIの venue を表示
    const venueDisplay = selectedVenueForDisplay
      ? esc(selectedVenueForDisplay)
      : esc((p.venue ?? "").trim());

    const url = p.url ? esc(p.url) : null;
    const titleCellHtml = url
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : title;

    tr.innerHTML = `
      <td class="colTitle">${titleCellHtml}</td>
      <td class="colVenue">${venueDisplay}</td>
      <td class="colYear">${year}</td>
      <td class="colCited">${citedBy}</td>
    `;

    resultsBody.appendChild(tr);
  }
}

async function fetchBulk(params, token = null) {
  const qp = new URLSearchParams(params);
  if (token) qp.set("token", token);

  const url = `${API_BASE}?${qp.toString()}`;
  const res = await fetch(url, { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function isValidYear(s) {
  if (!s) return false;
  const t = s.toString().trim();
  if (!/^\d{4}$/.test(t)) return false;
  const n = Number(t);
  return n >= 1800 && n <= 2100;
}

function yearRangeToApiParam(yearFrom, yearTo) {
  const fromOk = isValidYear(yearFrom);
  const toOk = isValidYear(yearTo);

  if (fromOk && toOk) {
    const f = Number(yearFrom),
      t = Number(yearTo);
    if (f > t) return `${t}-${f}`;
    return `${f}-${t}`;
  }
  if (fromOk && !toOk) return `${Number(yearFrom)}-`;
  if (!fromOk && toOk) return `-${Number(yearTo)}`;
  return null;
}

function parseIntLimit(value, min) {
  const t = (value ?? "").toString().trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min) return null;
  return i;
}

function pickVenue(state) {
  // 自由入力を優先。空ならプリセット。両方空なら null。
  const vt = (state.venueText ?? "").toString().trim();
  if (vt) return vt;
  const vp = (state.venuePreset ?? "").toString().trim();
  if (vp) return vp;
  return null;
}

function buildStateFromForm(formData) {
  return {
    query: (formData.get("query") ?? "").toString().trim(),
    yearFrom: (formData.get("yearFrom") ?? "").toString().trim(),
    yearTo: (formData.get("yearTo") ?? "").toString().trim(),
    venuePreset: (formData.get("venuePreset") ?? "").toString().trim(),
    venueText: (formData.get("venueText") ?? "").toString().trim(),
    minCitationCount: (formData.get("minCitationCount") ?? "")
      .toString()
      .trim(),
    maxCitationCount: (formData.get("maxCitationCount") ?? "")
      .toString()
      .trim(),
    maxResults: (formData.get("maxResults") ?? "").toString().trim(),
  };
}

function buildApiParamsFromState(state) {
  const params = {
    fields: "title,year,url,venue,citationCount",
    sort: "citationCount:desc",
  };

  // Queryは空でも可：空ならパラメータ自体を送らない
  if (state.query) params.query = state.query;

  const yearParam = yearRangeToApiParam(state.yearFrom, state.yearTo);
  if (yearParam) params.year = yearParam;

  const venue = pickVenue(state);
  if (venue) params.venue = venue;

  if (state.minCitationCount !== "")
    params.minCitationCount = state.minCitationCount;

  return params;
}

function syncUrlFromState(state, { replace = true } = {}) {
  const url = new URL(window.location.href);

  const setOrDelete = (key, val) => {
    const v = (val ?? "").toString().trim();
    if (v) url.searchParams.set(key, v);
    else url.searchParams.delete(key);
  };

  setOrDelete("query", state.query);
  setOrDelete("yearFrom", state.yearFrom);
  setOrDelete("yearTo", state.yearTo);
  setOrDelete("venuePreset", state.venuePreset);
  setOrDelete("venueText", state.venueText);
  setOrDelete("minCitationCount", state.minCitationCount);
  setOrDelete("maxCitationCount", state.maxCitationCount);
  setOrDelete("maxResults", state.maxResults);

  const newUrl =
    url.pathname +
    (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
    url.hash;

  if (replace) history.replaceState(null, "", newUrl);
  else history.pushState(null, "", newUrl);
}

function readStateFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return {
    query: (sp.get("query") ?? "").toString(),
    yearFrom: (sp.get("yearFrom") ?? "").toString(),
    yearTo: (sp.get("yearTo") ?? "").toString(),
    venuePreset: (sp.get("venuePreset") ?? "").toString(),
    venueText: (sp.get("venueText") ?? "").toString(),
    minCitationCount: (sp.get("minCitationCount") ?? "").toString(),
    maxCitationCount: (sp.get("maxCitationCount") ?? "").toString(),
    maxResults: (sp.get("maxResults") ?? "").toString(),
  };
}

function applyStateToForm(state) {
  const q = form.elements.namedItem("query");
  const yf = form.elements.namedItem("yearFrom");
  const yt = form.elements.namedItem("yearTo");
  const vp = form.elements.namedItem("venuePreset");
  const vt = form.elements.namedItem("venueText");
  const mc = form.elements.namedItem("minCitationCount");
  const xc = form.elements.namedItem("maxCitationCount");
  const mr = form.elements.namedItem("maxResults");

  if (q) q.value = state.query ?? "";
  if (yf) yf.value = state.yearFrom ?? "";
  if (yt) yt.value = state.yearTo ?? "";
  if (vp) vp.value = state.venuePreset ?? "";
  if (vt) vt.value = state.venueText ?? "";
  if (mc) mc.value = state.minCitationCount ?? "";
  if (xc) xc.value = state.maxCitationCount ?? "";
  if (mr) mr.value = state.maxResults ?? "";
}

async function runSearch(reset = true) {
  try {
    setStatus("Loading...");
    loadMoreBtn.disabled = true;

    const data = await fetchBulk(lastParams, reset ? null : nextToken);

    nextToken = data.token ?? null;

    const papers = data.data ?? [];
    let filteredPapers = papers;

    if (maxCitationLimit !== null) {
      filteredPapers = papers.filter(
        (p) => (p.citationCount ?? 0) <= maxCitationLimit
      );
    }

    const remaining =
      maxResultsLimit !== null ? maxResultsLimit - totalLoaded : null;

    if (remaining !== null && remaining <= 0) {
      nextToken = null;
      loadMoreBtn.disabled = true;
      setStatus(`Loaded ${totalLoaded} papers / ${maxResultsLimit}`);
      return;
    }

    if (remaining !== null) {
      filteredPapers = filteredPapers.slice(0, remaining);
    }

    // 表示用venue（自由入力 or プリセット）※API未指定なら空
    const venueForDisplay = pickVenue(lastState) ?? "";
    renderRows(filteredPapers, venueForDisplay);
    updateCurrentMinCitation(filteredPapers);

    totalLoaded += filteredPapers.length;

    const reachedMax =
      maxResultsLimit !== null && totalLoaded >= maxResultsLimit;
    if (reachedMax) nextToken = null;

    loadMoreBtn.disabled = !nextToken || reachedMax;

    let statusMsg = `Loaded ${totalLoaded} papers`;
    if (maxResultsLimit !== null) statusMsg += ` / ${maxResultsLimit}`;
    if (nextToken && !reachedMax) statusMsg += " (more available)";
    setStatus(statusMsg);
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

async function startNewSearchFromState(state, { urlMode = "replace" } = {}) {
  // URL同期（検索条件共有のため、空queryでも同期する）
  syncUrlFromState(state, { replace: urlMode === "replace" });

  // 「完全に空の検索」は避ける（事故的に巨大取得になるのを防ぐ）
  // ただし、year/venue/minCitationCountのいずれかがあればOK
  const hasAnyFilter =
    !!state.query ||
    isValidYear(state.yearFrom) ||
    isValidYear(state.yearTo) ||
    !!pickVenue(state) ||
    (state.minCitationCount ?? "").toString().trim() !== "" ||
    (state.maxCitationCount ?? "").toString().trim() !== "";

  if (!hasAnyFilter) {
    setStatus(
      "Please set at least one condition (query/year/venue/min/maxCitationCount)."
    );
    return;
  }

  resultsBody.innerHTML = "";
  nextToken = null;

  lastState = state;
  lastParams = buildApiParamsFromState(state);
  totalLoaded = 0;
  maxCitationLimit = parseIntLimit(state.maxCitationCount, 0);
  maxResultsLimit = parseIntLimit(state.maxResults, 1);
  currentMinCitation = null;
  if (searchNextBtn) searchNextBtn.disabled = true;

  await runSearch(true);
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(form);
  const state = buildStateFromForm(fd);
  await startNewSearchFromState(state, { urlMode: "push" });
});

loadMoreBtn.addEventListener("click", async () => {
  if (!nextToken) return;
  await runSearch(false);
});

if (searchNextBtn) {
  searchNextBtn.addEventListener("click", async () => {
    if (currentMinCitation === null) {
      setStatus("No papers loaded yet.");
      return;
    }
    const nextMaxCitation = Math.max(0, currentMinCitation - 1);
    const maxCitationInput = form.elements.namedItem("maxCitationCount");
    if (maxCitationInput) {
      maxCitationInput.value = nextMaxCitation.toString();
    }
    const fd = new FormData(form);
    const state = buildStateFromForm(fd);
    await startNewSearchFromState(state, { urlMode: "push" });
  });
}

// 初期化：URL -> フォーム復元 -> 自動検索（何らかの条件があれば）
(function init() {
  const state = readStateFromUrl();
  applyStateToForm(state);

  const hasAny =
    !!state.query ||
    isValidYear(state.yearFrom) ||
    isValidYear(state.yearTo) ||
    !!pickVenue(state) ||
    (state.minCitationCount ?? "").toString().trim() !== "" ||
    (state.maxCitationCount ?? "").toString().trim() !== "";

  if (hasAny) {
    startNewSearchFromState(state, { urlMode: "replace" });
  }
})();
