// devilnovels.js — adaptador de RASPAJE HTML para DevilNovels (dv).
// devilnovels.com NO es madara (a diferencia de anslid.com, que sí lo es): es un WordPress propio
// con las novelas en la RAÍZ del dominio y los capítulos colgados de su novela con la id de post:
//   • /<novela>/                                  — la ficha: título, portada, sinopsis, géneros y capítulos
//   • /<novela>/<capitulo>/<id>/                  — el capítulo; el slug acaba en «-capitulo-N» y la id es el post
//   • /listado-de-novelas, /novelas-finalizadas   — los listados propios del sitio
//   • /?s=<texto>                                 — la búsqueda estándar de WordPress
// URLs reales verificadas en el índice del sitio (2026-11): /esclavo-de-las-sombras,
// /esclavo-de-las-sombras/esclavo-de-las-sombras-capitulo-1889/124182, /esclavo-de-las-sombras/
// shadow-slave-capitulo-1-2/116637, /nine-star-hegemon-act/nine-star-hegemon-body-art-capitulo-6007/162105,
// /martial-god-asura/martial-god-asura-capitulo-6556/197310. El adaptador de madara (que pedía
// /novela/…, un prefijo que aquí NO existe) es lo que dejaba la fuente muerta.
// El slug interno del capítulo es «<slug del cap>.<id>»: los slugs de WP no llevan punto, así que
// el último punto separa siempre la id. Los vecinos salen de la lista en caché (una raspa, el resto no).

import { fetchText, toItem, netError, timeoutFor, PAGO_TEXT_RE } from "./env.js";

const MAX_CAPS = 800; // tope de capítulos por obra (el detalle de Kino enseña 250)
const RUTAS_FIJAS = /^(listado-de-novelas|novelas-finalizadas|imagenes|membership-join|membership-account|memberships?|wp-login|login|register|registro|perfil|mi-cuenta|historial|dmca|politica-de-privacidad|politica-privacidad|contacto|feed|author|tag|category|page|wp-content|wp-admin|wp-json)(\/|$)/i;

// ---------- red ----------

async function getHtml(path, { what = "DevilNovels", timeout } = {}) {
  const r = await fetchText("https://devilnovels.com" + path, {
    heads: { Accept: "text/html", Referer: "https://devilnovels.com/" },
    timeoutMs: timeout || timeoutFor("dv"),
  });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "No está disponible en DevilNovels."; }
    netError(e, what);
  }
  return r.text;
}

// ---------- utilidades ----------

