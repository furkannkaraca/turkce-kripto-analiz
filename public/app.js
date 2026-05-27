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
  if (!event.target.closest(".symbol-box")) hideSuggestions();
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
    button.className = "suggestion";
    button.innerHTML = `<span>${escapeHtml(item.symbol)}</span><small>${escapeHtml(item.venue)}</small>`;
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
  tables.replaceChildren(...parsePlainTextTables(payload.analysis).map(renderTableBlock));
  resultPanel.hidden = false;
  emptyPanel.hidden = true;
  statusPill.textContent = "Tamamlandı";
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

function renderTableBlock(block) {
  const section = document.createElement("section");
  section.className = "table-block";

  const title = document.createElement("h3");
  title.textContent = block.title;

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";

  const table = document.createElement("table");
  const [head = ["Alan", "Değer"], ...body] = block.rows;
  const columnCount = Math.max(head.length, ...body.map((row) => row.length), 1);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  normalizeRow(head, columnCount).forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  body.forEach((row) => {
    const tr = document.createElement("tr");
    normalizeRow(row, columnCount).forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  wrap.append(table);
  section.append(title, wrap);
  return section;
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
    const message = response.status === 404
      ? "API endpoint bulunamadı. Deploy edilen servis backend olarak çalışmıyor veya yanlış URL açılmış."
      : `Sunucu JSON olmayan cevap döndürdü: ${text.slice(0, 120)}`;
    return { error: message };
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
