# Self-hosted UASerials backend

Це Node.js-адаптер для `uaserials-proxy.js`. Він використовує ту саму серверну логіку, що й Cloudflare Worker, але працює на вашому VPS або власному сервері.

## Вимоги

- Node.js 20 або новіший;
- публічний HTTPS-домен для Lampa;
- секрет `STREAM_SIGNING_KEY` довжиною щонайменше 32 символи.

## Запуск без Docker

```bash
cp .env.example .env
# Задайте STREAM_SIGNING_KEY у .env
export STREAM_SIGNING_KEY='ваш-довгий-випадковий-секрет'
export PORT=8787
node uaserials-server.js
```

Для production краще запускати через systemd або Docker і поставити Nginx/Caddy перед Node.js для HTTPS. Не відкривайте backend без HTTPS: Lampa на iOS може блокувати mixed content.

## Запуск через Docker

```bash
docker build -t prismak-uaserials-backend .
docker run -d --name prismak-uaserials \
  --restart unless-stopped \
  -p 8787:8787 \
  -e STREAM_SIGNING_KEY='ваш-довгий-випадковий-секрет' \
  prismak-uaserials-backend
```

Перевірка:

```bash
curl https://your-domain.example/\?health=1
```

Очікувана відповідь:

```json
{"ok":true}
```

## Підключення до плагіна

У `lampa-prismak.js` замініть:

```js
proxy: 'https://prismak-uaserials-proxy.animegran8.workers.dev/'
```

на адресу власного backend:

```js
proxy: 'https://your-domain.example/'
```

Після цього зберіть/опублікуйте плагін і додайте його в Lampa.

## Обмеження

Backend не обходить авторизацію або CAPTCHA Tortuga. Якщо upstream-сервер віддає `404` або порожню player-сторінку саме для IP вашого сервера, потрібно перевірити доступність Tortuga з цього VPS. Власний сервер прибирає обмеження Cloudflare Worker, але не може відновити дані, яких upstream не повертає.
