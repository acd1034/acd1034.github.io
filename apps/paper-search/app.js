const API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

const form = document.getElementById("searchForm");
const loadMoreBtn = document.getElementById("loadMore");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");

let nextToken = null;
let lastParams = null; // API向けクエリ（year等整形済み）
let lastState = null; // URL同期用の状態（yearFrom/yearToを保持）

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

function renderRows(papers, selectedVenue) {
  for (const p of papers) {
    const tr = document.createElement("tr");

    const title = esc(p.title);
    const year = esc(p.year);
    const citedBy = p.citationCount ?? 0;

    // 表示用Venue（プリセット選択がある場合はその略称を優先）
    const venueDisplay = selectedVenue
      ? esc(selectedVenue)
      : esc((p.venue ?? "").trim());

    // Titleは論文URL付き
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
    if (f > t) {
      // 入力ミス時は入れ替えて扱う（UI側でエラーにしたければここでthrow）
      return `${t}-${f}`;
    }
    return `${f}-${t}`;
  }
  if (fromOk && !toOk) return `${Number(yearFrom)}-`;
  if (!fromOk && toOk) return `-${Number(yearTo)}`;
  return null;
}

function buildStateFromForm(formData) {
  return {
    query: (formData.get("query") ?? "").toString().trim(),
    yearFrom: (formData.get("yearFrom") ?? "").toString().trim(),
    yearTo: (formData.get("yearTo") ?? "").toString().trim(),
    venue: (formData.get("venue") ?? "").toString().trim(),
    minCitationCount: (formData.get("minCitationCount") ?? "")
      .toString()
      .trim(),
  };
}

function buildApiParamsFromState(state) {
  const params = {
    query: state.query,
    fields: "title,year,url,venue,citationCount",
    sort: "citationCount:desc",
  };

  const yearParam = yearRangeToApiParam(state.yearFrom, state.yearTo);
  if (yearParam) params.year = yearParam;

  if (state.venue) params.venue = state.venue;

  if (state.minCitationCount !== "")
    params.minCitationCount = state.minCitationCount;

  return params;
}

/** URLクエリに state を同期（空値は削除して短くする） */
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
  setOrDelete("venue", state.venue);
  setOrDelete("minCitationCount", state.minCitationCount);

  // tokenやページング状態はURLに載せない（共有時に常に先頭から）
  const newUrl =
    url.pathname +
    (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
    url.hash;

  if (replace) history.replaceState(null, "", newUrl);
  else history.pushState(null, "", newUrl);
}

/** URLクエリから state を復元 */
function readStateFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return {
    query: (sp.get("query") ?? "").toString(),
    yearFrom: (sp.get("yearFrom") ?? "").toString(),
    yearTo: (sp.get("yearTo") ?? "").toString(),
    venue: (sp.get("venue") ?? "").toString(),
    minCitationCount: (sp.get("minCitationCount") ?? "").toString(),
  };
}

function applyStateToForm(state) {
  const q = form.elements.namedItem("query");
  const yf = form.elements.namedItem("yearFrom");
  const yt = form.elements.namedItem("yearTo");
  const v = form.elements.namedItem("venue");
  const mc = form.elements.namedItem("minCitationCount");

  if (q) q.value = state.query ?? "";
  if (yf) yf.value = state.yearFrom ?? "";
  if (yt) yt.value = state.yearTo ?? "";
  if (v) v.value = state.venue ?? "";
  if (mc) mc.value = state.minCitationCount ?? "";
}

async function runSearch(reset = true) {
  try {
    setStatus("Loading...");
    loadMoreBtn.disabled = true;

    const data = await fetchBulk(lastParams, reset ? null : nextToken);

    nextToken = data.token ?? null;
    loadMoreBtn.disabled = !nextToken;

    const papers = data.data ?? [];

    const selectedVenue = (lastParams?.venue ?? "").toString().trim();
    renderRows(papers, selectedVenue);

    setStatus(
      `Loaded ${papers.length} papers${nextToken ? " (more available)" : ""}`
    );
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

async function startNewSearchFromState(state, { urlMode = "replace" } = {}) {
  // 必須queryチェック（空なら何もしない）
  if (!state.query) {
    setStatus("Query is required.");
    return;
  }

  // URL同期
  syncUrlFromState(state, { replace: urlMode === "replace" });

  // 検索状態更新
  resultsBody.innerHTML = "";
  nextToken = null;

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

/** 初期化：URL -> フォーム復元 -> 自動検索（queryがあれば） */
(function init() {
  const state = readStateFromUrl();
  applyStateToForm(state);

  if (state.query) {
    // 初期ロード時は replace でURLを整形（空値除去など）
    startNewSearchFromState(state, { urlMode: "replace" });
  }
})();
