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

import { fetchText, toItem, netError, PAGO_TEXT_RE } from "./env.js";

const MAX_CAPS = 800; // tope de capítulos por obra (el detalle de Kino enseña 250)
// Rutas del sitio que NUNCA son novelas: menú, cuenta y membresía (el tema es «Mi Login»,
// «Mi Registro», «Mi Recuperar…»), herramientas («Acortador») y widgets del home.
// Es el residuo del RCA 2026-11: /mi-login, /mi-registro y /mi-recuperar NO estaban y el menú
// («Iniciar sesión», «Registrarse») salía como las primeras tarjetas del home.
const RUTAS_FIJAS = /^(listado-de-novelas|novelas-finalizadas|novelas-nuevas|ultimas-actualizaciones|top-vistas|top-lectores|comentarios|comentarios-recientes|comment|leer-ahora|imagenes|inicio|home|index|ranking|buscar|search|acortador|descargas|membership-join|membership-account|membership-checkout|membership-levels|memberships?|membresia|membresias|suscripcion|suscribete|subscribe|mi-cuenta|mi-login|mi-registro|mi-recuperar|mi-perfil|mi-lista|mi-historial|mi-activar|account|cuenta|perfil|usuario|checkout|payments|invoice|carrito|cart|wishlist|favoritos|favoritas|wp-login|login|signin|sign-in|signup|sign-up|signout|logout|register|registro|registrarse|registrar|iniciar-sesion|crear-cuenta|entrar|salir|recuperar|forgot-password|lostpassword|lost-password|reset-password|activate|activation|join|join-us|joinus|dmca|politica-de-privacidad|politica-privacidad|politica-de-cookies|terminos|terminos-y-condiciones|condiciones|aviso-legal|privacidad|contacto|nosotros|about|ayuda|help|faq|novela|novelas|genero|generos|genre|genres|author|tag|category|feed|page|amp|wp-content|wp-admin|wp-json|wp-includes)(\/|$)/i;

// ---------- red ----------

