export const VENUES = Object.freeze({
  BINANCE_SPOT: "BINANCE_SPOT",
  MEXC_PERP: "MEXC_PERP",
});

const USDT_PAIR_RE = /^[A-Z0-9]{2,30}USDT$/;
const SEPARATOR_RE = /[\/_\-]/g;

export function normalizeSymbolInput(value) {
  const original = String(value ?? "");
  const compact = original.trim().toUpperCase().replace(/\s+/g, "");

  if (!compact) {
    return fail("Lütfen bir USDT paritesi girin.");
  }

  const isPerpetual = compact.endsWith(".P");
  const withoutSuffix = isPerpetual ? compact.slice(0, -2) : compact;
  const normalizedCore = withoutSuffix.replace(SEPARATOR_RE, "");

  if (normalizedCore.includes(".")) {
    return fail("Sadece MEXC perpetual için .P suffix'i kullanılabilir. Örnek: BTCUSDT.P");
  }

  if (!USDT_PAIR_RE.test(normalizedCore)) {
    return fail("Geçerli format: BTCUSDT veya MEXC perpetual için BTCUSDT.P");
  }

  const base = normalizedCore.slice(0, -4);
  const venue = isPerpetual ? VENUES.MEXC_PERP : VENUES.BINANCE_SPOT;
  const upstreamSymbol = isPerpetual ? `${base}_USDT` : normalizedCore;

  return {
    ok: true,
    base,
    quote: "USDT",
    venue,
    isPerpetual,
    normalized: `${normalizedCore}${isPerpetual ? ".P" : ""}`,
    spotSymbol: normalizedCore,
    upstreamSymbol,
    displaySymbol: `${base}USDT${isPerpetual ? ".P" : ""}`,
  };
}

export function isValidSymbolFormat(value) {
  return normalizeSymbolInput(value).ok;
}

export function symbolMatchesQuery(symbol, query) {
  const normalizedQuery = String(query ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalizedQuery) return true;
  return symbol.toUpperCase().includes(normalizedQuery.replace(SEPARATOR_RE, ""));
}

function fail(message) {
  return { ok: false, error: message };
}
