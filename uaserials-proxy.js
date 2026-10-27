const ALLOWED_SOURCE_HOSTS = new Set([
  'uaserials.com', 'www.uaserials.com',
  'tortuga.tw', 'www.tortuga.tw', 'tortuga.wtf', 'www.tortuga.wtf',
  'get2.fun', 'wtch.ch', 'www.wtch.ch'
]);
const ALLOWED_REFERER_HOSTS = new Set([
  'uaserials.com', 'www.uaserials.com',
  'tortuga.tw', 'www.tortuga.tw', 'tortuga.wtf', 'www.tortuga.wtf',
  'get2.fun', 'wtch.ch', 'www.wtch.ch'
]);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, If-Range',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
  'Cache-Control': 'no-store'
};
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AES_PASSWORD = '297796CCB81D255125';
const STREAM_TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_REFERER = 'https://uaserials.com/';
// Configure a Cloudflare Worker secret binding named STREAM_SIGNING_KEY.

if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => event.respondWith(handle(event.request)));
}

function json(value) {
  const headers = new Headers(CORS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status: 200, headers });
}

function isHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host || !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
    if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function validReferer(raw, fallback) {
  const defaultValue = fallback || DEFAULT_REFERER;
  const ref = isHttpsUrl(raw || defaultValue);
  if (!ref || !ALLOWED_REFERER_HOSTS.has(ref.hostname.toLowerCase())) return defaultValue;
  return ref.toString();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function parseSiteJson(value) {
  const text = decodeHtml(value);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = JSON.parse(text.replace(/\\/g, ''));
  }
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  return parsed;
}

function attribute(tag, name) {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  const match = String(tag || '').match(pattern);
  return match ? decodeHtml(match[2]) : '';
}

function hexBytes(value) {
  const clean = String(value || '').replace(/[^0-9a-f]/gi, '');
  if (!clean || clean.length % 2) throw new Error('Invalid hex data');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function base64Bytes(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function decryptPlayerTabs(html) {
  const tag = String(html || '').match(/<[^>]*\bdata-tag1\b[^>]*>/i);
  const raw = attribute(tag && tag[0], 'data-tag1');
  if (!raw) return [];
  const data = parseSiteJson(raw);
  const ciphertext = data.ciphertext || data.ct;
  const iv = data.iv;
  const salt = data.salt || data.s;
  if (!ciphertext || !iv || !salt) return [];
  const password = await crypto.subtle.importKey('raw', new TextEncoder().encode(AES_PASSWORD), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexBytes(salt), iterations: 999, hash: 'SHA-512' }, password, 256);
  const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: hexBytes(iv) }, key, base64Bytes(ciphertext));
  const text = new TextDecoder().decode(plain).replace(/\\/g, '');
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  const tabs = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(tabs)) return [];
  return tabs.filter(tab => tab && tab.url && !/трейлер|trailer/i.test(tab.tabName || '')).map(tab => {
    try {
      const url = new URL(tab.url, 'https://uaserials.com/');
      return ALLOWED_SOURCE_HOSTS.has(url.hostname.toLowerCase()) ? url.toString() : '';
    } catch (_) {
      return '';
    }
  }).filter(Boolean);
}

function decodeFile(token) {
  try {
    let base64 = String(token).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    while (base64.length % 4) base64 += '=';
    const raw = atob(base64);
    if (raw.length < 2) return '';
    const seed = raw.charCodeAt(0);
    const bytes = new Uint8Array(raw.length - 1);
    for (let i = 1; i < raw.length; i++) bytes[i - 1] = raw.charCodeAt(i) ^ ((seed + 13 + 7 * (i - 1)) & 255);
    return new TextDecoder().decode(bytes);
  } catch (_) {
    return '';
  }
}

function extractStreams(value) {
  const text = String(value || '');
  const found = [];
  let match;
  const labelled = /\{([^}]+)\}\s*(https?:\/\/.*?)(?=\{[^}]+\}|$)/g;
  while ((match = labelled.exec(text))) {
    const hls = match[2].match(/https?:\/\/[^\s,)"']+\.m3u8(?:\?[^\s,)"']*)?/i);
    if (hls) found.push({ title: match[1], quality: match[1], url: hls[0] });
  }
  if (!found.length) {
    const hls = text.match(/https?:\/\/[^\s,)"']+\.m3u8(?:\?[^\s,)"']*)?/i);
    if (hls) found.push({ title: 'Tortuga', quality: 'auto', url: hls[0] });
  }
  return found;
}

function extractPlayerValue(html) {
  const text = String(html || '');
  const direct = extractStreams(text);
  if (direct.length) return direct.map(stream => stream.url).join(';');
  const patterns = [
    /(?:file|source|src|playlist|video|url)\s*[:=]\s*['"]([^'"]+)['"]/ig,
    /data-(?:file|source|src|playlist|url)\s*=\s*['"]([^'"]+)['"]/ig
  ];
  for (const pattern of patterns) {
    const values = [];
    let match;
    while ((match = pattern.exec(text))) values.push(match[1]);
    if (values.length) return values.join(';');
  }
  return '';
}

function decodePlayerValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return decodeFile(raw) || raw;
}

