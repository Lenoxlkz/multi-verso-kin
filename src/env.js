// env.js — las diez fuentes de Multi-verso Kin y las utilidades comunes.
// Cada fuente tiene: id corto (prefijo de refs e ids), nombre, base https y un adaptador en
// zonatmo.js, manhwa.js o novels.js. zonatmo.org y manhwashot.lat son gemelos de zonatmo.net y
// manhwass.lat (mismo software): si un dominio se cae o bloquea, el otro sigue.

export const SOURCES = {
  zt: { name: "ZonaTMO", host: "https://zonatmo.net", kind: "zonatmo" },
  zo: { name: "ZonaTMO.org", host: "https://zonatmo.org", kind: "zonatmo" },
  ms: { name: "ManhwaSS", host: "https://manhwass.lat", kind: "manhwa" },
  mh: { name: "ManhwaShot", host: "https://manhwashot.lat", kind: "manhwa" },
  sk: { name: "Skynovels", host: "https://www.skynovels.net", kind: "skynovels" },
  mk: { name: "MatchaNovels", host: "https://matchanovels.com", kind: "matchanovels" },
  as: { name: "Astral Novels", host: "https://astralnovelstranslations.wordpress.com", kind: "astral" },
  an: { name: "Anslid", host: "https://anslid.com", kind: "madara" },
  dv: { name: "DevilNovels", host: "https://devilnovels.com", kind: "madara" },
};

// Fuentes de novelas (texto) frente a las de manga (imágenes): el lector cambia de modo.
export const NOVEL_SOURCES = ["sk", "mk", "as", "an", "dv"];

// Orden de las pestañas del Home: una por fuente, con sus secciones nativas.
export const HOME_TABS = ["zt", "ms", "sk", "mk", "as", "an", "dv", "zo", "mh"];

// Fuentes que arman las filas del Home (las gemelas se dejan para la búsqueda y el selector de fuentes).
export const HOME_SOURCES = ["zt", "ms"];

// Marcas de capítulo de pago en las fuentes: texto del título o clases de la fila. Mejor esfuerzo:
// hoy ninguna fuente lo publica de forma fiable; si un día lo marcan, el candado aparece solo.
export const PAGO_TEXT_RE = /premium|\bvip\b|\bde pago\b|🔒|\bloqueado\b|\bpaid\b|\bunlock\b|\boro\b|\bcoin\b/i;
export const PAGO_CLASS_RE = /premium|\block|\bpaid|\bvip/i;

const ID_RE = /^[A-Za-z0-9._~-]{1,120}$/;

/** Ref opaco de un manga: "<fuente>|m|<slug>". Es la única llave que viaja entre Kino y el plugin. */
export function mangaRef(src, slug) {
  return src + "|m|" + String(slug);
}
/** Ref de un capítulo: "<fuente>|c|<slug del manga>|<slug o número del capítulo>". */
export function chapterRef(src, mangaSlug, chapterSlug) {
  return src + "|c|" + String(mangaSlug) + "|" + String(chapterSlug);
}
/** Lee un ref: devuelve { src, kind, a, b } o null si no es de este plugin. */
export function parseRef(ref) {
  const parts = String(ref || "").split("|");
  if (parts.length < 3) return null;
  const [src, kind, ...rest] = parts;
  if (!SOURCES[src]) return null;
  return { src, kind, a: rest[0], b: rest.slice(1).join("|") };
}

/** Un manga del sitio como Item de Kino. `open.screen` hace que el toque abra la pantalla propia. */
export function toItem(src, m) {
  const slug = String(m.slug);
  if (!slug || !ID_RE.test(slug)) return null;
  const title = String(m.title || slug).slice(0, 200) || slug;
  const item = {
    id: src + "-" + slug,
    ref: mangaRef(src, slug),
    title,
    kind: "movie",
    overview: m.overview ? String(m.overview).slice(0, 300) : undefined,
    poster: m.poster || undefined,
    genres: Array.isArray(m.genres) ? m.genres.slice(0, 5).map((g) => String(g).slice(0, 30)) : undefined,
    badges: [SOURCES[src].name],
    lang: "es",
  };
  if (m.year) item.year = String(m.year);
  if (m.rating != null && Number.isFinite(Number(m.rating))) item.rating = Number(m.rating);
  if (m.adult) item.adult = true;
  // El toque abre la pantalla del plugin (detalle del manga) en vez de la página de Kino.
  item.open = { screen: { args: { r: item.ref, t: title } } };
  return item;
}

/** Recorta un texto sin partir un par sustituto (emoji, kanji…). */
export function clip(text, max) {
  let t = String(text == null ? "" : text).slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t;
}

/** Une la base de una fuente con una ruta, sin dobles barras. */
export function join(src, path) {
  return SOURCES[src].host + (String(path).startsWith("/") ? path : "/" + path);
}

