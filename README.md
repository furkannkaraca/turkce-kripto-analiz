# Türkçe Kripto Analiz Uygulaması

Kullanıcı bir USDT paritesi girer; uygulama Binance spot veya `.P` suffix'i varsa MEXC perpetual futures verisini doğrular, piyasa bağlamını toplar ve Gemini API ile Türkçe analiz üretir.

## Çalıştırma

1. `.env.example` dosyasını `.env` olarak kopyalayın.
2. `GEMINI_API_KEY` değerini girin.
3. Uygulamayı başlatın:

```powershell
npm start
```

Tarayıcı: `http://localhost:3000`

## Yayına Alma

Web sitesi olarak deploy etmek için [DEPLOY.md](./DEPLOY.md) dosyasındaki adımları izleyin.

## Sembol Kuralları

- `BTCUSDT`, `BTC/USDT`, `BTC-USDT`: Binance spot.
- `BTCUSDT.P`, `BTC/USDT.P`: MEXC perpetual futures.
- Sadece USDT pariteleri desteklenir.