function unescapeHtml(t) {
  return String(t || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#039;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; } });
}

function clean(s) {
  return unescapeHtml(String(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** «capitulo-1889» → «1889»; «capitulo-1-2» → «1.2» (la segunda parte del capítulo dividido). */
function numDe(slugCap) {
  const m = /capitulo-([0-9]+(?:-[0-9]+)*)/i.exec(String(slugCap || ""));
  if (!m) return "";
  return m[1].indexOf("-") >= 0 ? m[1].replace(/-/g, ".") : m[1];
}

/** ¿Es un enlace de novela raíz? Un solo segmento que no es una ruta fija del sitio. */
function esNovelaSlug(s) {
  return /^[a-z0-9][a-z0-9-]{1,99}$/.test(s) && !RUTAS_FIJAS.test(s) && !/-capitulo-\d/.test(s);
}

/** Tarjetas de novela: enlaces raíz «/<slug>» con el título dentro del enlace y la portada justo encima. */
function novelCards(html, limit) {
  const out = [], seen = {};
  const re = /href="(?:https?:\/\/(?:www\.)?devilnovels\.com)?\/([a-z0-9][a-z0-9-]{0,99})\/?"[^>]*>([^<]{0,200})</gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (limit && out.length >= limit) break;
    const slug = m[1];
    if (seen[slug] || !esNovelaSlug(slug)) continue;
    seen[slug] = true;
    let title = clean(m[2]);
    if (title.length < 3) {
      const win = html.slice(Math.max(0, m.index - 2600), m.index + 1200);
      const h = win.match(/(?:title|alt)="([^"]{3,200})"/) || win.match(/<h[1-6][^>]*>\s*([^<]{3,200})</);
      if (h) title = clean(h[1]);
    }
    if (title.length < 3) title = slug.replace(/-/g, " ");
    // la portada es la imagen más cercana POR ENCIMA del enlace (la de debajo es la tarjeta siguiente)
    let poster = "";
    const encima = html.slice(Math.max(0, m.index - 2600), m.index);
    const im = encima.match(/<img[^>]+(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/);
    if (im && !/dflazy|\/images\/loading|placeholder|\bdummy\b|logo|avatar/i.test(im[1])) {
      poster = im[1].replace(/&amp;/g, "&");
    }
    out.push({ slug, title, poster: poster || undefined });
  }
  return out;
}

function asItems(list) {
  return list.map((m) => toItem("dv", m)).filter(Boolean);
}

// ---------- capítulos: lista en caché (2 h) como las demás fuentes ----------

const CAPS_TTL = 7200000;
const CAPS_CACHE = new Map();

function capsCachePut(slug, caps) {
  CAPS_CACHE.set(slug, { caps, ts: Date.now() });
  if (CAPS_CACHE.size > 12) CAPS_CACHE.delete(CAPS_CACHE.keys().next().value);
}

/** Filas de capítulo: enlaces «/<novela>/<capitulo>/<id>» de la ficha (los hijos de ESTA novela). */
function capRows(html, slug) {
  const map = new Map();
  const re = new RegExp("href=\"(?:https?:\\/\\/(?:www\\.)?devilnovels\\.com)?\\/" + slug +
    "\\/([a-z0-9-]+)\\/(\\d{2,10})\\/?\"", "gi");
  let m;
  while ((m = re.exec(html)) !== null && map.size < MAX_CAPS + 200) {
    const capSlug = m[1], id = m[2];
    if (!/capitulo/i.test(capSlug) || map.has(id)) continue;
    const near = html.slice(Math.max(0, m.index - 400), m.index + 600);
    map.set(id, {
      capSlug,
      id,
      number: numDe(capSlug) || id,
      pago: PAGO_TEXT_RE.test(near),
    });
  }
  // plan B: si el sitio renombra los capítulos (sin «capitulo»), coge los hijos con id igualmente
  if (!map.size) {
    const re2 = new RegExp("href=\"(?:https?:\\/\\/(?:www\\.)?devilnovels\\.com)?\\/" + slug +
      "\\/([a-z0-9-]+)\\/(\\d{2,10})\\/?\"", "gi");
    let m2;
    while ((m2 = re2.exec(html)) !== null && map.size < MAX_CAPS) {
      if (map.has(m2[2])) continue;
      map.set(m2[2], { capSlug: m2[1], id: m2[2], number: numDe(m2[1]) || m2[2], pago: false });
    }
  }
  // la id de post crece con el tiempo: ordenar por id es el orden cronológico real
  return [...map.values()].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)).slice(0, MAX_CAPS);
}

async function capsDe(slug) {
  const c = CAPS_CACHE.get(slug);
  if (c && Date.now() - c.ts < CAPS_TTL) return c.caps;
  const html = await getHtml("/" + slug + "/", { what: "la novela en DevilNovels" });
  const caps = capRows(html, slug);
  if (caps.length) capsCachePut(slug, caps);
  return caps;
}

// ---------- interfaz del adaptador ----------

export async function search(src, q) {
  const t = String(q || "").trim();
  if (!t) return { items: [] };
  // la búsqueda estándar de WordPress (la misma que usa el sitio)
  try {
    const html = await getHtml("/?s=" + encodeURIComponent(t), { what: "la búsqueda en DevilNovels" });
    const items = asItems(novelCards(html, 30));
    if (items.length) return { items };
  } catch { /* cae al listado */ }
  // plan B: el listado completo del sitio, filtrado por texto (es una sola página alfabética)
  const html = await getHtml("/listado-de-novelas", { what: "el listado de DevilNovels" });
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const qb = norm(t);
  const cards = novelCards(html, 400).filter((c) => norm(c.title).indexOf(qb) >= 0 || norm(c.slug).indexOf(qb) >= 0);
  return { items: asItems(cards.slice(0, 30)) };
}

export async function home(src) {
  // las secciones nativas del sitio: su ranking (home), su listado y sus finalizadas
  const settled = await Promise.allSettled([
    getHtml("/"),
    getHtml("/listado-de-novelas"),
    getHtml("/novelas-finalizadas"),
  ]);
  const secs = [
    { id: "ranking", t: "Ranking de novelas", te: "Novel ranking", i: 0, n: 18 },
    { id: "todas", t: "Listado de novelas", te: "All novels", i: 1, n: 18 },
    { id: "finalizadas", t: "Novelas finalizadas", te: "Finished novels", i: 2, n: 18 },
  ];
  const out = [];
  for (const s of secs) {
    const p = settled[s.i];
    if (p.status !== "fulfilled" || !p.value) continue;
    const items = asItems(novelCards(p.value, s.n));
    if (items.length) out.push({ id: "dv-" + s.id, title: s.t, titleEn: s.te, items });
  }
  return out;
}

export async function detail(src, slug) {
  const html = await getHtml("/" + slug + "/", { what: "la novela en DevilNovels" });
  const pick = (re) => { const m = html.match(re); return m ? clean(m[1]) : ""; };
  let poster = pick(/property="og:image"[^>]*content="([^"]+)"/) || pick(/content="([^"]+)"[^>]*property="og:image"/);
  if (poster) poster = poster.replace(/&amp;/g, "&");
  let overview = pick(/<meta name="description" content="([^"]{10,600})"/) || pick(/property="og:description"[^>]*content="([^"]+)"/);
  if (!overview) {
    const sy = html.match(/class="[^"]*(?:summary__content|synopsis|sinopsis)[^"]*"[^>]*>([\s\S]{10,900}?)<\/div>/);
    if (sy) overview = clean(sy[1]);
  }
  const genres = [];
  const g0 = html.match(/G[eé]neros?:\s*(?:<\/[^>]+>\s*)*([^<]{3,200})/i);
  if (g0) {
    for (const g of g0[1].split(/[,;]\s*/)) {
      const t = clean(g);
      if (t && genres.length < 6) genres.push(t);
    }
  }
  if (!genres.length) {
    const gre = /href="[^"]*\/(?:tag|genre|genero)\/[^"]*"[^>]*>([^<]{2,40})</gi;
    let g;
    while ((g = gre.exec(html)) !== null && genres.length < 6) {
      const t = clean(g[1]);
      if (t && genres.indexOf(t) < 0) genres.push(t);
    }
  }
  const caps = capRows(html, slug);
  if (caps.length) capsCachePut(slug, caps);
  return {
    slug,
    title: pick(/property="og:title"[^>]*content="([^"]+)"/) ||
      pick(/<h1[^>]*class="[^"]*(?:post-title|entry-title)[^"]*"[^>]*>([^<]{1,220})</) ||
      pick(/<h1[^>]*>([^<]{1,220})<\/h1>/) ||
      slug.replace(/-/g, " "),
    overview: overview || undefined,
    poster: poster || undefined,
    genres,
    totalChapters: caps.length,
  };
}

