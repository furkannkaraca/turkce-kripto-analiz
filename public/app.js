import { normalizeSymbolInput } from "/shared/symbols.js";

const form = document.querySelector("#analysisForm");
const input = document.querySelector("#symbolInput");
const error = document.querySelector("#symbolError");
const suggestions = document.querySelector("#suggestions");
const submitButton = document.querySelector("#submitButton");
const statusPill = document.querySelector("#statusPill");
const resultPanel = document.querySelector("#resultPanel");
const emptyPanel = document.querySelector("#emptyPanel");
const loadingPanel = document.querySelector("#loadingPanel");
const loadingSteps = [...document.querySelectorAll("[data-loading-step]")];
const tables = document.querySelector("#tables");
const resultSymbol = document.querySelector("#resultSymbol");
const venueLabel = document.querySelector("#venueLabel");
const generatedAt = document.querySelector("#generatedAt");

let suggestionTimer;
let activeSuggestionRequest = 0;
let loadingTimer;
let loadingStepIndex = 0;

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
    statusPill.className =
      "inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700";
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
  const blocks = parsePlainTextTables(payload.analysis);
  resultSymbol.textContent = payload.symbol;
  venueLabel.textContent = payload.venue === "MEXC_PERP" ? "MEXC Perpetual Futures" : "Binance Spot";
  generatedAt.textContent = formatDate(payload.generatedAt);
  generatedAt.dateTime = payload.generatedAt;
  tables.replaceChildren(...formatAnalysisToHTML(blocks));
  resultPanel.hidden = false;
  emptyPanel.hidden = true;
  loadingPanel.hidden = true;
  statusPill.textContent = "Tamamlandı";
  statusPill.className =
    "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700";
}

function formatAnalysisToHTML(blocksOrText) {
  const blocks = Array.isArray(blocksOrText) ? blocksOrText : parsePlainTextTables(blocksOrText);
  return [...renderInsightCards(blocks), ...blocks.map(renderTableCard)];
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

function renderInsightCards(blocks) {
  const scenarioBlock = findBlock(blocks, "TAV Senaryo");
  const riskBlock = findBlock(blocks, "Risk Disiplini");
  const nodes = [];

  if (scenarioBlock) nodes.push(renderScenarioDashboard(scenarioBlock));
  if (riskBlock) nodes.push(renderRiskDashboard(riskBlock));

  return nodes;
}

function renderScenarioDashboard(block) {
  const section = document.createElement("section");
  section.className = "mb-6";

  const header = document.createElement("div");
  header.className = "mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between";
  header.innerHTML = `
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">İşlem Haritası</p>
      <h3 class="mt-1 text-xl font-semibold text-slate-950">TAV Senaryo Kartları</h3>
    </div>
    <p class="text-sm text-slate-500">Entry, hedef, stop ve 5m onay tek bakışta.</p>
  `;

  const grid = document.createElement("div");
  grid.className = "grid gap-4 lg:grid-cols-3";

  const rows = tableObjects(block);
  rows.forEach((row) => grid.append(renderScenarioCard(row)));

  section.append(header, grid);
  return section;
}

function renderScenarioCard(row) {
  const scenario = getValue(row, "SENARYO", "Senaryo") || "Senaryo";
  const tone = scenarioTone(scenario);
  const card = document.createElement("article");
  card.className = `rounded-2xl border bg-white p-5 shadow-sm ${tone.border}`;

  const title = document.createElement("div");
  title.className = "mb-4 flex items-center justify-between gap-3";
  title.innerHTML = `
    <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tone.badge}">${escapeText(scenario)}</span>
    <span class="text-xs font-medium text-slate-400">TAV</span>
  `;

  const metrics = document.createElement("div");
  metrics.className = "grid gap-3";
  [
    ["Giriş", getValue(row, "GİRİŞ", "GIRIS")],
    ["Hedef", getValue(row, "HEDEF")],
    ["Stop", getValue(row, "STOP")],
    ["5m Onay", getValue(row, "5M KONFİRMASYON", "5M KONFIRMASYON")],
    ["İptal", getValue(row, "İPTAL KOŞULU", "IPTAL KOSULU")],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "rounded-xl bg-slate-50 px-3 py-3";

    const labelEl = document.createElement("p");
    labelEl.className = "text-xs font-medium uppercase tracking-wider text-slate-400";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "mt-1 text-sm font-semibold text-slate-900";
    valueEl.append(formatCellContent(value || "Veri sınırlı"));

    item.append(labelEl, valueEl);
    metrics.append(item);
  });

  card.append(title, metrics);
  return card;
}

