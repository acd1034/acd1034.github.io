const API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

const form = document.getElementById("searchForm");
const loadMoreBtn = document.getElementById("loadMore");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");

const DEFAULT_PAGE_SIZE = 20;

let nextToken = null;
let lastParams = null; // API向けクエリ（year等整形済み）
let lastState = null; // URL同期用の状態（yearFrom/yearTo等を保持）
let allPapers = [];
let currentPage = 1;
let pageSize = DEFAULT_PAGE_SIZE;

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

function normalizePageSize(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return n;
}

function clampPage() {
  const totalPages = allPapers.length
    ? Math.ceil(allPapers.length / pageSize)
    : 0;
  if (totalPages === 0) {
    currentPage = 1;
    return totalPages;
  }
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;
  return totalPages;
}

function updatePageButtons(totalPages) {
  if (!prevPageBtn || !nextPageBtn) return;
  if (totalPages === 0) {
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function renderPage() {
  const totalPages = clampPage();
  const total = allPapers.length;
  resultsBody.innerHTML = "";

  if (total === 0) {
    updatePageButtons(totalPages);
    setStatus("No results.");
    return;
  }

  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = allPapers.slice(startIndex, startIndex + pageSize);

  const venueForDisplay = pickVenue(lastState) ?? "";
  renderRows(pageItems, venueForDisplay);

  const endIndex = startIndex + pageItems.length;
  const moreNote = nextToken ? " (more available)" : "";
  setStatus(`Showing ${startIndex + 1}-${endIndex} of ${total}${moreNote}`);
  updatePageButtons(totalPages);
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
    pageSize: (formData.get("pageSize") ?? "").toString().trim(),
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
  setOrDelete("pageSize", state.pageSize);

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
    pageSize: (sp.get("pageSize") ?? "").toString(),
  };
}

function applyStateToForm(state) {
  const q = form.elements.namedItem("query");
  const yf = form.elements.namedItem("yearFrom");
  const yt = form.elements.namedItem("yearTo");
  const vp = form.elements.namedItem("venuePreset");
  const vt = form.elements.namedItem("venueText");
  const mc = form.elements.namedItem("minCitationCount");
  const ps = form.elements.namedItem("pageSize");

  if (q) q.value = state.query ?? "";
  if (yf) yf.value = state.yearFrom ?? "";
  if (yt) yt.value = state.yearTo ?? "";
  if (vp) vp.value = state.venuePreset ?? "";
  if (vt) vt.value = state.venueText ?? "";
  if (mc) mc.value = state.minCitationCount ?? "";
  if (ps) ps.value = state.pageSize ?? ps.value ?? "";
}

async function runSearch(reset = true) {
  try {
    setStatus("Loading...");
    loadMoreBtn.disabled = true;

    const data = await fetchBulk(lastParams, reset ? null : nextToken);

    nextToken = data.token ?? null;
    loadMoreBtn.disabled = !nextToken;

    const papers = data.data ?? [];

    if (reset) {
      allPapers = [];
      currentPage = 1;
    }
    allPapers = allPapers.concat(papers);

    renderPage();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

async function startNewSearchFromState(state, { urlMode = "replace" } = {}) {
  const normalizedPageSize = normalizePageSize(state.pageSize);
  pageSize = normalizedPageSize;
  state.pageSize = normalizedPageSize.toString();

  // URL同期（検索条件共有のため、空queryでも同期する）
  syncUrlFromState(state, { replace: urlMode === "replace" });

  // 「完全に空の検索」は避ける（事故的に巨大取得になるのを防ぐ）
  // ただし、year/venue/minCitationCountのいずれかがあればOK
  const hasAnyFilter =
    !!state.query ||
    isValidYear(state.yearFrom) ||
    isValidYear(state.yearTo) ||
    !!pickVenue(state) ||
    (state.minCitationCount ?? "").toString().trim() !== "";

  if (!hasAnyFilter) {
    setStatus(
      "Please set at least one condition (query/year/venue/minCitationCount)."
    );
    return;
  }

  resultsBody.innerHTML = "";
  nextToken = null;
  allPapers = [];
  currentPage = 1;

  lastState = state;
  lastParams = buildApiParamsFromState(state);

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

prevPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  renderPage();
});

nextPageBtn.addEventListener("click", () => {
  const totalPages = allPapers.length
    ? Math.ceil(allPapers.length / pageSize)
    : 0;
  if (currentPage >= totalPages) return;
  currentPage += 1;
  renderPage();
});

// 初期化：URL -> フォーム復元 -> 自動検索（何らかの条件があれば）
(function init() {
  const state = readStateFromUrl();
  const normalizedPageSize = normalizePageSize(state.pageSize);
  pageSize = normalizedPageSize;
  state.pageSize = normalizedPageSize.toString();
  applyStateToForm(state);

  const hasAny =
    !!state.query ||
    isValidYear(state.yearFrom) ||
    isValidYear(state.yearTo) ||
    !!pickVenue(state) ||
    (state.minCitationCount ?? "").toString().trim() !== "";

  if (hasAny) {
    startNewSearchFromState(state, { urlMode: "replace" });
  }
})();
