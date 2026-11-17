// zonatmo.js — adaptador de la API JSON de ZonaTMO (zonatmo.net y zonatmo.org usan el mismo software).
// Endpoints verificados en vivo (2026-11):
//   GET  /wp-api/api/listing/manga?page&postsPerPage&orderBy&order&search&genres&status&demography&flags&types
//   GET  /wp-api/api/tops/views/yesterday?page&postsPerPage
//   GET  /wp-api/api/single/manga/{slug}
//   GET  /wp-api/api/single/manga/{slug}/chapters?page&postsPerPage&order
//   GET  /wp-api/api/single/manga/{slug}/{slug-de-capitulo}   -> chapter.jit + chapter.images
//   POST /wp-api/api/auth/login {email,password}              -> sesión (el sitio puede pedir Turnstile)
// Las imágenes de página viven en https://cdn.zonatmo.to/manga/{jit}/{archivo} y NO piden Referer.
// Las portadas viven en {base}/wp-content/uploads{ruta}.

import { fetchJson, fetchText, join, toItem, netError, UA, ztToken } from "./env.js";

const api = (src, path, params) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return join(src, "/wp-api/api" + path + qs);
};

function authHeads() {
  const t = ztToken();
  return t ? { Authorization: "Bearer " + t, "X-App": "manga" } : { "X-App": "manga" };
}

