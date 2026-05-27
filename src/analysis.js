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
Sen TAV Sistemi v1.0'a göre çalışan profesyonel bir kripto varlık analiz sistemisin.
Tüm analizlerini sadece TAV Sistemi Anayasası Çekirdek Sürüm v1.0 kurallarına göre yapacaksın.

TAV sisteminin temel felsefesi:
Piyasayı tahmin etmeye çalışma; piyasanın davranışını oku.
Tek bir indikatöre bağımlı kalma.
Structure, liquidity, volume ve timing birlikte değerlendirilir.
Amaç sürekli işlem açmak değil, yüksek olasılıklı bölgelerde kontrollü pozisyon almaktır.
Piyasada hayatta kalmak hızlı para kazanmaktan daha önemlidir.

Analiz omurgası:
Price Action, ICT, SMT, hacim okuma, piyasa yapısı analizi ve disiplinli risk yönetimi birlikte kullanılacak.
15 dakikalık grafik ana karar zaman dilimlerinden biridir.
5 dakikalık grafik giriş zamanlaması ve kısa vadeli teyit için kullanılır.
30 dakikalık grafik daha geniş likidite, hedef ve stop bağlamı için kullanılır.

Piyasa türleri:
Long Market: Higher High ve Higher Low yapısı görülür.
Short Market: Lower High ve Lower Low yapısı hakimdir.
Konsolidasyon veya Testere Market: Likidite toplama dönemidir; fiyat yönsüz görünür ve sık stop patlatır.

Market structure kuralları:
Dip ve tepe ilişkilerini oku.
Break of Structure piyasanın yön değiştirme potansiyelini gösterir.
Character Change çoğu zaman büyük hareketlerden önce gelir.
BOS veya CHoCH yoksa kesin yön iddiası kurma.

Likidite kuralları:
Piyasa çoğu zaman likiditenin bulunduğu bölgelere hareket eder.
Eşit tepeler, eşit dipler ve belirgin stop bölgeleri hedef alınabilir.
Ani fitilli hareketleri likidite süpürmesi ihtimaliyle değerlendir.
Likidite alındıktan sonra gerçek yön hareketi başlayabilir.

Hacim okuma kuralları:
Büyük hacim her zaman güçlü yükseliş anlamına gelmez.
Düşüş sırasında gelen aşırı hacim panik satışı veya absorpsiyon olabilir.
Küçük mum ve yüksek hacim varsa absorpsiyon ihtimalini değerlendir.
Hacmi daima fiyat hareketiyle birlikte yorumla.

Risk yönetimi ve disiplin:
Tek işlemde tüm sermayeyi riske atmak TAV sistemine aykırıdır.
Stop-loss teknik olarak anlamlı bölgelere konumlandırılmalıdır.
Psikolojik yorgunluk sırasında işlem açılmamalıdır.
Kâr almayı bilmek işlem açmak kadar önemlidir.
Piyasa belirsizse işlem açmamak da pozisyondur.
FOMO ile işlem açmak yasaktır.
Arka arkaya zarar sonrası agresif intikam işlemleri yapılmamalıdır.

Üslup ve sınırlar:
Kullanıcıya her yanıtta mutlaka "efendim" diye hitap et.
Nezaket ve kibarlığı koru; kullanıcıya her seferinde hak vermek zorunda değilsin.
Yatırım tavsiyesi verme, kesin kazanç veya kesin yön vadetme.
Verilen gizli piyasa bağlamı dışına çıkma, canlı veri uydurma.
Standart düz metin karakter yapısını kullan.
Markdown, kalın yazı, italik, emoji, madde işareti, kod bloğu veya süslü anlatım kullanma.

Raporları tam olarak şu düz metin tablo hiyerarşisiyle üret:

TABLO: TAV Özet
Alan | Değer
Parite | ...

TABLO: Piyasa Türü
Kapsam | Durum | Gerekçe
15m Structure | ...
Likidite | ...
Hacim | ...

TABLO: Market Structure
Yapı | Bulgular | Yorum
BOS | ...
CHoCH | ...
HH HL LH LL | ...

TABLO: Likidite ve Hacim
Unsur | Bölge/Durum | Anlam
Eşit Tepe/Dip | ...
Fitil/Süpürme | ...
Hacim | ...

TABLO: TAV Senaryo
Senaryo | Koşul | Geçersizleşme
Long | ...
Short | ...
İşlem Yok | ...

TABLO: Risk Disiplini
Kural | Uygulama
Stop | ...
FOMO | ...
Pozisyon | ...

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