/** La ficha necesita la lista: la expone novels.js para montar los capítulos con vecinos. */
export async function capsList(src, slug) {
  const caps = await capsDe(slug);
  return caps.map((c) => ({
    slug: c.capSlug + "." + c.id,
    number: c.number,
    title: "Capítulo " + c.number,
    pago: c.pago,
  }));
}

export async function chapter(src, slug, capId) {
  // «<cap-slug>.<id>» → /<novela>/<cap-slug>/<id>/  (los slugs de WP no llevan punto)
  const punto = String(capId || "").lastIndexOf(".");
  if (punto <= 0) netError({ message: "capítulo desconocido" }, "el capítulo");
  const capSlug = String(capId).slice(0, punto);
  const id = String(capId).slice(punto + 1);
  if (!/^[a-z0-9-]+$/i.test(capSlug) || !/^\d+$/.test(id)) netError({ message: "capítulo desconocido" }, "el capítulo");
  const html = await getHtml("/" + slug + "/" + capSlug + "/" + id + "/", { what: "el capítulo en DevilNovels" });

  // el cuerpo del capítulo: el contenedor que traiga más texto de los habituales (el tema es propio,
  // así que se prueban los marcadores estándar de WordPress y lectores, y si no hay ninguno, todo)
  let seg = "";
  const marcas = [
    'class="reading-content"', 'id="chapter-content"', 'class="chapter-content"',
    'class="entry-content"', 'class="post-content"', 'class="text-content"',
    'class="content-read"', 'class="chapterbody"', 'itemprop="articleBody"', "<article",
  ];
  for (const marca of marcas) {
    const i = html.indexOf(marca);
    if (i >= 0) { seg = html.slice(i, i + 500000); break; }
  }
  if (!seg) seg = html.slice(0, 500000);
  // corta el ruido del pie (comentarios, navegación, aviso del sitio) antes de convertir a párrafos
  const cortes = ["novelaschinas", "comments-area", "id=\"respond\"", "post-navigation", "related-posts", "manga-discussion", "membership"];
  for (const c of cortes) {
    const j = seg.indexOf(c);
    if (j > 500) seg = seg.slice(0, j);
  }
  const p = htmlToParagraphs(seg);

  // vecinos desde la lista en caché (orden cronológico por id: prev = anterior, next = siguiente)
  let prev = null, next = null;
  try {
    const caps = await capsDe(slug);
    const i = caps.findIndex((c) => c.id === id);
    if (i > 0) prev = caps[i - 1].capSlug + "." + caps[i - 1].id;
    if (i >= 0 && i < caps.length - 1) next = caps[i + 1].capSlug + "." + caps[i + 1].id;
  } catch { /* los vecinos son optativos */ }
  return {
    text: filtrar(p.text),
    imgs: p.imgs,
    number: numDe(capSlug) || id,
    title: "Capítulo " + (numDe(capSlug) || id),
    direction: "ltr",
    prev,
    next,
  };
}

