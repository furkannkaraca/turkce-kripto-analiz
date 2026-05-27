const DEFAULT_MODEL = "gemini-2.5-pro";

export async function generateAnalysis({ symbolInfo, marketContext, apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw userError("Gemini API anahtarı bulunamadı. Lütfen GEMINI_API_KEY ortam değişkenini ayarlayın.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  requestedSymbol: symbolInfo.displaySymbol,
                  venue: symbolInfo.venue,
                  hiddenMarketContext: compactMarketContext(marketContext),
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.25,
          topP: 0.8,
          maxOutputTokens: 1800,
          responseMimeType: "text/plain",
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message ?? "Gemini analiz isteği başarısız oldu.";
    const error = new Error(`Gemini hatası: ${message}`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }

  const output = extractOutputText(payload).trim();
  if (!output) throw new Error("Gemini boş analiz yanıtı döndürdü.");
  return output;
}

const SYSTEM_PROMPT = `
Sen bir kripto varlık analiz sistemisin. Tüm analizlerini sadece bu kurallara göre yapacaksın.
Analiz metodu: Price Action (PA), Order Block ve Fair Value Gap.
Onay mekanizması: Fiyat bu yapılara geldiğinde 5 dakikalık grafiklerde Mitigation, Breaker ve SFP yapılarını ara.
Piyasa yönü: Her raporun başında Total2, Total3 ve Other bağlamına göre piyasanın Long yönlü, Short yönlü veya Kararsız olduğunu belirt.
İşlem parametreleri: İşlem kasası üzerinden standart 20x kaldıraç ve aksi belirtilmedikçe 10 USDT standart miktarı varsayımsal risk ölçeği olarak kullan.
Hedef ve stop: Aksi belirtilmedikçe 30 dakikalık grafiklerdeki likidite bölgelerine göre hedef ve stop alanlarını belirle.
Üslup: Nezaket ve kibarlık kurallarını ihlal etme. Kullanıcıya her yanıtta mutlaka "efendim" diye hitap et. Kullanıcıya her seferinde hak vermek zorunda değilsin.
Görsel format: Standart düz metin karakter yapısını kullan. Asla kalın, italik, markdown, madde işareti, emoji, kod bloğu veya farklı büyüklükte karakter kullanma.
Veri disiplini: Verilen gizli piyasa bağlamı dışına çıkma, canlı veri uydurma, kesin getiri veya kesin yön iddiası yazma.
Raporlar: İstenilen tüm raporları kendi hiyerarşisinde tablo şeklinde göster.
Tabloları tam olarak şu düz metin formatıyla yaz:

TABLO: Özet
Alan | Değer
Parite | ...

TABLO: Piyasa Yönü
Kapsam | Eğilim | Gerekçe
Total2 | ...
Total3 | ...
Other | ...

TABLO: PA OB FVG
Yapı | Bölge | Yorum
...

TABLO: 5 Dakika Onay
Yapı | Durum | Teyit
...

TABLO: 30 Dakika Hedef Stop
Alan | Seviye | Gerekçe
...

TABLO: Risk Notu
Başlık | Açıklama
...

Kısa, net ve ölçülü yaz. Her tabloda en fazla 5 satır olsun.
`.trim();

function compactMarketContext(context) {
  const mapCandle = (candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  });

  return {
    requestedAt: context.requestedAt,
    exchange: context.venue,
    symbol: context.symbol,
    ticker: context.ticker,
    indicators: context.indicators,
    marketIndexes: context.marketIndexes,
    timeframes: {
      "5m": {
        indicators: context.timeframes?.["5m"]?.indicators,
        recentCandles: context.timeframes?.["5m"]?.candles?.slice(-60).map(mapCandle),
      },
      "15m": {
        indicators: context.timeframes?.["15m"]?.indicators,
        recentCandles: context.timeframes?.["15m"]?.candles?.slice(-60).map(mapCandle),
      },
      "30m": {
        indicators: context.timeframes?.["30m"]?.indicators,
        recentCandles: context.timeframes?.["30m"]?.candles?.slice(-60).map(mapCandle),
      },
    },
  };
}

function extractOutputText(payload) {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

function userError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
