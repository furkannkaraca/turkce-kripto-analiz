const DEFAULT_MODEL = "gemini-2.5-pro";
const DEFAULT_FALLBACK_MODELS = ["gemini-2.5-flash-lite"];
const RETRYABLE_GEMINI_STATUSES = new Set([500, 502, 503, 504]);
const REQUIRED_TABLES = [
  "TABLO: TAV Özet",
  "TABLO: Piyasa Türü",
  "TABLO: Market Structure",
  "TABLO: PA ICT SMT",
  "TABLO: Likidite Hacim",
  "TABLO: TAV Senaryo",
  "TABLO: Risk Disiplini",
];

export async function generateAnalysis({ symbolInfo, marketContext, apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw userError("Gemini API anahtarı bulunamadı. Lütfen GEMINI_API_KEY ortam değişkenini ayarlayın.");
  }

  let lastError;

  for (const modelName of buildModelList(model)) {
    let lastOutput = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await requestGeminiAnalysisWithRetry({
          symbolInfo,
          marketContext,
          apiKey,
          model: modelName,
          retryMissingTables: attempt > 0 ? missingTables(lastOutput) : [],
        });

        lastOutput = normalizeAnalysisOutput(output);
        if (!missingTables(lastOutput).length) return lastOutput;
      } catch (error) {
        lastError = error;
        if (!isRetryableGeminiError(error)) throw error;
        break;
      }
    }

    if (lastOutput) {
      lastError = new Error(`Gemini analizi eksik döndürdü. Eksik tablolar: ${missingTables(lastOutput).join(", ")}`);
      lastError.status = 502;
    }
  }

  throw lastError ?? Object.assign(new Error("Gemini analizi üretilemedi."), { status: 502 });
}

async function requestGeminiAnalysisWithRetry(options) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestGeminiAnalysis(options);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt === 1) break;
      await delay(900 * (attempt + 1));
    }
  }

  throw lastError;
}

