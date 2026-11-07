# Prismak для Lampa

Окремий плагін Prismak Online Sources v2.9.5 для Lampa. Додає онлайн-джерела UAKino, Eneyida та інші онлайн-балансери без TV-оболонки.

## Встановлення

У Lampa відкрийте **Розширення → Додати плагін** і додайте:

```text
https://cdn.jsdelivr.net/gh/vakdab/Prismak@main/lampa-prismak.js

Оригінальний плагін `online.js` синхронізовано з `http://wtch.ch/online.js`. Для встановлення через jsDelivr:

```text
https://cdn.jsdelivr.net/gh/vakdab/Prismak@main/online.js
```
```

Зафіксована версія (поточний commit SHA):

<!-- prismak-pinned-cdn -->
```text
https://cdn.jsdelivr.net/gh/vakdab/Prismak@7fb75f8860aafb4ec911baeac6e9e2413f9bf035/lampa-prismak.js
```

Після кожного оновлення `main` GitHub Actions автоматично оновлює це посилання на SHA відповідного коміту.

Плагін призначений для використання окремо. Якщо Prismak уже вбудований у ваш комбінований плагін, повторно додавати його не потрібно.

## Додані джерела

Плагін підтримує VideoHUB, VeoVeo, HDVB і Vibix через Lampac-сумісний backend. Адресу потрібно задати в **OnlineUA → Адреса Lampac** у storage-ключі `onlineua_lampac_base`, наприклад `https://lampac.example.com`, без завершального `/`. Після збереження очікуються маршрути `/lite/videohub`, `/lite/veoveo`, `/lite/hdvb` і `/lite/vibix`. Без валідної HTTPS-адреси ці чотири джерела не показуються. Backend має повертати JSON для `action=search|content|stream`; токени та upstream-секрети повинні залишатися на backend/Worker.

Якщо Lampac не налаштований або upstream недоступний, джерело повертає зрозумілу помилку для поточного запиту і не вимикає всі джерела.

## Standalone sources backend

The `backend/` directory contains a standalone Node.js 20 backend for VideoHUB, VeoVeo, HDVB and Vibix. It is not loaded by Lampa automatically: deploy it behind HTTPS and set its URL in **OnlineUA → Адреса Lampac** (the setting accepts the backend's `/lite/<source>` contract). See [`backend/README.md`](backend/README.md).


## Public backend

The default CDN build uses the Prismak Cloudflare Worker at `https://prismak-sources.animegran8.workers.dev`. You can override it in **OnlineUA → Адреса Lampac** by setting the `onlineua_lampac_base` storage value.
