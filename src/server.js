import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAnalysis } from "./analysis.js";
import { getMarketContext, getSuggestions } from "./exchanges.js";
import { normalizeSymbolInput } from "../shared/symbols.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = join(rootDir, "public");
const sharedDir = join(rootDir, "shared");

loadEnv();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/suggestions") {
      const suggestions = await getSuggestions(url.searchParams.get("q") ?? "");
      return sendJson(response, 200, { suggestions });
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJsonBody(request);
      const symbolInfo = normalizeSymbolInput(body.symbol);
      if (!symbolInfo.ok) return sendJson(response, 400, { error: symbolInfo.error });

      const marketContext = await getMarketContext(symbolInfo);
      const analysis = await generateAnalysis({
        symbolInfo,
        marketContext,
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      });

      return sendJson(response, 200, {
        symbol: symbolInfo.displaySymbol,
        venue: symbolInfo.venue,
        generatedAt: new Date().toISOString(),
        analysis,
      });
    }

    if (request.method === "GET") {
      return serveStatic(url.pathname, response);
    }

    return sendJson(response, 405, { error: "Bu işlem desteklenmiyor." });
  } catch (error) {
    const status = error.status ?? 500;
    const message = status === 500 ? "Analiz oluşturulurken beklenmeyen bir hata oluştu." : error.message;
    console.error(error);
    return sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  const visibleHost = host ?? "localhost";
  console.log(`Kripto analiz uygulaması http://${visibleHost}:${port} adresinde çalışıyor.`);
});

async function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const baseDir = safePath.startsWith("/shared/") ? rootDir : publicDir;
  const filePath = resolve(baseDir, safePath.replace(/^\//, ""));

  if (!filePath.startsWith(baseDir)) return sendText(response, 403, "Erişim reddedildi.");

  try {
    const content = await readFile(filePath);
    return send(response, 200, content, contentType(filePath));
  } catch {
    return sendText(response, 404, "Dosya bulunamadı.");
  }
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 16_384) {
        reject(Object.assign(new Error("İstek gövdesi çok büyük."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error("Geçersiz JSON gövdesi."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  return send(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendText(response, status, text) {
  return send(response, status, text, "text/plain; charset=utf-8");
}

function send(response, status, body, type) {
  response.writeHead(status, { "Content-Type": type });
  response.end(body);
}

function contentType(filePath) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[extname(filePath)] ?? "application/octet-stream"
  );
}

function loadEnv() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
