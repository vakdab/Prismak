'use strict';

const http = require('node:http');
const { handle } = require('./uaserials-proxy');

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

if (!process.env.STREAM_SIGNING_KEY || process.env.STREAM_SIGNING_KEY.length < 32) {
  console.error('STREAM_SIGNING_KEY must be set and contain at least 32 characters');
  process.exit(1);
}

globalThis.STREAM_SIGNING_KEY = process.env.STREAM_SIGNING_KEY;

const server = http.createServer(async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const hostHeader = req.headers.host || `localhost:${port}`;
    const requestUrl = `${protocol}://${hostHeader}${req.url || '/'}`;
    const request = new Request(requestUrl, {
      method: req.method,
      headers: req.headers,
    });
    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (req.method === 'HEAD' || !response.body) return res.end();
    const body = Buffer.from(await response.arrayBuffer());
    res.end(body);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Backend failure' }));
  }
});

server.listen(port, host, () => {
  console.log(`UASerials backend listening on http://${host}:${port}`);
});