function parsePlayerStructure(value) {
  const decoded = decodePlayerValue(value).replace(/\\/g, '').trim();
  if (!decoded.startsWith('[')) return null;
  try {
    const seasons = JSON.parse(decoded);
    return Array.isArray(seasons) ? seasons : null;
  } catch (_) {
    return null;
  }
}

function getSigningKey() {
  const secret = globalThis.STREAM_SIGNING_KEY;
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('HLS proxy signing key is not configured');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function signedPayload(url, referer, expires) {
  return url.toString() + '\n' + referer + '\n' + String(expires);
}

async function signStreamUrl(rawUrl, referer, workerOrigin, expires) {
  const target = isHttpsUrl(rawUrl);
  if (!target) throw new Error('Invalid HLS URL');
  const ref = validReferer(referer);
  const exp = expires || Math.floor(Date.now() / 1000) + STREAM_TTL_SECONDS;
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload(target, ref, exp)));
  const out = new URL(workerOrigin + '/');
  out.searchParams.set('stream', '1');
  out.searchParams.set('url', target.toString());
  out.searchParams.set('referer', ref);
  out.searchParams.set('exp', String(exp));
  out.searchParams.set('sig', toBase64Url(new Uint8Array(signature)));
  return out.toString();
}

async function verifyStreamRequest(query, requestUrl) {
  const target = isHttpsUrl(query.get('url'));
  const ref = validReferer(query.get('referer'));
  const expires = Number(query.get('exp'));
  const signature = query.get('sig') || '';
  const now = Math.floor(Date.now() / 1000);
  if (!target || !Number.isInteger(expires) || expires <= now || expires > now + STREAM_TTL_SECONDS + 60) return null;
  if (target.hostname.toLowerCase() === requestUrl.hostname.toLowerCase()) return null;
  try {
    const key = await getSigningKey();
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), new TextEncoder().encode(signedPayload(target, ref, expires)));
    return valid ? { target, referer: ref, expires } : null;
  } catch (_) {
    return null;
  }
}

async function rewritePlaylist(text, baseUrl, referer, workerOrigin, expires) {
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.trim().charAt(0) === '#') {
      const uriPattern = /URI=(['"])(.*?)\1/g;
      let match;
      let cursor = 0;
      let rewritten = '';
      while ((match = uriPattern.exec(line))) {
        rewritten += line.slice(cursor, match.index);
        const absolute = new URL(match[2], baseUrl).toString();
        rewritten += 'URI=' + match[1] + await signStreamUrl(absolute, referer, workerOrigin, expires) + match[1];
        cursor = match.index + match[0].length;
      }
      if (cursor) lines[i] = rewritten + line.slice(cursor);
    } else {
      lines[i] = await signStreamUrl(new URL(line.trim(), baseUrl).toString(), referer, workerOrigin, expires);
    }
  }
  return lines.join('\n');
}

function copyMediaHeaders(upstream) {
  const headers = new Headers(CORS);
  ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified'].forEach(name => {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  });
  return headers;
}

