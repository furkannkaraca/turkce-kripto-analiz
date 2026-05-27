# Web Sitesi Olarak Yayına Alma

Bu uygulama sadece statik frontend değildir. Gemini API anahtarını gizli tutmak için Node backend ile birlikte deploy edilmelidir.

## Gerekli Ortam Değişkenleri

Hosting panelinde şu değişkenleri tanımlayın:

```env
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
HOST=0.0.0.0
```

`GEMINI_MODEL` için kota durumuna göre `gemini-2.5-flash` veya `gemini-2.5-flash-lite` kullanılabilir.

## Deploy Seçenekleri

### Docker destekleyen hosting

Repo kökünde `Dockerfile` hazır. Platform Dockerfile'ı algılarsa ek komut gerekmez.

Health check yolu:

```text
/health
```

### Node destekleyen hosting

Başlatma komutu:

```bash
npm start
```

Build komutu gerekmez.

## Önemli Notlar

- `.env` dosyasını public repoya yüklemeyin.
- `GEMINI_API_KEY` sadece hosting ortam değişkenlerinde tutulmalı.
- Sadece statik hosting yeterli değildir; `/api/analyze` ve `/api/suggestions` backend'e ihtiyaç duyar.
