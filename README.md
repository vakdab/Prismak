# Prismak для Lampa

Окремий плагін Prismak Online Sources v2.9.5 для Lampa. Додає онлайн-джерела UAKino, Eneyida та інші онлайн-балансери без TV-оболонки.

## Встановлення

У Lampa відкрийте **Розширення → Додати плагін** і додайте:

```text
https://cdn.jsdelivr.net/gh/vakdab/Prismak@main/lampa-prismak.js
```

Зафіксована версія (поточний commit SHA):

<!-- prismak-pinned-cdn -->
```text
https://cdn.jsdelivr.net/gh/vakdab/Prismak@5abf3f8bd2ee0e5fae5854785cb642d70430e43b/lampa-prismak.js
```

Після кожного оновлення `main` GitHub Actions автоматично оновлює це посилання на SHA відповідного коміту.

Плагін призначений для використання окремо. Якщо Prismak уже вбудований у ваш комбінований плагін, повторно додавати його не потрібно.

## Додані джерела

Плагін підтримує VideoHUB, VeoVeo, HDVB і Vibix через Lampac-сумісний backend. У `lampa-prismak.js` задайте HTTPS-адресу self-hosted Lampac без завершального `/` у `LAMPAC_BASE`; очікуються маршрути `/lite/videohub`, `/lite/veoveo`, `/lite/hdvb` і `/lite/vibix`. Backend має повертати JSON для `action=search|content|stream`; токени та upstream-секрети повинні залишатися на backend/Worker.

Якщо Lampac не налаштований або upstream недоступний, джерело повертає зрозумілу помилку для поточного запиту і не вимикає всі джерела.
