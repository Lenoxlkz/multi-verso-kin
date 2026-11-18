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
  ln: { name: "LegnNovels", host: "https://legnnovels.com", kind: "madara" },
};

// Fuentes de novelas (texto) frente a las de manga (imágenes): el lector cambia de modo.
export const NOVEL_SOURCES = ["sk", "mk", "as", "an", "dv", "ln"];

// Orden de las pestañas del Home: una por fuente, con sus secciones nativas.
export const HOME_TABS = ["zt", "ms", "sk", "mk", "as", "an", "dv", "ln", "zo", "mh"];

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
  const r = await kino.fetch(url, { headers: { ...BASE_HEADS, ...heads }, timeoutMs, method, body });
  const text = r.text ? r.text() : "";
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