async function getHtml(path, { what = "DevilNovels", timeout } = {}) {
  const r = await fetchText("https://devilnovels.com" + path, {
    heads: { Accept: "text/html", Referer: "https://devilnovels.com/" },
    // 45 s como zonatmo.org: el home y las fichas son páginas de WordPress pesadas (portadas,
    // ranking, listas largas) y el plazo por defecto de 12 s las daba por caídas
    timeoutMs: timeout || 45000,
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

/** ¿El texto del enlace es una acción de cuenta (login/registro/membresía)? Es lo primero que
 *  muestra el menú del sitio y lo que contaminaba las primeras tarjetas del home (RCA 2026-11).
 *  Solo frases cortas (≤ 4 palabras): un título de novela largo que EMPIECE igual no se pierde. */
function esAuthText(t) {
  const s = String(t).trim();
  return s.length < 45 && s.split(/\s+/).length <= 4 &&
    /^(iniciar\s+sesi|inicia\s+sesi|entrar\b|login\b|mi\s+login|sign\s?-?up|registr|crear\s+cuenta|mi\s+cuenta|recuperar|olvidaste|logout|cerrar\s+sesi|join\b|join\s?us|membres|suscr|apoyar|donar|donate|acortador)/i.test(s);
}

/** URL de portada desde una etiqueta <img>: cada atributo por SU NOMBRE y en orden de
 *  preferencia (data-src antes que src). Los temas perezosos ponen el sustituto (dflazy, un
 *  data: de 1 px) en src y la portada de verdad en data-src; coger «la primera coincidencia
 *  del tag» daba a TODAS las tarjetas la misma imagen (el RCA de las portadas repetidas). */
function urlDeImg(tag) {
  for (const a of ["data-src", "data-lazy-src", "data-original", "src"]) {
    const m = new RegExp("(?:^|\\s)" + a + "=\"([^\"]+)\"", "i").exec(tag);
    if (!m) continue;
    let u = m[1].trim().replace(/&amp;/g, "&");
    if (!u || /^(?:data:|javascript:|blob:|#)/i.test(u)) continue;
    if (/dflazy|\/images\/(?:loading|loader|placeholder|dummy)|placeholder|\bdummy\b|logo|avatar|spinner|loading\.(?:gif|svg|png)/i.test(u)) continue;
    if (/^\/\//.test(u)) u = "https:" + u;
    else if (/^\//.test(u)) u = "https://devilnovels.com" + u;
    if (/^https?:\/\//i.test(u)) return u;
  }
  return "";
}

/** Tarjetas de novela: el enlace COMPLETO («/<slug>» con su contenido dentro), título y portada
 *  desde el propio enlace. Nada de ventanas grandes hacia atrás: en una malla de tarjetas
 *  alcanzaban la tarjeta ANTERIOR y mezclaban títulos y portadas entre novelas (RCA 2026-11). */
function novelCards(html, limit) {
  const out = [], seen = {};
  const re = /<a\b([^>]*?)href="(?:https?:\/\/(?:www\.)?devilnovels\.com)?\/([a-z0-9][a-z0-9-]{0,99})\/?"([^>]*)>([\s\S]{0,4000}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (limit && out.length >= limit) break;
    const slug = m[2];
    if (seen[slug] || !esNovelaSlug(slug)) continue;
    const attrs = m[1] + " " + m[3];
    const inner = m[4];
    // título: attr del propio enlace → encabezado dentro del enlace → texto del enlace →
    // encabezado JUSTO debajo (temas que separan portada y título) → alt de la portada → slug
    let title = "";
    const tA = /(?:^|\s)title="([^"]{3,200})"/i.exec(attrs);
    if (tA) title = clean(tA[1]);
    if (title.length < 3) {
      const hi = inner.match(/<h[1-6][^>]*>\s*([^<]{3,200})</i);
      if (hi) title = clean(hi[1]);
    }
    if (title.length < 3) {
      const tx = clean(inner);
      if (tx.length >= 3) title = tx.slice(0, 200);
    }
    if (title.length < 3) {
      const win = html.slice(m.index + m[0].length, m.index + m[0].length + 700);
      const h2 = win.match(/<h[1-6][^>]*>\s*([^<]{3,200})</i);
      if (h2) title = clean(h2[1]);
    }
    if (title.length < 3) {
      const al = /(?:^|\s)alt="([^"]{3,200})"/i.exec(attrs);
      if (al) title = clean(al[1]);
    }
    if (title.length < 3) title = slug.replace(/-/g, " ");
    // las páginas de finalizadas firman «Título - Finalizada»: el título propio es limpio
    title = title.replace(/\s*[-–]\s*finalizada\s*$/i, "").trim() || title;
    if (esAuthText(title)) continue;
    // portada: la imagen DENTRO del enlace; si no hay, la más CERCANA por encima — de la más
    // cercana a la más lejana, la primera que dé una URL de verdad (el sustituto del lazy-loader
    // se descarta y sigue mirando; antes una sustituto dejaba la tarjeta sin portada)
    let poster = "";
    const imgs = inner.match(/<img\b[^>]*>/gi) || [];
    const encima = html.slice(Math.max(0, m.index - 1000), m.index);
    const encimaArr = encima.match(/<img\b[^>]*>/gi) || [];
    for (const tag of imgs.concat(encimaArr.reverse())) {
      poster = urlDeImg(tag);
      if (poster) break;
    }
    seen[slug] = true;
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
    const cards = novelCards(p.value, s.n);
    // seguro anti-portadas repetidas (RCA 2026-11): si la mitad o más de las tarjetas con
    // imagen comparten LA MISMA URL, es un sustituto que se coló, no diseño del sitio —
    // mejor quitarlas todas que enseñar la misma portada en media sección
    const conImg = cards.filter((c) => c.poster);
    if (conImg.length >= 4) {
      const cuenta = {};
      let max = 0;
      for (const c of conImg) {
        cuenta[c.poster] = (cuenta[c.poster] || 0) + 1;
        if (cuenta[c.poster] > max) max = cuenta[c.poster];
      }
      if (max * 2 > conImg.length) for (const c of cards) c.poster = undefined;
    }
    const items = asItems(cards);
    if (items.length) out.push({ id: "dv-" + s.id, title: s.t, titleEn: s.te, items });
  }
  return out;
}

export async function detail(src, slug) {
  const html = await getHtml("/" + slug + "/", { what: "la novela en DevilNovels" });
  const pick = (re) => { const m = html.match(re); return m ? clean(m[1]) : ""; };
  let poster = pick(/property="og:image"[^>]*content="([^"]+)"/) || pick(/content="([^"]+)"[^>]*property="og:image"/);
  if (poster) poster = poster.replace(/&amp;/g, "&");
  if (poster && /^\/\//.test(poster)) poster = "https:" + poster;
  else if (poster && /^\//.test(poster)) poster = "https://devilnovels.com" + poster;
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