/**
 * Envoltorio de kino.fetch con reintento corto entre los dominios gemelos.
 * `heads` son cabeceras extra (Accept, Cookie, Authorization…); Kino quita las que no corresponden.
 */
export async function fetchText(url, { heads = {}, timeoutMs = 12000, method = "GET", body } = {}) {
  const hs = { ...BASE_HEADS, ...heads };
  if (!hs.Cookie) {
    const cf = cfCookieHead(url);
    if (cf) hs.Cookie = cf;
  }
  const r = await kino.fetch(url, { headers: hs, timeoutMs, method, body });
  const text = r.text ? r.text() : "";
  noteHttp(url, r.status, text);
  return { status: r.status, ok: r.ok, text, headers: r.headers || {} };
}

export async function fetchJson(url, opts) {
  const { status, ok, text } = await fetchText(url, opts);
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status, ok, body };
}

// User-Agent interno: UNA constante para todas las peticiones. Si Cloudflare o una fuente
// cambian su detección, se rota cambiando solo esta línea (y el build se re-firma).
export const UA = "Mozilla/5.0 (Linux; Android 17; SM-A102U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Mobile Safari/537.36";
// Cabeceras de base de toda petición a las fuentes: cada adaptador puede sobrescribir una
// concreta (Cookie, Referer…), pero el UA, el Accept y el idioma van siempre igual.
export const BASE_HEADS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.7",
};

// ---------- velocidad ----------
// Los dominios gemelos (zonatmo.org, manhwashot.lat) pueden estar lentos o bloqueados:
// se les da un plazo corto para que no frenen la búsqueda; los primarios tienen el normal.

// ---------- imágenes: UA interno y Referer en TODOS los nodos ----------
// El contrato permite headers por nodo de imagen (KinoScreenImageHeaders: Referer y User-Agent).
// Sin esto, el descargador de Kino pide las imágenes con su propio agente y varios hosts
// (hotlink-check o Cloudflare) responden 403: la imagen queda en negro. Las fuentes amistosas
// (ZonaTMO, ManhwaSS) aceptan ambos modos: verificado con peticiones reales.
// Hosts que exigen Referer propio en sus imágenes (solo con evidencia; añadir por fuente).
const IMG_REFERER = { "astralnovelstranslations.wordpress.com": true };

/**
 * Cabeceras para descargar una imagen: el UA interno SIEMPRE (prioritario); el Referer del
 * propio host solo cuando la fuente lo requiere (mapa IMG_REFERER) o se fuerza. `force`
 * admite true (Referer sí), false (nunca) y undefined (lo decide el mapa por host).
 */