function coverUrl(src, cover) {
  if (!cover) return undefined;
  if (/^https?:\/\//.test(cover)) return cover;
  return join(src, "/wp-content/uploads" + (String(cover).startsWith("/") ? cover : "/" + cover));
}

/** El listado de la API como Items de Kino. */
function listingItems(src, data) {
  const items = (data && Array.isArray(data.items) ? data.items : [])
    .map((m) => toItem(src, {
      slug: m.slug,
      title: m.title || m.subtitle,
      overview: m.overview,
      poster: coverUrl(src, m.cover),
      adult: Number(m.is_erotic) === 1,
      rating: m.score != null && m.score > 0 ? Number(m.score) : undefined,
      year: Array.isArray(m.years) && m.years.length ? String(m.years[0]) : undefined,
      genres: genresOf(m),
    }))
    .filter(Boolean);
  const pag = data && data.pagination ? data.pagination : {};
  const next = pag.has_next ? String(Number(pag.current_page || 1) + 1) : null;
  return { items, next };
}

function genresOf(m) {
  if (!Array.isArray(m.genres)) return undefined;
  return m.genres.map((g) => {
    if (g && typeof g === "object") return String(g.name || g.slug || "");
    const id = String(g);
    return ZT_GENRES[id] || "";
  }).filter(Boolean).slice(0, 5);
}

// Géneros por id, según la configuración pública del sitio (siteConfig.datas.genres, capturada en 2026-11).
const ZT_GENRES = {
  "16": "Romance", "4": "Comedia", "15": "Drama", "5": "Fantasía", "2": "Acción", "103": "Boys Love",
  "33": "Recuentos de la vida", "23": "Vida Escolar", "3": "Aventura", "32": "Ecchi", "7": "Sobrenatural",
  "60": "Reencarnación", "8": "Harem", "6": "Magia", "36": "Psicológico", "40": "Misterio",
  "26": "Artes Marciales", "21": "Ciencia Ficción", "22": "Girls Love", "46": "Tragedia", "81": "Historia",
  "88": "Demonios", "116": "Superpoderes", "82": "Horror", "112": "Supervivencia", "181": "Gore",
  "1027": "Familia", "183": "Género Bender", "861": "Apocalíptico", "41": "Crimen", "49": "Thriller",
  "37": "Deporte", "147": "Realidad", "342": "Militar", "1109": "Guerra", "820": "Parodia",
  "345": "Vampiros", "403": "Música", "219": "Niños", "27": "Realidad Virtual", "144": "Mecha",
  "111": "Policiaco", "470": "Telenovela", "12868": "Sistema de Niveles", "99": "Samurái",
  "6198": "Animación", "356": "Ciberpunk", "1168": "Extranjero", "12915": "Academia", "12891": "Venganza",
};

/** Listado con orden y filtros. order: "new" (último capítulo) | "score" | "az" | "old". */
export async function list(src, { page = 1, order = "new", search, genreId, demography, flags, postsPerPage = 24 } = {}) {
  const orderBy = { new: "last_chapter_date", score: "score", az: "title", old: "manga_id" }[order] || "last_chapter_date";
  const dir = order === "az" ? "asc" : order === "old" ? "asc" : "desc";
  const params = { page: String(page), postsPerPage: String(postsPerPage), orderBy, order: dir };
  if (search) params.search = String(search).slice(0, 100);
  if (genreId) params.genres = String(genreId);
  if (demography) params.demography = String(demography);
  if (flags) params.flags = String(flags);
  const { ok, body, status } = await fetchJson(api(src, "/listing/manga", params), { heads: authHeads() });
  if (!ok || !body || body.error) netError(new Error("HTTP " + status), "ZonaTMO");
  return listingItems(src, body.data);
}

/** Lo más visto ayer. */
export async function tops(src, { page = 1, postsPerPage = 24 } = {}) {
  const { ok, body, status } = await fetchJson(api(src, "/tops/views/yesterday", { page: String(page), postsPerPage: String(postsPerPage) }), { heads: authHeads() });
  if (!ok || !body || body.error) netError(new Error("HTTP " + status), "ZonaTMO (populares)");
  return listingItems(src, body.data);
}

/** Búsqueda por texto (el mismo listado, con `search`). */
export async function search(src, q, { page = 1, postsPerPage = 24 } = {}) {
  return list(src, { page, order: "score", search: q, postsPerPage });
}

/** Detalle de un manga. */
export async function detail(src, slug) {
  const { ok, body, status } = await fetchJson(api(src, "/single/manga/" + encodeURIComponent(slug)), { heads: authHeads() });
  if (!ok || !body || body.error || !body.data) {
    const e = new Error("HTTP " + status);
    if (status === 404) { e.code = "not_found"; e.userMessage = "Este manga no está disponible en " + (src === "zo" ? "ZonaTMO.org" : "ZonaTMO") + "."; }
    netError(e, "el detalle");
  }
  const d = body.data;
  return {
    slug: d.slug,
    title: d.title || d.subtitle || slug,
    overview: d.overview ? String(d.overview) : undefined,
    poster: coverUrl(src, d.cover),
    adult: Number(d.is_erotic) === 1,
    score: d.score != null ? Number(d.score) : undefined,
    votes: d.vote_count,
    totalChapters: d.total_chapters,
    year: Array.isArray(d.years) && d.years.length ? String(d.years[0]) : undefined,
    genres: genresOf(d),
    statusName: statusName(d.status),
    demographyName: demographyName(d.demography),
  };
}

function nameOf(map, ids) {
  if (!Array.isArray(ids) || !ids.length) return undefined;
  const id = String(ids[0]);
  const g = map && map[id];
  return g && g.name ? String(g.name) : undefined;
}

// Nombres de estado y demografía según la config pública del sitio (siteConfig.datas, capturada en la exploración).
const STATUS = { 12: "Publicándose", 13: "Finalizado", 14: "En pausa", 19: "Publicándose", 198: "Cancelado", 766: "Finalizado" };
const DEMOG = { 13: "Shounen", 14: "Shoujo", 15: "Seinen", 16: "Josei", 1: "Shounen", 2: "Shoujo", 3: "Seinen", 4: "Josei" };
function statusName(ids) { return nameOf(STATUS, ids); }
function demographyName(ids) { return nameOf(DEMOG, ids); }

/** Lista de capítulos (de más nuevo a más viejo). */
export async function chapters(src, slug, { page = 1, postsPerPage = 50, order = "desc" } = {}) {
  const { ok, body, status } = await fetchJson(api(src, "/single/manga/" + encodeURIComponent(slug) + "/chapters", { page: String(page), postsPerPage: String(postsPerPage), order }), { heads: authHeads() });
  if (!ok || !body || body.error) netError(new Error("HTTP " + status), "los capítulos");
  const d = body.data || {};
  const items = (Array.isArray(d.items) ? d.items : []).map((c) => ({
    id: c.id,
    slug: c.slug,
    number: String(c.chapter_number || "").replace(/\.00$/, ""),
    title: c.title || ("Capítulo " + c.chapter_number),
    date: c.release_date ? String(c.release_date).slice(0, 10) : undefined,
    group: c.group && c.group.name ? String(c.group.name) : undefined,
  }));
  const pag = d.pagination || {};
  return { items, next: pag.has_next ? String(Number(pag.current_page || 1) + 1) : null, total: pag.total };
}

/**
 * Un capítulo con sus imágenes listas para el lector.
 * El jit de la API va incrustado en la ruta del CDN (lleva su propia "/").
 */
export async function chapter(src, slug, chapterSlug) {
  const { ok, body, status } = await fetchJson(api(src, "/single/manga/" + encodeURIComponent(slug) + "/" + encodeURIComponent(chapterSlug)), { heads: authHeads() });
  if (!ok || !body || body.error || !body.data || !body.data.chapter) {
    const e = new Error("HTTP " + status);
    if (status === 404) { e.code = "not_found"; e.userMessage = "Este capítulo ya no está disponible."; }
    netError(e, "el capítulo");
  }
  const ch = body.data.chapter;
  const jit = String(ch.jit || "");
  const pages = (Array.isArray(ch.images) ? ch.images : [])
    .slice()
    .sort((a, b) => Number(a.page_number || 0) - Number(b.page_number || 0))
    .map((im) => (im && im.image_url ? "https://cdn.zonatmo.to/manga/" + jit + "/" + im.image_url : null))
    .filter(Boolean);
  return {
    pages,
    number: String(ch.chapter_number || "").replace(/\.00$/, ""),
    title: ch.title || undefined,
    direction: ch.reading_direction === "rtl" ? "rtl" : "ltr",
    prev: ch.prev && ch.prev.slug ? String(ch.prev.slug) : null,
    next: ch.next && ch.next.slug ? String(ch.next.slug) : null,
  };
}

/** Intento de inicio de sesión con correo y contraseña (el sitio puede pedir la verificación de Cloudflare). */
export async function login(src, email, password) {
  const base = join(src, "/wp-api/api/auth/login");
  let body;
  try {
    const r = await kino.fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App": "manga" },
      body: JSON.stringify({ email, password }),
      timeoutMs: 15000,
    });
    body = r.json ? r.json() : null;
    if (r.ok && body && body.error === false) return { ok: true, token: body.data && (body.data.access_token || (body.data.user && body.data.user.token)) };
    if (body && body.message) {
      const m = String(body.message).toLowerCase();
      if (m.includes("turnstile") || m.includes("cloudflare") || m.includes("captcha")) {
        return { ok: false, message: "El sitio pidió su verificación anti-bot: usa «Entrar con ventana» en los ajustes." };
      }
      if (r.status === 401 || m.includes("credencial") || m.includes("incorrect")) return { ok: false, message: "Correo o contraseña incorrectos." };
      return { ok: false, message: String(body.message).slice(0, 160) };
    }
    return { ok: false, message: "El sitio no aceptó el inicio directo: usa «Entrar con ventana» en los ajustes." };
  } catch (e) {
    return { ok: false, message: "No se pudo contactar al sitio: usa «Entrar con ventana» en los ajustes." };
  }
}