async function requestGeminiAnalysis({ symbolInfo, marketContext, apiKey, model, retryMissingTables }) {
  const payloadText = {
    requestedSymbol: symbolInfo.displaySymbol,
    venue: symbolInfo.venue,
    outputContract: {
      requiredTables: REQUIRED_TABLES,
      mustCompleteAllTables: true,
      noIntroOrOutro: true,
    },
    retryInstruction: retryMissingTables.length
      ? `Önceki cevap eksikti. Şu tablolar dahil tüm zorunlu tabloları eksiksiz üret: ${retryMissingTables.join(", ")}`
      : undefined,
    hiddenMarketContext: compactMarketContext(marketContext),
  };

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
                text: JSON.stringify(payloadText),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.25,
          topP: 0.8,
          maxOutputTokens: 4000,
          responseMimeType: "text/plain",
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message ?? "Gemini analiz isteği başarısız oldu.";
    const error = new Error(`Gemini hatası: ${message}`);
    error.status = response.status === 429 ? 429 : response.status === 503 ? 503 : 502;
    error.upstreamStatus = response.status;
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

Price Action kullanım kuralları:
Likidite, Order Block, Fair Value Gap, Break of Structure, retest yapıları ve destek/direnç bölgeleri aktif olarak takip edilir.
Likidite; equal high, equal low, önceki gün tepe/dip seviyeleri ve sert fitilli dönüş bölgelerinde aranır.
Order Block, güçlü impulsive hareket öncesindeki son karşıt mum bölgesi olarak değerlendirilir.
Order Block ancak güçlü displacement, retest veya hacim destekli dönüşle anlam kazanır.
Fair Value Gap üç mum dengesizliği olarak değerlendirilir; devam formasyonu, retest alanı veya likidite sonrası dönüş bölgesi olabilir.
BOS için Higher High veya Lower Low kırılımı, mümkünse displacement ile desteklenmelidir.

ICT kullanım kuralları:
ICT yaklaşımında liquidity sweep, premium/discount, market structure shift, displacement ve Judas Swing mantığı kullanılır.
Liquidity Sweep sonrası rejection, hacim davranışı ve yön değişimi aranır.
Discount alanında long fırsatı, premium alanında short fırsatı aranır; ancak tek başına işlem nedeni sayılmaz.
Displacement gerçek kırılım ve güçlü momentum teyidi olarak değerlendirilir.
Market Structure Shift veya displacement yoksa dönüş senaryosu zayıf kabul edilir.

SMT kullanım kuralları:
SMT, korelasyonlu marketler veya majör piyasa bağlamı arasındaki uyumsuzlukların analizidir.
BTC ile altcoin, dominance ayrışmaları veya benzer coinler arasındaki güç farkı dikkate alınır.
SMT Divergence; bir varlık yeni dip veya tepe yaparken diğerinin bunu desteklememesi durumudur.
SMT güçlü/zayıf market tespiti ve fake breakout ihtimali için kullanılır.
Elde doğrudan korelasyon verisi yoksa SMT sonucunu kesin yazma; sadece mevcut bağlamla sınırlı ihtimal olarak belirt.

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

Sayısal işlem seviyesi kuralları:
TAV Senaryo tablosunda yuvarlak kelimeler kullanma; her senaryoda net fiyat rakamları ver.
30 dakikalık grafikteki likidite, fitil, eşit tepe/dip ve yakın destek/direnç bölgelerini entry, TP ve SL referansı olarak kullan.
Format örneği: Giriş: 68500 USDT, Stop: 67900 USDT, Hedef: 71000 USDT.
Long ve Short senaryolarında GİRİŞ, HEDEF ve STOP hücreleri mutlaka sayısal fiyat içermelidir.
İşlem Yok senaryosunda fiyat yerine bekleme koşulu yazılabilir, ancak neden net olmalıdır.

OB ve FVG zorunluluğu:
PA ICT SMT veya Market Structure tablosuna Order Block (OB) ve Fair Value Gap (FVG) analizini kesinlikle dahil et.
Fiyatın taze bir FVG içinde olup olmadığını veya test edilmemiş bir OB bölgesine yaklaşıp yaklaşmadığını net olarak belirt.
OB/FVG yoksa "Belirgin OB/FVG yok" yaz; tabloyu boş bırakma.

5 dakikalık konfirmasyon kuralları:
TAV Senaryo onay şartı olarak fiyat belirlediğin OB veya FVG bölgesine geldiğinde 5m grafikte Mitigation, Breaker veya SFP oluşup oluşmadığını kontrol et.
5m onayı yoksa ilgili senaryoyu riskli olarak işaretle.
5M KONFİRMASYON sütununda "Mitigation var", "Breaker var", "SFP var", "5m onay yok - riskli" gibi net ifade kullan.

Sermaye, kaldıraç ve R:R matematiği:
Risk Disiplini tablosunda genel kural yazma; sayısal hesap yaz.
Kasa = 10 USDT standart giriş, kaldıraç = 20x olarak hesapla.
Pozisyon büyüklüğü = 10 USDT x 20 = 200 USDT kabul edilir.
Giriş, Stop ve Hedef seviyelerine göre R:R oranını hesapla.
Stop olursa yaklaşık dolar kaybını, TP olursa yaklaşık dolar kazancını PnL BEKLENTİSİ sütununda yaz.
Formül: zarar = pozisyon büyüklüğü x abs(giriş-stop)/giriş; kazanç = pozisyon büyüklüğü x abs(hedef-giriş)/giriş.

Mum gövdesi ve hacim absorpsiyonu:
Likidite Hacim tablosunda sadece "Orta", "Yüksek" veya "Düşük" gibi tek kelimelik hacim yorumu yazma.
Son mumların gövde büyüklüğü ile hacmini kıyasla.
Küçük mum gövdesine rağmen yüksek hacim varsa "Absorpsiyon (Emilim) İhtimali" olarak belirt.
Güçlü mum + yüksek hacim için "gerçek ilgi", güçlü mum + düşük hacim için "zayıf hareket" değerlendirmesi yap.

Üslup ve sınırlar:
Kullanıcıya her yanıtta mutlaka "efendim" diye hitap et.
Nezaket ve kibarlığı koru; kullanıcıya her seferinde hak vermek zorunda değilsin.
Yatırım tavsiyesi verme, kesin kazanç veya kesin yön vadetme.
Verilen gizli piyasa bağlamı dışına çıkma, canlı veri uydurma.
Standart düz metin karakter yapısını kullan.
Markdown, kalın yazı, italik, emoji, madde işareti, kod bloğu veya süslü anlatım kullanma.

Raporları tam olarak şu düz metin tablo hiyerarşisiyle üret.
Cevabın ilk satırı mutlaka "TABLO: TAV Özet" olmalı.
Tablo dışında giriş cümlesi, kapanış cümlesi veya açıklama yazma.
"efendim" hitabını TAV Özet tablosunda Hitap satırında kullan.
Aşağıdaki tablo başlıklarının tamamını aynı sırayla üret.
Hiçbir tabloyu atlama. Veri yetersizse tabloyu yine üret ve ilgili hücreye "Veri sınırlı" yaz.

TABLO: TAV Özet
Alan | Değer
Hitap | efendim
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

TABLO: PA ICT SMT
Metodoloji | Yapı | Yorum
PA | OB / FVG / Retest | ...
ICT | Sweep / Premium Discount / Displacement | ...
SMT | ...

TABLO: Likidite Hacim
Unsur | Bölge/Durum | Anlam
Eşit Tepe/Dip | ...
Fitil/Süpürme | ...
Mum Gövdesi/Hacim | ...

TABLO: TAV Senaryo
SENARYO | GİRİŞ | HEDEF | STOP | 5M KONFİRMASYON | İPTAL KOŞULU
Long | Giriş: ... USDT | Hedef: ... USDT | Stop: ... USDT | ...
Short | Giriş: ... USDT | Hedef: ... USDT | Stop: ... USDT | ...
İşlem Yok | Bekleme koşulu | Veri sınırlı | Veri sınırlı | 5m onay yok - riskli | ...

TABLO: Risk Disiplini
PARAMETRE | DEĞER | R:R HESABI | PnL BEKLENTİSİ
Kasa/Kaldıraç | 10 USDT / 20x | Pozisyon: 200 USDT | ...
Long R:R | ... | ... | Stop: -... USDT, TP: +... USDT
Short R:R | ... | ... | Stop: -... USDT, TP: +... USDT

Kısa, net ve ölçülü yaz. Her tabloda en fazla 6 satır olsun.
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
        recentCandles: context.timeframes?.["5m"]?.candles?.slice(-30).map(mapCandle),
      },
      "15m": {
        indicators: context.timeframes?.["15m"]?.indicators,
        recentCandles: context.timeframes?.["15m"]?.candles?.slice(-30).map(mapCandle),
      },
      "30m": {
        indicators: context.timeframes?.["30m"]?.indicators,
        recentCandles: context.timeframes?.["30m"]?.candles?.slice(-30).map(mapCandle),
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

function normalizeAnalysisOutput(text) {
  const trimmed = text.trim();
  const firstTableIndex = trimmed.indexOf("TABLO:");
  if (firstTableIndex > 0) return trimmed.slice(firstTableIndex).trim();
  return trimmed;
}

function missingTables(text) {
  return REQUIRED_TABLES.filter((tableName) => !text.includes(tableName));
}

function buildModelList(model) {
  const configuredFallbacks = String(process.env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set([model, ...configuredFallbacks, ...DEFAULT_FALLBACK_MODELS])];
}

function isRetryableGeminiError(error) {
  return (
    RETRYABLE_GEMINI_STATUSES.has(error.upstreamStatus) ||
    /high demand|try again later|unavailable|overloaded/i.test(error.message)
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function userError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