// ---------- texto ----------

/** HTML del capítulo → párrafos (y las ilustraciones aparte), igual que el resto de novelas. */
function htmlToParagraphs(html, maxParas = 900) {
  let body = String(html || "").replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const imgs = [];
  body = body.replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, (m, u) => {
    if (/^https?:/i.test(u) && imgs.length < 8) imgs.push(u.replace(/&amp;/g, "&"));
    return " ";
  });
  body = body.replace(/<\/\s*(p|div|h[1-6]|li|blockquote|tr)\s*>/gi, "\n\n");
  body = body.replace(/<br\s*\/?>/gi, "\n");
  body = unescapeHtml(body.replace(/<[^>]+>/g, " "));
  body = body.replace(/[\u200b-\u200f\ufeff\u2060]/g, "");
  const text = [];
  for (const line of body.split("\n")) {
    let t = line.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > 4000) t = t.slice(0, 4000);
    text.push(t);
    if (text.length >= maxParas) break;
  }
  return { text, imgs };
}

/** Chrome del sitio y aviso del pie: nunca es contenido. */
function filtrar(text) {
  const out = [];
  for (const t of text) {
    if (/novelaschinas\.org|derechos reservados|pol[ií]tica de privacidad|\bdmca\b|inicia sesi[oó]n|historial de lectura|©\s*20\d\d/i.test(t) && t.length < 300) continue;
    if (/^(prev\s+next|comments? for|deja una respuesta|tu direcci[oó]n de correo|class=|href=|<|data-|compartir|share)/i.test(t.trim().slice(0, 40)) && t.length < 300) continue;
    if (/está bloqueado|membresía lo lees|desbloqueo|suscr[ií]bete para|membres[ií]a (?:requerida|necesaria)/i.test(t) && t.length < 220 && out.length >= 6) continue;
    out.push(t);
  }
  return out;
}

export async function login() {
  netError({ message: "DevilNovels no necesita cuenta para leer: las novelas son públicas" }, "el inicio de sesión");
}
