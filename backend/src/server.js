import http from 'node:http';
import { URL } from 'node:url';

const env = process.env;
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || '0.0.0.0';
const TIMEOUT = Number(env.REQUEST_TIMEOUT_MS || 15000);
const CACHE_TTL = Number(env.CACHE_TTL_MS || 120000);
const LAMPAC_BASE = (env.LAMPAC_BASE_URL || '').replace(/\/+$/, '');
const cache = new Map();

const json = (value, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(value) });
const error = (message, status = 502) => json({ ok: false, error: message }, status);
const clean = value => value == null ? '' : String(value).trim();
const first = (obj, keys) => keys.map(k => obj?.[k]).find(v => v !== undefined && v !== null && v !== '') ?? '';
const asArray = value => Array.isArray(value) ? value : [];
const keyOf = (p, action, q) => `${p}:${action}:${JSON.stringify(q)}`;

function readEnv(name, required = false) {
  const value = clean(env[name]);
  if (required && !value) throw new Error(`${name} is not configured`);
  return value;
}

function withQuery(base, params) {
  const u = new URL(base);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') u.searchParams.set(key, String(value));
  }
  return u;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { accept: 'application/json, text/plain, */*', 'user-agent': 'PrismakBackend/1.0', ...(options.headers || {}) }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    return { text, contentType: response.headers.get('content-type') || '' };
  } finally { clearTimeout(timer); }
}

async function fetchJson(url, options = {}) {
  const { text } = await fetchText(url, options);
  try { return JSON.parse(text); } catch { throw new Error('upstream returned invalid JSON'); }
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

function queryFrom(req) {
  const q = req.query || {};
  return {
    title: clean(q.title || q.name), original_title: clean(q.original_title || q.original_name),
    imdb_id: clean(q.imdb_id || q.imdb), tmdb_id: clean(q.tmdb_id || q.tmdb),
    kinopoisk_id: clean(q.kinopoisk_id || q.kinopoisk || q.kp), year: clean(q.year),
    movieid: clean(q.movieid), s: clean(q.s), e: clean(q.e), t: clean(q.t),
    ref: q.ref && typeof q.ref === 'object' ? q.ref : {}
  };
}

function item({ title, ref, poster = '', year = '', serial = false, ids = {} }) {
  return { title: clean(title), title_en: clean(ids.original_title || ids.title_en), year: clean(year), poster: clean(poster), serial: serial ? 1 : 0, ...ids, ref };
}

function streamsFrom(values) {
  return asArray(values).map((x, i) => {
    if (typeof x === 'string') return { title: `Потік ${i + 1}`, quality: 'auto', url: x };
    const url = first(x, ['url', 'file', 'src', 'stream', 'hls', 'm3u8', 'link']);
    return { title: first(x, ['title', 'name', 'voice', 'lang']) || `Потік ${i + 1}`, quality: first(x, ['quality', 'resolution']) || 'auto', url, ref: x?.ref };
  }).filter(x => x.url || x.ref);
}

function normalizeDirectResponse(data, fallbackTitle = '') {
  const body = data?.content || data?.result || data?.data || data;
  const raw = body?.streams || body?.players || body?.results || body?.sources || body?.files || body;
  const streams = streamsFrom(raw);
  if (streams.length) return { ok: true, type: 'movie', title: body?.title || fallbackTitle, streams };
  if (Array.isArray(body?.voices)) return { ok: true, type: 'series', title: body.title || fallbackTitle, voices: body.voices };
  return { ok: false, error: 'No playable streams in upstream response' };
}

async function lampac(source, action, q) {
  const u = withQuery(`${LAMPAC_BASE}/lite/${source}`, { ...q, action });
  return fetchJson(u);
}

async function videoHub(action, q) {
  const base = readEnv('VIDEOHUB_API_BASE', true).replace(/\/+$/, '');
  if (action === 'search' || action === 'content') {
    if (!q.kinopoisk_id) return { ok: true, items: [] };
    const data = await cached(keyOf('videohub', 'playlist', q), () => fetchJson(withQuery(`${base}/api/v1/player/sv/playlist`, { pub: 12, aggr: 'kp', id: q.kinopoisk_id }), { headers: { referer: env.VIDEOHUB_REFERER || 'https://hdkino.pub/' } }));
    const list = asArray(data?.items);
    if (action === 'search') return { ok: true, items: list.length ? [item({ title: q.title || q.original_title, ref: { provider: 'videohub', items: list, kinopoisk_id: q.kinopoisk_id }, serial: Boolean(data?.isSerial), ids: { kinopoisk_id: q.kinopoisk_id } })] : [] };
    if (!list.length) return { ok: false, error: 'VideoHUB: title not found' };
    const streams = list.filter(x => x.vkId).map(x => ({ title: x.voiceStudio || x.voiceType || 'VideoHUB', quality: '1080p', ref: { provider: 'videohub', vkId: x.vkId, title: q.title } }));
    return { ok: true, type: data?.isSerial ? 'series' : 'movie', title: q.title, streams };
  }
  if (action === 'stream') {
    const vkId = clean(q.ref?.vkId || q.ref?.vk_id || q.vkId);
    if (!vkId) return { ok: false, error: 'VideoHUB: vkId is required' };
    const raw = await fetchText(`${base}/api/v1/player/sv/video/${encodeURIComponent(vkId)}`, { headers: { referer: env.VIDEOHUB_REFERER || 'https://hdkino.pub/' } });
    const match = raw.text.match(/"hlsUrl"\s*:\s*"([^"]+)"/);
    const url = match?.[1]?.replaceAll('\\/', '/').replaceAll('u0026', '&');
    return url ? { ok: true, streams: [{ title: q.ref?.title || 'VideoHUB', quality: '1080p', url, hls_type: 'hlsjs' }] } : { ok: false, error: 'VideoHUB: HLS URL not found' };
  }
}

