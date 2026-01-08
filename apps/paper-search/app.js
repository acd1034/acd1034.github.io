const API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

const form = document.getElementById("searchForm");
const loadMoreBtn = document.getElementById("loadMore");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");

let nextToken = null;
let lastParams = null;

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

function normalizeVenueShort(venueStr) {
  // 返ってくる venue は "Proceedings of ..." 等になりうるので、
  // プリセットが指定されている場合はその値を優先して表示する。
  // それ以外は API から返った venue をそのまま表示。
  const v = (venueStr ?? "").trim();
  return v;
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
      : esc(normalizeVenueShort(p.venue));

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

function buildParams(formData) {
  const params = {
    query: formData.get("query"),
    fields: "title,year,url,venue,citationCount",
    sort: "citationCount:desc",
  };

  const year = formData.get("year")?.toString().trim();
  if (year) params.year = year;

  // プリセットvenue（空なら指定なし）
  const venue = formData.get("venue")?.toString().trim();
  if (venue) params.venue = venue;

  const minC = formData.get("minCitationCount")?.toString().trim();
  if (minC) params.minCitationCount = minC;

  return params;
}

async function runSearch(reset = true) {
  try {
    setStatus("Loading...");
    loadMoreBtn.disabled = true;

    const data = await fetchBulk(lastParams, reset ? null : nextToken);

    nextToken = data.token ?? null;
    loadMoreBtn.disabled = !nextToken;

    const papers = data.data ?? [];

    // 表示用に「選択したvenue」を渡す（空ならAPIのvenueをそのまま）
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

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  // リセット
  resultsBody.innerHTML = "";
  nextToken = null;

  const fd = new FormData(form);
  lastParams = buildParams(fd);

  await runSearch(true);
});

loadMoreBtn.addEventListener("click", async () => {
  if (!nextToken) return;
  await runSearch(false);
});
