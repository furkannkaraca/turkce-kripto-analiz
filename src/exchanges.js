import { VENUES } from "../shared/symbols.js";

const BINANCE_BASE = "https://api.binance.com";
const MEXC_CONTRACT_BASE = "https://contract.mexc.com";
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

export async function getExchangeSymbols() {
  const [binance, mexc] = await Promise.all([getBinanceSpotSymbols(), getMexcPerpSymbols()]);
  return { binance, mexc };
}

export async function assertUpstreamSymbol(symbolInfo) {
  if (symbolInfo.venue === VENUES.BINANCE_SPOT) {
    const symbols = await getBinanceSpotSymbols();
    if (!symbols.has(symbolInfo.upstreamSymbol)) {
      throw userError(`${symbolInfo.displaySymbol} Binance spot tarafında aktif bir USDT paritesi değil.`);
    }
    return;
  }

  const symbols = await getMexcPerpSymbols();
  if (!symbols.has(symbolInfo.upstreamSymbol)) {
    throw userError(`${symbolInfo.displaySymbol} MEXC perpetual futures tarafında aktif bir USDT kontratı değil.`);
  }
}

export async function getMarketContext(symbolInfo) {
  await assertUpstreamSymbol(symbolInfo);

  const [ticker, candles5m, candles15m, candles30m, marketIndexes] = await Promise.all([
    getTicker(symbolInfo),
    getCandles(symbolInfo, "5m"),
    getCandles(symbolInfo, "15m"),
    getCandles(symbolInfo, "30m"),
    getMarketIndexes(),
  ]);

  const indicators = buildIndicators(candles15m);

  return {
    requestedAt: new Date().toISOString(),
    venue: symbolInfo.venue,
    symbol: symbolInfo.displaySymbol,
    upstreamSymbol: symbolInfo.upstreamSymbol,
    ticker,
    candles: candles15m,
    timeframes: {
      "5m": { candles: candles5m, indicators: buildIndicators(candles5m) },
      "15m": { candles: candles15m, indicators },
      "30m": { candles: candles30m, indicators: buildIndicators(candles30m) },
    },
    indicators,
    marketIndexes,
  };
}

export async function getSuggestions(query = "", limit = 12) {
  const { binance, mexc } = await getExchangeSymbols();
  const needle = String(query ?? "").trim().toUpperCase().replace(/[\/_\-\s]/g, "");
  const score = (symbol) => {
    if (!needle) return 1;
    if (symbol.startsWith(needle)) return 3;
    if (symbol.includes(needle)) return 2;
    return 0;
  };

  const merged = [
    ...[...binance].map((symbol) => ({ symbol, venue: "Binance Spot" })),
    ...[...mexc].map((symbol) => ({ symbol: symbol.replace("_", "") + ".P", venue: "MEXC Perpetual" })),
  ];

  return merged
    .map((item) => ({ ...item, score: score(item.symbol.replace(".P", "")) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);
}

async function getTicker(symbolInfo) {
  if (symbolInfo.venue === VENUES.BINANCE_SPOT) {
    const data = await fetchJson(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${symbolInfo.upstreamSymbol}`);
    return {
      lastPrice: num(data.lastPrice),
      priceChangePercent: num(data.priceChangePercent),
      highPrice: num(data.highPrice),
      lowPrice: num(data.lowPrice),
      volume: num(data.volume),
      quoteVolume: num(data.quoteVolume),
    };
  }

  const data = await fetchJson(`${MEXC_CONTRACT_BASE}/api/v1/contract/ticker?symbol=${symbolInfo.upstreamSymbol}`);
  const ticker = Array.isArray(data.data) ? data.data[0] : data.data;
  return {
    lastPrice: num(ticker?.lastPrice ?? ticker?.last),
    priceChangePercent: num(ticker?.riseFallRate) * 100,
    highPrice: num(ticker?.high24Price),
    lowPrice: num(ticker?.low24Price),
    volume: num(ticker?.volume24),
    quoteVolume: num(ticker?.amount24),
  };
}

async function getCandles(symbolInfo, interval = "15m") {
  if (symbolInfo.venue === VENUES.BINANCE_SPOT) {
    const data = await fetchJson(
      `${BINANCE_BASE}/api/v3/klines?symbol=${symbolInfo.upstreamSymbol}&interval=${interval}&limit=200`,
    );
    return data.map((row) => ({
      time: Number(row[0]),
      open: num(row[1]),
      high: num(row[2]),
      low: num(row[3]),
      close: num(row[4]),
      volume: num(row[5]),
    }));
  }

  const mexcInterval = { "5m": "Min5", "15m": "Min15", "30m": "Min30" }[interval] ?? "Min15";
  const minutes = { "5m": 5, "15m": 15, "30m": 30 }[interval] ?? 15;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 200 * minutes * 60;
  const data = await fetchJson(
    `${MEXC_CONTRACT_BASE}/api/v1/contract/kline/${symbolInfo.upstreamSymbol}?interval=${mexcInterval}&start=${start}&end=${end}`,
  );
  return parseMexcKlines(data.data);
}

async function getMarketIndexes() {
  const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
  const [tickerResults, globalResult] = await Promise.all([
    Promise.allSettled(symbols.map((symbol) => fetchJson(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${symbol}`))),
    Promise.allSettled([fetchJson("https://api.coingecko.com/api/v3/global")]).then((results) => results[0]),
  ]);

  const largeCaps = tickerResults
    .map((result, index) => {
      if (result.status !== "fulfilled") return null;
      return {
        symbol: symbols[index],
        lastPrice: num(result.value.lastPrice),
        priceChangePercent: num(result.value.priceChangePercent),
        quoteVolume: num(result.value.quoteVolume),
      };
    })
    .filter(Boolean);

  return {
    largeCaps,
    globalBreadth: parseGlobalBreadth(globalResult),
  };
}