async function veoveo(action, q) {
  const base = readEnv('VEO_API_BASE', true).replace(/\/+$/, '');
  if (action === 'search') {
    if (q.movieid) return { ok: true, items: [item({ title: q.title, ref: { provider: 'veoveo', movieid: q.movieid }, ids: { movieid: q.movieid } })] };
    const catalogUrl = readEnv('VEO_CATALOG_URL');
    if (!catalogUrl) return { ok: false, error: 'VeoVeo: set VEO_CATALOG_URL to a current catalog JSON' };
    const catalog = await cached('veoveo:catalog', () => fetchJson(catalogUrl));
    const needle = (q.title || q.original_title).toLowerCase();
    const found = asArray(catalog).filter(x => `${x.title || ''} ${x.originalTitle || ''}`.toLowerCase().includes(needle)).slice(0, 20);
    return { ok: true, items: found.map(x => item({ title: x.title || x.originalTitle, year: x.year, poster: x.poster, ref: { provider: 'veoveo', movieid: x.id }, ids: { movieid: x.id, kinopoisk_id: x.kinopoiskId, imdb_id: x.imdbId }, serial: Boolean(x.serial) })) };
  }
  const movieid = clean(q.movieid || q.ref?.movieid);
  if (!movieid) return { ok: false, error: 'VeoVeo: movieid is required' };
  const data = await fetchJson(withQuery(`${base}/balancer-api/proxy/playlists/catalog-api/episodes`, { 'content-id': movieid }));
  if (action === 'content') {
    const episodes = asArray(data);
    const streams = episodes.flatMap(ep => asArray(ep.episodeVariants).map(v => ({ title: v.title || ep.title || 'VeoVeo', quality: '1080p', url: v.filepath, ref: { provider: 'veoveo', filepath: v.filepath, movieid } }))).filter(x => x.url);
    return streams.length ? { ok: true, type: 'movie', title: q.title, streams } : { ok: false, error: 'VeoVeo: no files found' };
  }
  if (action === 'stream') {
    const file = clean(q.ref?.filepath || q.ref?.file);
    if (!file) return { ok: false, error: 'VeoVeo: filepath is required' };
    if (/\.json(?:$|\?)/i.test(file)) {
      const parsed = await fetchJson(file);
      const url = first(asArray(parsed?.sources), ['link']);
      return url ? { ok: true, streams: [{ title: 'VeoVeo', quality: '1080p', url, hls_type: 'hlsjs' }] } : { ok: false, error: 'VeoVeo: parsed source not found' };
    }
    return { ok: true, streams: [{ title: 'VeoVeo', quality: '1080p', url: file, hls_type: /\.m3u8/i.test(file) ? 'hlsjs' : undefined }] };
  }
}