function renderRiskDashboard(block) {
  const section = document.createElement("section");
  section.className = "mb-6 rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm";

  const rows = tableObjects(block);
  const grid = document.createElement("div");
  grid.className = "mt-4 grid gap-3 md:grid-cols-3";

  rows.slice(0, 3).forEach((row) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border border-white/10 bg-white/5 p-4";
    card.innerHTML = `
      <p class="text-xs font-semibold uppercase tracking-wider text-emerald-300">${escapeText(getValue(row, "PARAMETRE") || "Parametre")}</p>
      <p class="mt-2 text-sm font-semibold text-white">${escapeText(getValue(row, "DEĞER") || "Veri sınırlı")}</p>
      <p class="mt-2 text-xs leading-5 text-slate-300">${escapeText(getValue(row, "R:R HESABI") || "")}</p>
      <p class="mt-2 text-xs font-medium text-emerald-200">${escapeText(getValue(row, "PNL BEKLENTİSİ", "PnL BEKLENTİSİ") || "")}</p>
    `;
    grid.append(card);
  });

  const title = document.createElement("div");
  title.innerHTML = `
    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Risk Motoru</p>
    <h3 class="mt-1 text-xl font-semibold">Kasa, kaldıraç ve R:R özeti</h3>
  `;

  section.append(title, grid);
  return section;
}

function renderTableCard(block) {
  const section = document.createElement("section");
  section.className = "mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm";

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

function tableObjects(block) {
  const [head = [], ...rows] = block.rows;
  return rows.map((row) => {
    const object = {};
    head.forEach((key, index) => {
      object[normalizeKey(key)] = row[index] ?? "";
    });
    return object;
  });
}

function getValue(row, ...keys) {
  for (const key of keys) {
    const value = row[normalizeKey(key)];
    if (value) return value;
  }
  return "";
}

function normalizeKey(key) {
  return String(key ?? "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, " ");
}

function findBlock(blocks, title) {
  const needle = title.toLocaleLowerCase("tr-TR");
  return blocks.find((block) => block.title.toLocaleLowerCase("tr-TR").includes(needle));
}

function scenarioTone(scenario) {
  const normalized = scenario.toLocaleLowerCase("tr-TR");
  if (normalized.includes("short")) {
    return { border: "border-red-200", badge: "bg-red-100 text-red-800" };
  }
  if (normalized.includes("long")) {
    return { border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-800" };
  }
  return { border: "border-amber-200", badge: "bg-amber-100 text-amber-800" };
}

function normalizeRow(row, length) {
  return Array.from({ length }, (_, index) => row[index] ?? "");
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Analiz Ediliyor" : "Analiz Et";

  if (isLoading) {
    statusPill.textContent = "Veri alınıyor";
    statusPill.className =
      "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700";
    resultPanel.hidden = true;
    emptyPanel.hidden = true;
    loadingPanel.hidden = false;
    startLoadingSteps();
  } else {
    stopLoadingSteps();
    loadingPanel.hidden = true;
  }
}

function startLoadingSteps() {
  loadingStepIndex = 0;
  paintLoadingSteps();
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    loadingStepIndex = Math.min(loadingStepIndex + 1, loadingSteps.length - 1);
    paintLoadingSteps();
  }, 900);
}

function stopLoadingSteps() {
  clearInterval(loadingTimer);
  loadingTimer = undefined;
}

function paintLoadingSteps() {
  loadingSteps.forEach((step, index) => {
    const isActive = index <= loadingStepIndex;
    step.className = isActive
      ? "loading-step rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-semibold text-emerald-700"
      : "loading-step rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500";
  });
}

function hideSuggestions() {
  suggestions.hidden = true;
  suggestions.replaceChildren();
}

function showError(message) {
  error.textContent = message;
  if (message && resultPanel.hidden) emptyPanel.hidden = false;
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

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
