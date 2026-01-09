const API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

const form = document.getElementById("searchForm");
const loadMoreBtn = document.getElementById("loadMore");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");

const DEFAULT_PAGE_SIZE = 10;

let nextToken = null;
let lastParams = null; // API向けクエリ（year等整形済み）
let lastState = null; // URL同期用の状態（yearFrom/yearTo等を保持）
let allPapers = [];
let currentPage = 1;
let pageSize = DEFAULT_PAGE_SIZE;

function toTrimmedString(value) {
  return (value ?? "").toString().trim();
}

function getMinCitationCount(papers) {
  if (!papers.length) return null;
  let min = Infinity;
  for (const p of papers) {
    const count = Number.isFinite(p.citationCount) ? p.citationCount : 0;
    if (count < min) min = count;
  }
  return Number.isFinite(min) ? min : null;
}

function updateDocumentTitle(pageItems) {
  if (!lastState) return;
  const parts = [];
  const query = toTrimmedString(lastState.query);
  if (query) parts.push(query);

  const venue = toTrimmedString(pickVenue(lastState));
  if (venue) parts.push(venue);

  const from = toTrimmedString(lastState.yearFrom);
  const to = toTrimmedString(lastState.yearTo);
  if (from || to) parts.push(`${from}-${to}`);

  const minCitation = getMinCitationCount(pageItems);
  if (minCitation !== null) parts.push(`Citation≥${minCitation}`);

  if (parts.length) document.title = parts.join(", ");
}

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

function normalizeCurrentPage(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function getTotalPages(totalItems) {
  return totalItems ? Math.ceil(totalItems / pageSize) : 0;
}

function normalizePagingState(state) {
  const normalizedPageSize = normalizePageSize(state.pageSize);
  const normalizedCurrentPage = normalizeCurrentPage(state.currentPage);
  pageSize = normalizedPageSize;
  currentPage = normalizedCurrentPage;
  state.pageSize = normalizedPageSize.toString();
  state.currentPage = normalizedCurrentPage.toString();
}

function syncCurrentPageToState() {
  if (!lastState) return;
  lastState.currentPage = currentPage.toString();
  syncUrlFromState(lastState, { replace: true });
}

function clampPage() {
  const totalPages = getTotalPages(allPapers.length);
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
  syncCurrentPageToState();
  const total = allPapers.length;
  resultsBody.innerHTML = "";

  if (total === 0) {
    updateDocumentTitle([]);
    updatePageButtons(totalPages);
    setStatus("No results.");
    return;
  }

  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = allPapers.slice(startIndex, startIndex + pageSize);

  const venueForDisplay = pickVenue(lastState) ?? "";
  renderRows(pageItems, venueForDisplay);
  updateDocumentTitle(pageItems);

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
  const t = toTrimmedString(s);
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
  const vt = toTrimmedString(state.venueText);
  if (vt) return vt;
  const vp = toTrimmedString(state.venuePreset);
  if (vp) return vp;
  return null;
}

function buildStateFromForm(formData) {
  return {
    query: toTrimmedString(formData.get("query")),
    venuePreset: toTrimmedString(formData.get("venuePreset")),
    venueText: toTrimmedString(formData.get("venueText")),
    yearFrom: toTrimmedString(formData.get("yearFrom")),
    yearTo: toTrimmedString(formData.get("yearTo")),
    minCitationCount: toTrimmedString(formData.get("minCitationCount")),
    pageSize: toTrimmedString(formData.get("pageSize")),
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

function hasAnyFilter(state) {
  return (
    !!state.query ||
    !!pickVenue(state) ||
    isValidYear(state.yearFrom) ||
    isValidYear(state.yearTo) ||
    toTrimmedString(state.minCitationCount) !== ""
  );
}

function syncUrlFromState(state, { replace = true } = {}) {
  const url = new URL(window.location.href);

  const setOrDelete = (key, val) => {
    const v = toTrimmedString(val);
    if (v) url.searchParams.set(key, v);
    else url.searchParams.delete(key);
  };

  setOrDelete("query", state.query);
  setOrDelete("venuePreset", state.venuePreset);
  setOrDelete("venueText", state.venueText);
  setOrDelete("yearFrom", state.yearFrom);
  setOrDelete("yearTo", state.yearTo);
  setOrDelete("minCitationCount", state.minCitationCount);
  setOrDelete("currentPage", state.currentPage);
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
    venuePreset: (sp.get("venuePreset") ?? "").toString(),
    venueText: (sp.get("venueText") ?? "").toString(),
    yearFrom: (sp.get("yearFrom") ?? "").toString(),
    yearTo: (sp.get("yearTo") ?? "").toString(),
    minCitationCount: (sp.get("minCitationCount") ?? "").toString(),
    currentPage: (sp.get("currentPage") ?? "").toString(),
    pageSize: (sp.get("pageSize") ?? "").toString(),
  };
}

function applyStateToForm(state) {
  const q = form.elements.namedItem("query");
  const vp = form.elements.namedItem("venuePreset");
  const vt = form.elements.namedItem("venueText");
  const yf = form.elements.namedItem("yearFrom");
  const yt = form.elements.namedItem("yearTo");
  const mc = form.elements.namedItem("minCitationCount");
  const ps = form.elements.namedItem("pageSize");

  if (q) q.value = state.query ?? "";
  if (vp) vp.value = state.venuePreset ?? "";
  if (vt) vt.value = state.venueText ?? "";
  if (yf) yf.value = state.yearFrom ?? "";
  if (yt) yt.value = state.yearTo ?? "";
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
    }
    allPapers = allPapers.concat(papers);

    renderPage();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

async function startNewSearchFromState(state, { urlMode = "replace" } = {}) {
  normalizePagingState(state);

  // URL同期（検索条件共有のため、空queryでも同期する）
  syncUrlFromState(state, { replace: urlMode === "replace" });

  // 「完全に空の検索」は避ける（事故的に巨大取得になるのを防ぐ）
  // ただし、query/venue/year/minCitationCountのいずれかがあればOK
  if (!hasAnyFilter(state)) {
    setStatus(
      "Please set at least one condition (query/venue/year/minCitationCount)."
    );
    return;
  }

  resultsBody.innerHTML = "";
  nextToken = null;
  allPapers = [];

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
  const totalPages = getTotalPages(allPapers.length);
  if (currentPage >= totalPages) return;
  currentPage += 1;
  renderPage();
});

// 初期化：URL -> フォーム復元 -> 自動検索（何らかの条件があれば）
(function init() {
  const state = readStateFromUrl();
  normalizePagingState(state);
  applyStateToForm(state);

  if (hasAnyFilter(state)) {
    startNewSearchFromState(state, { urlMode: "replace" });
  }
})();