async function handleStream(request, query, requestUrl) {
  const signed = await verifyStreamRequest(query, requestUrl);
  if (!signed) return new Response('Invalid or expired stream URL', { status: 403, headers: CORS });
  const headers = new Headers({ 'User-Agent': USER_AGENT, 'Accept': '*/*', 'Referer': signed.referer });
  const range = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  if (range) headers.set('Range', range);
  if (ifRange) headers.set('If-Range', ifRange);
  const upstream = await fetch(signed.target.toString(), { method: request.method, headers });
  const contentType = upstream.headers.get('Content-Type') || '';
  const isPlaylist = /\.m3u8$/i.test(signed.target.pathname) || /mpegurl/i.test(contentType);
  const responseHeaders = copyMediaHeaders(upstream);
  if (isPlaylist && request.method !== 'HEAD' && upstream.ok) {
    const baseUrl = isHttpsUrl(upstream.url) || signed.target;
    const body = await rewritePlaylist(await upstream.text(), baseUrl, signed.referer, requestUrl.origin, signed.expires);
    responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    responseHeaders.delete('Content-Length');
    responseHeaders.delete('Content-Range');
    return new Response(body, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function fetchSource(target, referer, method) {
  return fetch(target.toString(), {
    method: method || 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': referer
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
}

async function handle(request) {
  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams;
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: CORS });
  if (query.get('stream') === '1') {
    try { return await handleStream(request, query, requestUrl); }
    catch (_) { return new Response('Stream proxy failed', { status: 502, headers: CORS }); }
  }
  if (query.get('health') === '1') return json({ ok: true });

  const raw = query.get('url');
  if (!raw) return new Response('Missing url', { status: 400, headers: CORS });
  const target = isHttpsUrl(raw);
  if (!target) return new Response('Host not allowed', { status: 403, headers: CORS });
    if (query.get('resolve') === '1' && /\.m3u8$/i.test(target.pathname)) {
    try {
      return json({ ok: true, streams: [{ title: 'UASerials', quality: 'auto', url: await signStreamUrl(target.toString(), 'https://tortuga.tw/', requestUrl.origin) }] });
    } catch (_) {
      return json({ ok: false, error: 'Could not sign HLS URL' });
    }
  }
  if (!ALLOWED_SOURCE_HOSTS.has(target.hostname.toLowerCase())) return new Response('Host not allowed', { status: 403, headers: CORS });
  const defaultSourceRef = target.hostname.toLowerCase().includes('tortuga') ? 'https://uaserials.com/' : DEFAULT_REFERER;
  const referer = validReferer(query.get('referer'), defaultSourceRef);

  try {
    const upstream = await fetchSource(target, referer, request.method);
    if (query.get('players') === '1') {
      const html = await upstream.text();
      const players = await decryptPlayerTabs(html);
      return json({ ok: true, players, upstreamStatus: upstream.status });
    }
    if (query.get('resolve') === '1') {
      const html = await upstream.text();
      const file = extractPlayerValue(html);
      if (!file) return json({ ok: false, error: 'Player file not found', upstreamStatus: upstream.status });
      let decoded = file.split(';').map(decodePlayerValue).join(';');
      const episodeFile = query.get('episode_file');
      if (episodeFile) decoded = decodePlayerValue(episodeFile);
      else if (query.get('season') || query.get('episode')) {
        const seasons = parsePlayerStructure(file);
        const seasonNumber = Number(query.get('season')) || 1;
        const episodeNumber = Number(query.get('episode')) || 1;
        const season = (seasons || []).find((item, index) => Number(item.season || item.number || index + 1) === seasonNumber);
        const episode = season && (season.folder || season.episodes || []).find((item, index) => Number(item.number || item.episode || index + 1) === episodeNumber);
        if (episode && episode.file) decoded = decodePlayerValue(episode.file);
      }
      const found = extractStreams(decoded);
      if (!found.length) return json({ ok: false, error: 'HLS URL not found', upstreamStatus: upstream.status, playerStatus: upstream.status });
      const host = target.hostname.toLowerCase();
      const hlsReferer = host.endsWith('.wtf') ? 'https://tortuga.wtf/' : 'https://tortuga.tw/';
      const streams = await Promise.all(found.map(async stream => ({
        title: stream.title,
        quality: stream.quality,
        url: await signStreamUrl(stream.url, hlsReferer, requestUrl.origin)
      })));
      return json({ ok: true, streams, poster: null });
    }
    if (query.get('structure') === '1') {
      const html = await upstream.text();
      const file = extractPlayerValue(html);
      const seasons = file ? parsePlayerStructure(file) : null;
      if (!seasons) return json({ ok: false, error: 'Player structure not found', upstreamStatus: upstream.status });
      return json({ ok: true, seasons });
    }
    if (query.get('sign') === '1') {
      if (!/\.m3u8$/i.test(target.pathname)) return json({ ok: false, error: 'Only HLS playlists can be signed' });
      const hlsReferer = validReferer(query.get('referer'), 'https://tortuga.tw/');
      return json({ ok: true, url: await signStreamUrl(target.toString(), hlsReferer, requestUrl.origin) });
    }
    const responseHeaders = new Headers(CORS);
    responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'text/html; charset=utf-8');
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (_) {
    if (query.get('players') === '1') return json({ ok: true, players: [] });
    return query.get('resolve') === '1' || query.get('sign') === '1'
      ? json({ ok: false, error: 'Upstream request failed' })
      : new Response('Upstream request failed', { status: 502, headers: CORS });
  }
}

if (typeof module !== 'undefined') module.exports = { handle };
