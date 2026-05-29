import { normalizeSymbolInput } from "/shared/symbols.js";

const form = document.querySelector("#analysisForm");
const input = document.querySelector("#symbolInput");
const error = document.querySelector("#symbolError");
const suggestions = document.querySelector("#suggestions");
const submitButton = document.querySelector("#submitButton");
const statusPill = document.querySelector("#statusPill");
const resultPanel = document.querySelector("#resultPanel");
const emptyPanel = document.querySelector("#emptyPanel");
const tables = document.querySelector("#tables");
const resultSymbol = document.querySelector("#resultSymbol");
const venueLabel = document.querySelector("#venueLabel");
const generatedAt = document.querySelector("#generatedAt");

let suggestionTimer;
let activeSuggestionRequest = 0;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideSuggestions();

  const normalized = normalizeSymbolInput(input.value);
  if (!normalized.ok) {
    showError(normalized.error);
    return;
  }

  setLoading(true);
  showError("");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: normalized.normalized }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error ?? "Analiz alınamadı.");
    renderResult(payload);
  } catch (err) {
    showError(err.message);
    statusPill.textContent = "Hata";
  } finally {
    setLoading(false);
  }
});

input.addEventListener("input", () => {
  const normalized = normalizeSymbolInput(input.value);
  showError(normalized.ok || !input.value.trim() ? "" : normalized.error);

  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(() => loadSuggestions(input.value), 180);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideSuggestions();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#symbolBox")) hideSuggestions();
});

async function loadSuggestions(query) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 1) {
    hideSuggestions();
    return;
  }

  const requestId = ++activeSuggestionRequest;
  try {
    const response = await fetch(`/api/suggestions?q=${encodeURIComponent(normalizedQuery)}`);
    const payload = await readJsonResponse(response);
    if (requestId !== activeSuggestionRequest) return;
    renderSuggestions(payload.suggestions ?? []);
  } catch {
    hideSuggestions();
  }
}

function renderSuggestions(items) {
  suggestions.replaceChildren();
  if (!items.length) {
    hideSuggestions();
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left text-sm text-slate-800 transition last:border-b-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none";

    const symbol = document.createElement("span");
    symbol.className = "font-semibold";
    symbol.textContent = item.symbol;

    const venue = document.createElement("small");
    venue.className = "text-xs font-medium text-slate-500";
    venue.textContent = item.venue;

    button.append(symbol, venue);
    button.addEventListener("click", () => {
      input.value = item.symbol;
      hideSuggestions();
      input.focus();
    });
    suggestions.append(button);
  }

  suggestions.hidden = false;
}

function renderResult(payload) {
  resultSymbol.textContent = payload.symbol;
  venueLabel.textContent = payload.venue === "MEXC_PERP" ? "MEXC Perpetual Futures" : "Binance Spot";
  generatedAt.textContent = formatDate(payload.generatedAt);
  generatedAt.dateTime = payload.generatedAt;
  tables.replaceChildren(...formatAnalysisToHTML(payload.analysis));
  resultPanel.hidden = false;
  emptyPanel.hidden = true;
  statusPill.textContent = "Tamamlandı";
}

function formatAnalysisToHTML(text) {
  return parsePlainTextTables(text).map(renderTableCard);
}

function parsePlainTextTables(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (line.toUpperCase().startsWith("TABLO:")) {
      if (current) blocks.push(current);
      current = { title: line.slice(6).trim() || "Analiz", rows: [] };
      continue;
    }

    if (!current) current = { title: "Analiz", rows: [] };
    current.rows.push(line.split("|").map((cell) => cell.trim()));
  }

  if (current) blocks.push(current);
  return blocks.length ? blocks : [{ title: "Analiz", rows: [["Sonuç"], [text]] }];
}

function renderTableCard(block) {
  const section = document.createElement("section");
  section.className = "mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";

  const titleWrap = document.createElement("div");
  titleWrap.className = "border-b border-slate-200 px-5 py-4";

  const title = document.createElement("h3");
  title.className = "text-base font-semibold text-slate-950";
  title.textContent = block.title;
  titleWrap.append(title);

  const tableWrap = document.createElement("div");
  tableWrap.className = "overflow-x-auto";

  const table = document.createElement("table");
  table.className = "min-w-full divide-y divide-slate-200";

  const [head = ["Alan", "Değer"], ...body] = block.rows;
  const columnCount = Math.max(head.length, ...body.map((row) => row.length), 1);

  const thead = document.createElement("thead");
  thead.className = "bg-slate-50 text-xs uppercase font-semibold text-slate-500 tracking-wider";

  const headRow = document.createElement("tr");
  normalizeRow(head, columnCount).forEach((cell) => {
    const th = document.createElement("th");
    th.className = "px-5 py-3 text-left";
    th.textContent = cell;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-slate-100 bg-white";

  body.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = "align-top";

    normalizeRow(row, columnCount).forEach((cell) => {
      const td = document.createElement("td");
      td.className = "px-5 py-4 text-sm text-slate-700";
      td.append(formatCellContent(cell));
      tr.append(td);
    });

    tbody.append(tr);
  });

  table.append(thead, tbody);
  tableWrap.append(table);
  section.append(titleWrap, tableWrap);
  return section;
}

function formatCellContent(text) {
  const badgeClass = getBadgeClass(text);
  if (!badgeClass) return document.createTextNode(text);

  const badge = document.createElement("span");
  badge.className = badgeClass;
  badge.textContent = text;
  return badge;
}

function getBadgeClass(text) {
  const normalized = String(text ?? "").toLocaleLowerCase("tr-TR");
  const base = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";

  if (["kırılım", "aşağı", "düşüş", "short", "stop", "riskli", "iptal", "sfp"].some((term) => normalized.includes(term))) {
    return `${base} bg-red-100 text-red-800`;
  }

  if (["yükseliş", "yukarı", "long", "mitigation", "hedef", "tp", "breaker var"].some((term) => normalized.includes(term))) {
    return `${base} bg-emerald-100 text-emerald-800`;
  }

  if (["konsolidasyon", "likidite alımı", "bekle", "absorpsiyon", "emilim", "veri sınırlı"].some((term) => normalized.includes(term))) {
    return `${base} bg-amber-100 text-amber-800`;
  }

  return "";
}

function normalizeRow(row, length) {
  return Array.from({ length }, (_, index) => row[index] ?? "");
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Analiz Ediliyor" : "Analiz Et";
  statusPill.textContent = isLoading ? "Veri alınıyor" : "Hazır";
}

function hideSuggestions() {
  suggestions.hidden = true;
  suggestions.replaceChildren();
}

function showError(message) {
  error.textContent = message;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const message =
      response.status === 404
        ? "API endpoint bulunamadı. Deploy edilen servis backend olarak çalışmıyor veya yanlış URL açılmış."
        : `Sunucu JSON olmayan cevap döndürdü: ${text.slice(0, 120)}`;
    return { error: message };
  }
}