async function hdvb(action, q) {
  const api = readEnv('HDVB_API_BASE', true).replace(/\/+$/, '');
  const token = readEnv('HDVB_API_TOKEN', true);
  if (action === 'search' || action === 'content') {
    if (!q.kinopoisk_id) return { ok: true, items: [] };
    const list = await fetchJson(withQuery(`${api}/api/videos.json`, { token, id_kp: q.kinopoisk_id }), { headers: { referer: env.HDVB_REFERER || undefined } });
    if (action === 'search') return { ok: true, items: asArray(list).map(x => item({ title: q.title, ref: { provider: 'hdvb', iframe: x.iframe_url, translator: x.translator, type: x.type, serial_episodes: x.serial_episodes }, serial: x.type !== 'movie', ids: { kinopoisk_id: q.kinopoisk_id } })) };
    const streams = asArray(list).map(x => ({ title: x.translator || 'HDVB', quality: '1080p', ref: { provider: 'hdvb', iframe: x.iframe_url, translator: x.translator } }));
    return { ok: true, type: list?.[0]?.type === 'movie' ? 'movie' : 'series', title: q.title, streams };
  }
  if (action === 'stream') {
    const iframe = clean(q.ref?.iframe || q.iframe);
    if (!iframe) return { ok: false, error: 'HDVB: iframe is required' };
    const page = await fetchText(iframe, { headers: { referer: env.HDVB_REFERER || undefined } });
    const href = page.text.match(/"href"\s*:\s*"([^"]+)"/)?.[1]?.replaceAll('\\/', '/');
    const csrf = page.text.match(/"key"\s*:\s*"([^"]+)"/)?.[1]?.replaceAll('\\', '');
    let file = page.text.match(/"file"\s*:\s*"([^"]+)"/)?.[1]?.replaceAll('\\', '');
    if (!href || !csrf || !file) return { ok: false, error: 'HDVB: player metadata not found' };
    file = file.replace(/^\/playlist\//, '/').replace(/\.txt$/, '');
    const videoBase = readEnv('HDVB_VIDEO_BASE', true).replace(/\/+$/, '');
    const host = `${videoBase}/playlist/${file}.txt`;
    const playlist = await fetchText(host, { method: 'POST', headers: { accept: '*/*', origin: new URL(iframe).origin, referer: `${new URL(iframe).origin}/`, 'x-csrf-token': csrf } });
    const nested = playlist.text.match(/"file"\s*:\s*"([^"]+)"/)?.[1]?.replaceAll('\\', '');
    const hls = nested ? await fetchText(`${videoBase}/playlist/${nested.replace(/^\/playlist\//, '/').replace(/\.txt$/, '')}.txt`, { method: 'POST', headers: { accept: '*/*', origin: new URL(iframe).origin, referer: `${new URL(iframe).origin}/`, 'x-csrf-token': csrf } }) : playlist;
    const url = hls.text.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/)?.[0] || hls.text.match(/https?:\/\/[^\s"']+/)?.[0];
    return url ? { ok: true, streams: [{ title: q.ref?.translator || 'HDVB', quality: '1080p', url, hls_type: 'hlsjs' }] } : { ok: false, error: 'HDVB: HLS URL not found' };
  }
}