function parseGlobalBreadth(result) {
  if (result.status !== "fulfilled") return null;

  const data = result.value.data ?? {};
  const totalMarketCapUsd = num(data.total_market_cap?.usd);
  const totalVolumeUsd = num(data.total_volume?.usd);
  const btcDominance = num(data.market_cap_percentage?.btc);
  const ethDominance = num(data.market_cap_percentage?.eth);
  const top10Dominance = Object.values(data.market_cap_percentage ?? {})
    .map(num)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, value) => sum + value, 0);
  const btcMarketCapUsd = totalMarketCapUsd && btcDominance ? (totalMarketCapUsd * btcDominance) / 100 : null;
  const ethMarketCapUsd = totalMarketCapUsd && ethDominance ? (totalMarketCapUsd * ethDominance) / 100 : null;
  const top10MarketCapUsd = totalMarketCapUsd && top10Dominance ? (totalMarketCapUsd * top10Dominance) / 100 : null;

  return {
    source: "CoinGecko global",
    totalMarketCapUsd: round(totalMarketCapUsd),
    totalVolumeUsd: round(totalVolumeUsd),
    marketCapChange24hPercent: round(num(data.market_cap_change_percentage_24h_usd)),
    btcDominancePercent: round(btcDominance),
    ethDominancePercent: round(ethDominance),
    estimatedTotal2Usd: round(totalMarketCapUsd && btcMarketCapUsd ? totalMarketCapUsd - btcMarketCapUsd : null),
    estimatedTotal3Usd: round(
      totalMarketCapUsd && btcMarketCapUsd && ethMarketCapUsd
        ? totalMarketCapUsd - btcMarketCapUsd - ethMarketCapUsd
        : null,
    ),
    estimatedOtherExTop10Usd: round(
      totalMarketCapUsd && top10MarketCapUsd ? totalMarketCapUsd - top10MarketCapUsd : null,
    ),
  };
}

function parseMexcKlines(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.map((row) => {
      if (Array.isArray(row)) {
        return {
          time: toMs(row[0]),
          open: num(row[1]),
          close: num(row[2]),
          high: num(row[3]),
          low: num(row[4]),
          volume: num(row[5]),
        };
      }
      return {
        time: toMs(row.time ?? row.t),
        open: num(row.open ?? row.o),
        high: num(row.high ?? row.h),
        low: num(row.low ?? row.l),
        close: num(row.close ?? row.c),
        volume: num(row.vol ?? row.volume ?? row.v),
      };
    });
  }

  if (Array.isArray(data.time) || Array.isArray(data.open)) {
    const times = data.time ?? data.t ?? [];
    const opens = data.open ?? data.o ?? [];
    const highs = data.high ?? data.h ?? [];
    const lows = data.low ?? data.l ?? [];
    const closes = data.close ?? data.c ?? [];
    const volumes = data.vol ?? data.volume ?? data.v ?? [];

    return times.map((time, index) => ({
      time: toMs(time),
      open: num(opens[index]),
      high: num(highs[index]),
      low: num(lows[index]),
      close: num(closes[index]),
      volume: num(volumes[index]),
    }));
  }

  return [];
}

function buildIndicators(candles) {
  const closes = candles.map((candle) => candle.close).filter(Number.isFinite);
  const last = closes.at(-1);
  const previous = closes.at(-2);

  return {
    lastClose: round(last),
    candleCount: candles.length,
    ema20: round(ema(closes, 20)),
    ema50: round(ema(closes, 50)),
    rsi14: round(rsi(closes, 14)),
    change15mPercent: round(previous ? ((last - previous) / previous) * 100 : null),
    change4hPercent: round(closes.length > 16 ? ((last - closes.at(-17)) / closes.at(-17)) * 100 : null),
  };
}

function ema(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) current = value * multiplier + current * (1 - multiplier);
  return current;
}

function rsi(values, period) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function getBinanceSpotSymbols() {
  return cached("binance-symbols", async () => {
    const data = await fetchJson(`${BINANCE_BASE}/api/v3/exchangeInfo`);
    return new Set(
      data.symbols
        .filter((item) => item.status === "TRADING" && item.quoteAsset === "USDT" && item.isSpotTradingAllowed !== false)
        .map((item) => item.symbol),
    );
  });
}

async function getMexcPerpSymbols() {
  return cached("mexc-symbols", async () => {
    const data = await fetchJson(`${MEXC_CONTRACT_BASE}/api/v1/contract/detail`);
    return new Set(
      (data.data ?? [])
        .filter((item) => item.quoteCoin === "USDT" && (item.state === 0 || item.state === undefined))
        .map((item) => item.symbol),
    );
  });
}

async function cached(key, loader) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "turkce-kripto-analiz/1.0" },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    const json = JSON.parse(body);
    if (json.success === false || json.code === 400) throw new Error(json.message ?? "Borsa API hatası");
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function toMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function userError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
