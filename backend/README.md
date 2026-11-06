# Prismak Sources Backend

Standalone Node.js 20 backend для Prismak/Lampa. Він надає єдиний API для `VideoHUB`, `VeoVeo`, `HDVB` і `Vibix`, тому в Lampa потрібен лише один Prismak-плагін.

## Запуск

```bash
cp .env.example .env
# Заповніть HDVB_* та VIBIX_API_URL_TEMPLATE актуальними значеннями
set -a; . ./.env; set +a
npm run check
npm start
```

Перевірка:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/sources
```

Для production поставте HTTPS reverse proxy (Nginx/Caddy) перед Node.js. Не публікуйте HDVB-токен у клієнтському JavaScript: він має залишатися тільки в `.env` backend-сервера.

## API

Для кожного джерела підтримуються:

```text
GET /lite/{source}?action=search&title=...
GET /lite/{source}?action=content&kinopoisk_id=...
GET /lite/{source}?action=stream&ref[...]=...
```

На практиці Prismak передає прості параметри та `ref` у записі результату. Відповіді нормалізуються до формату:

```json
{"ok":true,"items":[{"title":"...","ref":{}}]}
```

або:

```json
{"ok":true,"type":"movie","streams":[{"title":"1080p","url":"https://...m3u8","hls_type":"hlsjs"}]}
```

## Режим Lampac

Якщо вказати `LAMPAC_BASE_URL`, сервер працює як тонкий gateway і пересилає запити до `/lite/{source}` на ваш Lampac. Якщо `LAMPAC_BASE_URL` не вказаний, використовуються вбудовані адаптери:

- VideoHUB: `plapi.cdnvideohub.com`, playlist API та HLS URL;
- VeoVeo: API каталогу/епізодів і локальний JSON-каталог через `VEO_CATALOG_URL`;
- HDVB: API відео, iframe player і отримання HLS;
- Vibix: конфігурований API URL та декодування payload `p/v`.

## Що треба налаштувати вручну

У HDVB актуальні `HDVB_API_BASE`, `HDVB_VIDEO_BASE` і `HDVB_API_TOKEN` залежать від поточної конфігурації провайдера. Для VeoVeo потрібен актуальний JSON-каталог, якщо немає `movieid`. Для Vibix потрібно задати актуальний `VIBIX_API_URL_TEMPLATE`, оскільки публічна API-схема може змінюватися. Сервер навмисно не містить секретів і не вгадує ці значення.

Це backend-адаптер. Він не обходить CAPTCHA, авторизацію або обмеження доступу джерел; якщо upstream недоступний з вашого VPS, потрібен дозволений спосіб доступу або власний Lampac/backend.