function decodeVibix(payload) {
  const reversed = Buffer.from(String(payload), 'utf8').toString().split('').reverse().join('');
  const bytes = Buffer.from(reversed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const key = Buffer.from('RySdvcyu5iTUxn97vn4HwoniwgxaCynA');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return bytes.toString('utf8');
}
async function vibix(action, q) {
  const template = readEnv('VIBIX_API_URL_TEMPLATE', true);
  if (action === 'search' || action === 'content') {
    const url = template.replaceAll('{imdb}', encodeURIComponent(q.imdb_id)).replaceAll('{kp}', encodeURIComponent(q.kinopoisk_id)).replaceAll('{title}', encodeURIComponent(q.title || q.original_title));
    const data = await fetchJson(url, { headers: { referer: env.VIBIX_REFERER || 'https://vibix.org/' } });
    return action === 'search' ? { ok: true, items: asArray(data?.items || data?.results || data).map(x => item({ title: first(x, ['title', 'name']), poster: first(x, ['poster', 'image']), ref: { provider: 'vibix', url: first(x, ['url', 'file', 'link']) }, ids: { imdb_id: x.imdb_id, kinopoisk_id: x.kinopoisk_id } })) } : normalizeDirectResponse(data, q.title);
  }
  if (action === 'stream') {
    const url = clean(q.ref?.url || q.url);
    if (!url) return { ok: false, error: 'Vibix: stream API URL is required in ref.url' };
    const data = await fetchJson(url, { headers: { referer: env.VIBIX_REFERER || 'https://vibix.org/' } });
    if (data?.v === 1 && data?.p) {
      const m3u8 = decodeVibix(data.p).match(/https:\/\/[^\s\r\n]+/i)?.[0];
      return m3u8 ? { ok: true, streams: [{ title: 'Vibix', quality: '1080p', url: m3u8, hls_type: 'hlsjs' }] } : { ok: false, error: 'Vibix: decoded HLS URL not found' };
    }
    return normalizeDirectResponse(data, q.title);
  }
}

const providers = { videohub: videoHub, veoveo, hdvb, vibix };

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return send(res, json({}, 204, { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization' }));
  if (env.BACKEND_TOKEN && req.headers.authorization !== `Bearer ${env.BACKEND_TOKEN}`) return send(res, error('Unauthorized', 401));
  if (url.pathname === '/health') return send(res, json({ ok: true, service: 'prismak-sources-backend', providers: Object.keys(providers), lampac: Boolean(LAMPAC_BASE) }));
  if (url.pathname === '/sources') return send(res, json({ ok: true, sources: Object.keys(providers).map(key => ({ key, name: key === 'videohub' ? 'VideoHUB' : key === 'veoveo' ? 'VeoVeo' : key.toUpperCase(), enabled: true, capabilities: { search: true, content: true, stream: true } })) }));
  const match = url.pathname.match(/^\/lite\/(videohub|veoveo|hdvb|vibix)$/i);
  if (!match) return send(res, error('Not found', 404));
  const source = match[1].toLowerCase();
  const q = Object.fromEntries(url.searchParams.entries());
  const action = clean(q.action || 'content').toLowerCase();
  const normalized = queryFrom({ query: q });
  try {
    const result = LAMPAC_BASE ? await lampac(source, action, q) : await providers[source](action, normalized);
    return send(res, json(result));
  } catch (e) { console.error(`[${source}/${action}]`, e); return send(res, error(`${source}: ${e.message}`)); }
}

function send(res, response) {
  const origin = env.CORS_ORIGIN || '*';
  res.writeHead(response.status, { ...response.headers, 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,OPTIONS', 'cache-control': 'no-store' });
  res.end(response.body);
}

http.createServer((req, res) => handle(req, res).catch(e => send(res, error(e.message || 'Internal error', 500)))).listen(PORT, HOST, () => console.log(`Prismak backend listening on http://${HOST}:${PORT}`));
