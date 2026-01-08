const API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search/bulk";

const form = document.getElementById("searchForm");
const resultsEl = document.getElementById("results");
const loadMoreBtn = document.getElementById("loadMore");
const statusEl = document.getElementById("status");

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

function renderPapers(papers) {
  for (const p of papers) {
    const li = document.createElement("li");
    const title = esc(p.title);
    const year = esc(p.year);
    const citations = p.citationCount ?? 0;
    const url = p.url ? esc(p.url) : null;
    const venue = esc(p.venue);
    const authors = (p.authors ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .slice(0, 8)
      .join(", ");

    li.innerHTML = `
      <div class="paper">
        <div class="title">
          ${
            url
              ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>`
              : title
          }
        </div>
        <div class="meta">
          <span>${year}</span>
          <span>citations: ${citations}</span>
          ${venue ? `<span>venue: ${venue}</span>` : ""}
        </div>
        <div class="authors">${esc(authors)}</div>
      </div>
    `;
    resultsEl.appendChild(li);
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
  // fields: 必要最小限 + citationCount
  const params = {
    query: formData.get("query"),
    fields: "title,year,authors,url,venue,citationCount",
    sort: "citationCount:desc",
  };

  const year = formData.get("year")?.toString().trim();
  if (year) params.year = year;

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

    // token があれば次ページあり
    nextToken = data.token ?? null;
    loadMoreBtn.disabled = !nextToken;

    const papers = data.data ?? [];
    renderPapers(papers);

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
  resultsEl.innerHTML = "";
  nextToken = null;

  const fd = new FormData(form);
  lastParams = buildParams(fd);
  await runSearch(true);
});

loadMoreBtn.addEventListener("click", async () => {
  if (!nextToken) return;
  await runSearch(false);
});