export function imgHeads(url, force) {
  try {
    const u = String(url || "");
    const m = /^(https?:\/\/[^\/]+)/.exec(u);
    if (!m) return undefined;
    const h = { "User-Agent": UA };
    const host = m[1].replace(/^https?:\/\//, "").replace(/^www\./, "");
    const wantRef = force === true || (force !== false && Boolean(IMG_REFERER[host]));
    if (wantRef) h["Referer"] = m[1] + "/";
    return h;
  } catch { return undefined; }
}

// ---------- jarra de cookies Cloudflare por host ----------
// La ventana visual (kino.visualBrowser) deja cf_clearance cuando la persona completa el
// desafío; sin `storeAs` los valores vuelven en el resultado y los guardo por host aquí.
// fetchText los añade como cabecera Cookie para ese host (mismo UA que la ventana: la
// cookie queda ligada al mismo fingerprint que usan las peticiones del plugin).
const CFJAR_KEY = "cfjar";

function cfLoad() {
  try {
    const r = kino.storage.get(CFJAR_KEY);
    return r ? JSON.parse(r) : {};
  } catch { return {}; }
}

/** Guarda las cookies de un desafío resuelto para el host (cf_clearance, __cf_bm…). */
export function cfSaveCookies(host, cookies) {
  try {
    const jar = cfLoad();
    const limpio = {};
    for (const [k, v] of Object.entries(cookies || {})) if (k && v) limpio[k] = String(v);
    if (!Object.keys(limpio).length) return;
    jar[host] = { t: Date.now(), c: limpio };
    kino.storage.set(CFJAR_KEY, JSON.stringify(jar));
  } catch { /* lleno: la jarra es optativa */ }
}

/** Cabecera Cookie guardada para el host de la URL, o undefined. */
export function cfCookieHead(url) {
  try {
    const m = /^(https?:\/\/[^\/]+)/.exec(String(url || ""));
    if (!m) return undefined;
    const host = m[1].replace(/^https?:\/\//, "");
    const e = cfLoad()[host];
    if (!e || !e.c) return undefined;
    const parts = Object.entries(e.c).filter(([k, v]) => k && v).map(([k, v]) => k + "=" + v);
    return parts.length ? parts.join("; ") : undefined;
  } catch { return undefined; }
}

// ---------- estado Cloudflare PERSISTENTE por host ----------
// La marca vive en kino.storage («cfseen»): a diferencia del registro en memoria (20 s),
// sobrevive al cierre del plugin, así el panel de Cloudflare no desaparece a los pocos segundos
// mientras el sitio siga reteniendo o bloqueando (TTL 24 h).
const CFSEEN_KEY = "cfseen";
const CFSEEN_TTL = 24 * 3600 * 1000;

function cfSeenLoad() {
  try { const r = kino.storage.get(CFSEEN_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

export function cfMarkChallenge(host, kind) {
  try {
    const jar = cfSeenLoad();
    jar[String(host).replace(/^https?:\/\//, "")] = { t: Date.now(), k: kind === "blocked" ? "blocked" : "challenge" };
    kino.storage.set(CFSEEN_KEY, JSON.stringify(jar));
  } catch { /* optativa */ }
}

export function cfClearChallenge(host) {
  try {
    const jar = cfSeenLoad();
    host = String(host).replace(/^https?:\/\//, "");
    if (jar[host]) { delete jar[host]; kino.storage.set(CFSEEN_KEY, JSON.stringify(jar)); }
  } catch { /* optativa */ }
}

/** Estado Cloudflare persistente del host: { kind, ageMs } o null. */
export function cfStateFor(hostUrl) {
  try {
    const m = /^(https?:\/\/[^\/]+)/.exec(String(hostUrl || ""));
    if (!m) return null;
    const e = cfSeenLoad()[m[1].replace(/^https?:\/\//, "")];
    if (!e || !e.k) return null;
    const ageMs = Date.now() - (e.t || 0);
    if (ageMs > CFSEEN_TTL) return null;
    return { kind: e.k, ageMs };
  } catch { return null; }
}

/** Borra la pre-clearance (cookies) y la marca de un host (botón de Ajustes). */
export function cfForget(hostUrl) {
  try {
    const m = /^(https?:\/\/[^\/]+)/.exec(String(hostUrl || ""));
    if (!m) return;
    const host = m[1].replace(/^https?:\/\//, "");
    const jar = cfLoad();
    if (jar[host]) { delete jar[host]; kino.storage.set(CFJAR_KEY, JSON.stringify(jar)); }
    cfClearChallenge(host);
  } catch { /* optativa */ }
}

/** Estado legible para Ajustes: { kind, ageMs, cookie: { ageH, names } } o null si no hay nada. */
export function cfStatus(hostUrl) {
  try {
    const m = /^(https?:\/\/[^\/]+)/.exec(String(hostUrl || ""));
    if (!m) return null;
    const host = m[1].replace(/^https?:\/\//, "");
    const st = cfStateFor(hostUrl);
    const e = cfLoad()[host];
    const cookie = e && e.c && Object.keys(e.c).length
      ? { ageH: Math.round((Date.now() - (e.t || 0)) / 360000) / 10, names: Object.keys(e.c) }
      : null;
    if (!st && !cookie) return null;
    return { kind: st && st.kind, ageMs: st && st.ageMs, cookie };
  } catch { return null; }
}

// Registro corto de los últimos resultados HTTP por host: permite detectar un desafío de
// Cloudflare a partir de las respuestas que ya llegaron (sin peticiones de control extra).
let httpLog = [];

function noteHttp(url, status, text) {
  try {
    const m = /^(https?:\/\/[^\/]+)/.exec(String(url || ""));
    if (!m) return;
    const host = m[1];
    httpLog.push({ host, status: Number(status) || 0, sample: String(text || "").slice(0, 4000), t: Date.now() });
    if (httpLog.length > 12) httpLog = httpLog.slice(-12);
    // marca o borra el estado persistente según lo que RESPONDIÓ (cero peticiones extra)
    const kind = cfClassify(Number(status) || 0, text);
    if (kind) cfMarkChallenge(host, kind);
    else if (Number(status) === 200) cfClearChallenge(host);
  } catch { /* el diagnóstico no debe romper nada */ }
}

/** ¿Hubo un desafío de Cloudflare en este host en la última llamada (20 s)? */
export function cfChallengeSeen(hostUrl) {
  if (cfStateFor(hostUrl)) return true;
  try {
    const m = /^(https?:\/\/[^\/]+)/.exec(String(hostUrl || ""));
    if (!m) return false;
    const now = Date.now();
    return httpLog.some((e) => e.host === m[1] && now - e.t < 20000 && isCfChallenge(e.status, e.sample));
  } catch { return false; }
}

/**
 * Qué responde Cloudflare y QUÉ SE PUEDE HACER con ello: hay dos muros que se parecen.
 * - "challenge": desafío soluble (Just a moment, challenge-platform…). La ventana lo resuelve
 *   una vez y deja cf_clearance: las siguientes peticiones pasan mientras la cookie valga
 *   (pre-clearance; Turnstile emite la cookie tras la verificación satisfactoria).
 * - "blocked": bloqueo de firewall (1010 firma baneada «Access denied… used Cloudflare»,
 *   1020 «Sorry, you have been blocked»): la regla corre ANTES de cualquier desafío, así que
 *   NI la ventana NI cf_clearance lo saltan; el mensaje dice la verdad y sugiere otra red.
 */
export function cfClassify(status, text) {
  const t = String(text || "").slice(0, 4000);
  if (status === 403 || status === 429 || status === 503) {
    if (/sorry, you have been blocked|you are unable to access|banned your access based on your browser|used cloudflare to restrict access|attention required|access denied/i.test(t)) return "blocked";
    if (/just a moment|challenge-platform|cf-browser-verification|cf_chl_|turnstile|checking your browser|enable javascript and cookies/i.test(t)) return "challenge";
    return "blocked"; // 403 sin marca conocida: mensaje honesto mejor que prometer una ventana
  }
  // algunos desafíos se sirven con 200 (la página retadora y su JS): solo marcas muy fuertes
  if (status === 200 && /challenge-platform|cf_chl_|cf-browser-verification/i.test(t)) return "challenge";
  return null;
}

/** ¿La respuesta es un desafío SOLUBLE de Cloudflare? (la ventana + cf_clearance lo resuelven) */
export function isCfChallenge(status, text) {
  return cfClassify(status, text) === "challenge";
}

export function timeoutFor(src) {
  return (src === "zo" || src === "mh") ? 5000 : 12000;
}

// Caché en kino.storage (lectura síncrona: la portada pinta al instante en la segunda visita).
// Los datos descargados y las credenciales NO pasan por aquí: los ajustes de tipo password los guarda Kino
// y las descargas viven en sus propias claves («dl:…»), fuera del recorte de la caché.
export const TTL = { list: 600000, rows: 600000, detail: 1800000, chapter: 300000, search: 300000 };

export function cacheKey(...parts) {
  return ("c:" + parts.join("|")).slice(0, 250);
}

export function cacheGet(key, ttlMs) {
  try {
    const raw = kino.storage.get(key);
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (!e || typeof e.t !== "number" || !("d" in e)) return null;
    if (Date.now() - e.t > ttlMs) return null;
    return e.d;
  } catch { return null; }
}

export function cacheSet(key, data) {
  try {
    kino.storage.set(key, JSON.stringify({ t: Date.now(), d: data }));
    pruneCache();
  } catch { /* almacenamiento lleno: la caché es optativa */ }
}

function pruneCache() {
  try {
    const keys = kino.storage.keys().filter((k) => k.indexOf("c:") === 0);
    const now = Date.now();
    const vivas = [];
    for (const k of keys) {
      let t = 0;
      try {
        const e = JSON.parse(kino.storage.get(k) || "null");
        t = e && e.t || 0;
      } catch { t = 0; }
      // vencida (>24 h) o podrida: fuera de una vez; la caché no acumula basura
      if (!t || now - t > 86400000) {
        try { kino.storage.remove(k); } catch { /* sigue */ }
      } else {
        vivas.push({ k, t });
      }
    }
    if (vivas.length <= 90) return;
    vivas.sort((x, y) => x.t - y.t);
    for (const v of vivas.slice(0, vivas.length - 90)) {
      try { kino.storage.remove(v.k); } catch { /* sigue */ }
    }
  } catch { /* la purga es optativa */ }
}

/** Convierte un fallo de red en el error tipado de Kino (mensajes en español, cortos). */
export function netError(e, what) {
  if (e && e.code) throw e;
  const msg = "No se pudo leer " + (what || "la fuente") + " (" + String((e && e.message) || "red").slice(0, 60) + ")";
  throw kino.error("unavailable", msg.slice(0, 200));
}

/** Token opcional de ZonaTMO guardado por la ventana de inicio de sesión (ajuste tipo password). */
export function ztToken() {
  try {
    const raw = kino.config.get("zt_token");
    if (!raw) return null;
    const data = JSON.parse(raw);
    const t = data && (data.access_token || data.token);
    return typeof t === "string" && t.length > 10 ? t : null;
  } catch { return null; }
}

/** Cookies de Manhwa guardadas por la ventana de inicio de sesión (ajuste tipo password). */
export function msCookie() {
  try {
    const raw = kino.config.get("ms_cookie");
    if (!raw) return null;
    const data = JSON.parse(raw);
    const parts = [];
    for (const [k, v] of Object.entries(data || {})) {
      if (typeof v === "string" && v) parts.push(k + "=" + v);
    }
    return parts.length ? parts.join("; ").slice(0, 2000) : null;
  } catch { return null; }
}
