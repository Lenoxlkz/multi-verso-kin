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

import { fetchText, fetchJson, toItem, netError, PAGO_TEXT_RE, UA } from "./env.js";

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

/** Último grupo de dígitos del slug: para capítulos que el sitio renombra sin «capitulo-»
 *  (cap-77, la-novela-77) el número real sigue quedando al final del slug. */
function lastNumberDe(s) {
  const m = /(\d+)(?!.*\d)/.exec(String(s || ""));
  return m ? m[1] : "";
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

/** Tarjetas de novela. BUSCADOR = el de v2.12.1, demostrado contra el HTML real del sitio:
 *  cualquier href raíz con sus atributos y el primer texto del elemento, SIN exigir el cierre
 *  «</a>» (la v2.13.0 lo exigía junto al <a de apertura y con el HTML de verdad se quedaba
 *  sin tarjetas → home vacío → «la fuente no respondió»). ENCIMA va la extracción rica de
 *  v2.13.0: título desde el propio elemento (nada de ventanas grandes hacia atrás, que eran
 *  lo que mezclaba títulos y portadas entre tarjetas) y portada con data-src primero,
 *  sustitutos fuera y URLs absolutas. La unión garantiza todo lo que veía la 2.12.1 y no
 *  vuelve a producir los tres defectos del RCA. */
/** Los contadores del sitio (widgets de ranking: «12.3K vistas», «1,2M lecturas») nunca son
 *  parte del título delante o detrás: se quitan y un texto que SOLO sea contador no vale. */
function quitaVistas(t) {
  let s = String(t || "");
  s = s.replace(/^\s*\d+(?:[.,]\d+)?\s*[kKmM]?\s*(?:vistas|views|lecturas|reads|visitas)\s*[-–—|:·]?\s*/i, "");
  s = s.replace(/\s*[-–—|:·]?\s*\d+(?:[.,]\d+)?\s*[kKmM]?\s*(?:vistas|views|lecturas|reads|visitas)\.?\s*$/i, "");
  return s.trim();
}

function esContador(t) {
  const s = String(t || "").trim();
  if (!s) return true;
  return /^[\d.,\s]*[kKmM]?\s*(?:vistas|views|lecturas|reads|visitas)?$/i.test(s) && /[\dkKmM]/i.test(s);
}

function novelCards(html, limit) {
  const out = [], seen = {};
  const re = /href="(?:https?:\/\/(?:www\.)?devilnovels\.com)?\/([a-z0-9][a-z0-9-]{0,99})\/?"([^>]*)>([^<]{0,200})</gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (limit && out.length >= limit) break;
    const slug = m[1];
    if (seen[slug] || !esNovelaSlug(slug)) continue;
    const attrs = m[2]; // atributos PROPIOS del elemento (tras el href): sin contaminación
    const texto = clean(m[3]);
    // contenido COMPLETO del elemento («</a>» o «</a >», hasta 4600) SOLO si es de fiar:
    // una tarjeta real nunca contiene OTRO enlace, así que si el tramo hasta el cierre lleva
    // un <a es HTML roto (ancla sin cerrar o anidadas) y el tramo alcanza a la tarjeta
    // siguiente — se descarta y se sigue como la 2.12.1, con el primer texto y la portada de arriba
    let inner = "";
    const cierre = html.slice(m.index, m.index + 4600).search(/<\/a[\s>]/i);
    const gt = m.index + m[0].length - m[3].length - 2; // el «>» que abre el contenido
    if (cierre >= 0 && gt > m.index) {
      const cand = html.slice(gt + 1, m.index + cierre);
      if (!/<a[\s/>]/i.test(cand)) inner = cand;
    }
    // título: attr del propio elemento → primer texto (v2.12.1) → encabezado/texto DENTRO del
    // elemento (de fiar) → encabezado JUSTO debajo (solo hacia DELANTE; atrás mezclaba
    // tarjetas) → alt del propio elemento o de su portada → slug
    let title = "";
    const tA = /(?:^|\s)title="([^"]{3,200})"/i.exec(attrs);
    if (tA) title = clean(tA[1]);
    if (title.length < 3 && texto.length >= 3 && !esContador(texto)) title = texto.slice(0, 200);
    if (title.length < 3 && inner) {
      const hi = inner.match(/<h[1-6][^>]*>\s*([^<]{3,200})</i);
      if (hi) title = clean(hi[1]);
    }
    // el tema suele poner el nombre en un span/div con clase de título: antes que el texto plano
    // (el texto plano del ranking arrastra el contador de vistas — RCA 2026-11, problema #1)
    if (title.length < 3 && inner) {
      const sc = inner.match(/<(?:h[1-6]|span|div|p)[^>]*class="[^"]*(?:post-title|entry-title|titulo|title)[^"]*"[^>]*>\s*([^<]{3,200})</i);
      if (sc) title = clean(sc[1]);
    }
    if (title.length < 3 && inner) {
      const tx = clean(inner);
      if (tx.length >= 3 && !esContador(tx)) title = tx.slice(0, 200);
    }
    if (title.length < 3) {
      const h2 = html.slice(m.index, m.index + 700).match(/<h[1-6][^>]*>\s*([^<]{3,200})</i);
      if (h2) title = clean(h2[1]);
    }
    if (title.length < 3) {
      const al = /(?:^|\s)alt="([^"]{3,200})"/i.exec(attrs);
      if (al) title = clean(al[1]);
    }
    if (title.length < 3 && inner) {
      const im = inner.match(/<img\b[^>]*>/i);
      const al2 = im ? /(?:^|\s)alt="([^"]{3,200})"/i.exec(im[0]) : null;
      if (al2) title = clean(al2[1]);
    }
    if (title.length < 3) title = slug.replace(/-/g, " ");
    title = quitaVistas(title);
    if (title.length < 3) title = slug.replace(/-/g, " ");
    // las páginas de finalizadas firman «Título - Finalizada»: el título propio es limpio
    title = title.replace(/\s*[-–]\s*finalizada\s*$/i, "").trim() || title;
    if (esAuthText(title)) continue;
    // portada: imagen DENTRO del elemento; si no hay, la más CERCANA por encima — de cerca a
    // lejos, la primera que dé una URL de verdad (el sustituto del lazy-loader se descarta
    // y sigue mirando; antes un sustituto dejaba la tarjeta sin portada)
    let poster = "";
    const imgs = inner ? (inner.match(/<img\b[^>]*>/gi) || []) : [];
    const encimaArr = html.slice(Math.max(0, m.index - 1000), m.index).match(/<img\b[^>]*>/gi) || [];
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

// ---------- capítulos: enumeración COMPLETA por lotes ----------
// La ficha del sitio solo lista un par de capítulos (los extremos) y una novela llega a tener
// 3000+. RCA con captura real de DevTools (2026-11): el JS del sitio trae la lista por AJAX.
// Planes, en orden:
//   A — el AJAX del sitio: POST admin-ajax action=dv_load_chapters&cat_id=<id>&page=<n> (100
//       por página, total y pages reales en la respuesta; el cat_id sale de la propia ficha)
//   B — la REST de WordPress (wp-json/wp/v2/pages?parent=<id>) por si el AJAX cambia
//   C — la paginación de la propia ficha (enlaces ?cpage=N / page/N del tema)
//   D — las filas de la ficha (extremos; siempre hay algo)
// La carga es PROGRESIVA: capsPage entrega un lote y el siguiente solo se pide cuando la
// pantalla lo pide — nada baja 3000 capítulos de golpe (análisis claro, menos recursos).

const CAPS_TTL = 7200000;
const CAPS_CACHE = new Map();

function capsCachePut(slug, rows) {
  CAPS_CACHE.set(slug, { rows, ts: Date.now() });
  if (CAPS_CACHE.size > 12) CAPS_CACHE.delete(CAPS_CACHE.keys().next().value);
}

function capsCacheGet(slug) {
  const c = CAPS_CACHE.get(slug);
  return c && Date.now() - c.ts < CAPS_TTL ? c.rows : null;
}

// ficha compartida: el detalle y la enumeración piden EL MISMO HTML (una red, no dos)
const FICHA_TTL = 600000;
const FICHA_CACHE = new Map();

async function fichaDe(slug) {
  const c = FICHA_CACHE.get(slug);
  if (c && Date.now() - c.ts < FICHA_TTL) return c.html;
  const html = await getHtml("/" + slug + "/", { what: "la novela en DevilNovels" });
  if (FICHA_CACHE.size > 12) FICHA_CACHE.delete(FICHA_CACHE.keys().next().value);
  FICHA_CACHE.set(slug, { html, ts: Date.now() });
  return html;
}

// enumeración por obra: filas por id, REST viva o muerta, páginas ya pedidas y cierre
const ENUM_TTL = 3600000;
const ENUMS = new Map();

function enumDe(slug) {
  const e = ENUMS.get(slug);
  if (e && Date.now() - e.ts < ENUM_TTL) return e;
  const n = { ids: new Map(), ajax: null, ajaxPendiente: null, ajaxIntentada: false, ajTraidas: 0, ajFin: false, rest: null, pageId: null, locked: null, paginas: new Set(), ascTraidas: 0, completa: false, fichaHecha: false, fichaPaginas: false, restIntentada: false, restFin: false, descFin: false, ts: Date.now() };
  if (ENUMS.size > 8) ENUMS.delete(ENUMS.keys().next().value);
  ENUMS.set(slug, n);
  return n;
}

function filaDe(capSlug, id, pago) {
  const cs = String(capSlug);
  // el número REAL del capítulo (RCA 2026-11, problema #3): el patrón del sitio, y si el tema
  // renombró los slugs, el último número del slug — el id de post solo como último recurso
  return { capSlug: cs, id: String(id), number: numDe(cs) || lastNumberDe(cs) || String(id), pago: Boolean(pago) };
}

/** Añade una fila por id; la primera versión manda (la de la ficha trae la marca de pago),
 *  y una marca de pago que aparezca después no se pierde. */
function enumPon(e, fila) {
  const prev = e.ids.get(fila.id);
  if (!prev) { e.ids.set(fila.id, fila); return; }
  if (fila.pago && !prev.pago) prev.pago = true;
}

function enumVuelca(e, html, slug) {
  for (const r of capRows(html, slug)) enumPon(e, r);
}

function enumLista(e) {
  return [...e.ids.values()].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
}

// ---------- plan A: el AJAX del propio sitio (dv_load_chapters) ----------
// RCA con captura real de DevTools (2026-11): la lista de capítulos NO está en el HTML de la
// ficha («Cargando…»); el JS del sitio la trae por POST a admin-ajax:
//   action=dv_load_chapters&cat_id=<id de la novela>&page=<n>&search=
// y responde { success: true, data: { chapters: [...], total: 3249, pages: 33 } } con
// PER_PAGE = 100. El servidor devuelve la lista ASCENDENTE (el cliente la invierte para «desc»),
// así que la ÚLTIMA página es la de los capítulos más nuevos — la usa el lector.

const AJAX_URL = "https://devilnovels.com/wp-admin/admin-ajax.php";
const AJAX_PER = 100;
const AJAX_MAX_PAGINAS = 45; // 45 × 100 = 4500 capítulos de una obra, tope prudente
const AJAX_TIMEOUT = 20000;

/** El id de la novela para el AJAX sale de la ficha (data-attributes y configuración inline del
 *  tema; el marcador exacto puede cambiar con el tema, así que se prueban varios). */
function catIdDe(html) {
  for (const re of [
    /data-(?:cat|novel|post)[_-]?id=["'](\d{2,10})["']/i,
    /cat[_-]?id["']?\s*[:=]\s*["']?(\d{2,10})/i,
    /"cat_id"\s*:\s*(\d{2,10})/,
  ]) {
    const m = re.exec(html);
    if (m) return m[1];
  }
  return null;
}

/** El id de la PÁGINA de WordPress de la novela (el tema lo expone junto al CAT_ID — el RCA
 *  2026-11 vio las variables CAT_ID, PAGE_ID y PER_PAGE en el JS del sitio). Con él, el plan B
 *  (REST de hijos) va directa con parent=<PAGE_ID> sin la búsqueda por slug. */
function pageIdDe(html) {
  for (const re of [
    /PAGE_ID["']?\s*[:=]\s*["']?(\d{2,10})/i,
    /data-(?:page|post)[_-]?id=["'](\d{2,10})["']/i,
    /page[_-]?id["']?\s*[:=]\s*["']?(\d{2,10})/i,
  ]) {
    const m = re.exec(html);
    if (m) return m[1];
  }
  return null;
}

/** Los capítulos con candado: el tema guarda una lista de ids bloqueados en la página. */
function lockedIdsDe(html) {
  const m = /LOCKED[_A-Z]*\s*=\s*\[([0-9,\s]{1,4000})\]/.exec(html);
  if (!m) return null;
  const set = new Set();
  for (const t of m[1].split(",")) {
    const n = Number(t.trim());
    if (n > 0) set.add(String(n));
  }
  return set.size ? set : null;
}

/** Fila tolerante del AJAX: el campo exacto del tema puede variar, pero la URL del capítulo
 *  (siempre /<novela>/<cap-slug>/<id>) da el cap-slug y la id — igual que en la ficha. */
function filaAjax(item, locked) {
  if (!item || typeof item !== "object") return null;
  const url = String(item.url || item.permalink || item.link || item.href || "");
  let id = item.id != null ? String(item.id) : (item.ID != null ? String(item.ID) : "");
  if (!/^\d+$/.test(id)) {
    const mu = /\/(\d{2,10})\/?$/.exec(url);
    id = mu ? mu[1] : "";
  }
  if (!/^\d+$/.test(id)) return null;
  let cs = String(item.slug || "");
  if (!/^[a-z0-9-]+$/i.test(cs)) {
    const mu = /\/([a-z0-9-]+)\/\d{2,10}\/?$/.exec(url);
    cs = mu ? mu[1] : "";
  }
  if (!cs) return null;
  const pago = Boolean(item.locked || item.is_locked || item.pago) || (locked ? locked.has(id) : false);
  return filaDe(cs, id, pago);
}

async function ajaxCaps(catId, page, search = "") {
  // Cabeceras minimalistas y creíbles (consejo del RCA 2026-11): el UA forzado y lo que un XHR
  // real lleva — SIN X-Requested-With ni nada que delate WebView o automatización.
  const r = await fetchText(AJAX_URL, {
    heads: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://devilnovels.com/",
      "User-Agent": UA,
    },
    method: "POST",
    body: "action=dv_load_chapters&cat_id=" + encodeURIComponent(catId) + "&page=" + page +
      "&search=" + encodeURIComponent(String(search || "").trim()),
    timeoutMs: AJAX_TIMEOUT,
  });
  if (!r.ok) return null;
  let b = null;
  try { b = JSON.parse(r.text); } catch { return null; }
  if (!b || b.success !== true || !b.data || !Array.isArray(b.data.chapters)) return null;
  return {
    caps: b.data.chapters,
    total: Number(b.data.total) > 0 ? Number(b.data.total) : undefined,
    pages: Number(b.data.pages) > 0 ? Number(b.data.pages) : undefined,
  };
}

function ajaxVuelca(e, resp, locked) {
  for (const item of resp.caps || []) {
    const f = filaAjax(item, locked);
    if (f) enumPon(e, f);
  }
}

/** Trae páginas AJAX ascendentes hasta cubrir el lote pedido o hasta la última página. */
async function enumAjaxHasta(e, objetivo) {
  const tope = Math.min(e.ajax.pages || AJAX_MAX_PAGINAS, AJAX_MAX_PAGINAS);
  for (let k = e.ajTraidas + 1; k <= tope && !e.ajFin; k++) {
    if (e.ajTraidas * AJAX_PER >= objetivo) break;
    const r = await ajaxCaps(e.ajax.catId, k);
    if (!r) { e.ajFin = true; break; }
    e.ajTraidas = k;
    e.paginas.add("aj" + k);
    ajaxVuelca(e, r, e.locked);
    if (r.total && !e.ajax.total) e.ajax.total = r.total;
    if ((r.pages && k >= r.pages) || (r.caps || []).length < AJAX_PER) { e.ajFin = true; e.completa = true; }
  }
  if (e.ajFin) e.completa = true;
}

// ---------- plan B: la REST de WordPress ----------

const REST_BASE = "https://devilnovels.com/wp-json/wp/v2/pages";
const REST_PER = 100;
const REST_MAX = 45; // 45 × 100 = 4500 capítulos de una obra, tope prudente
const REST_TIMEOUT = 15000;

function restHeads() {
  return { Accept: "application/json", "User-Agent": UA };
}

function totalRest(headers) {
  const t = Number((headers || {})["x-wp-total"]);
  return Number.isFinite(t) && t > 0 ? t : undefined;
}

/** La novela es una PÁGINA de WP (vive en la raíz del dominio): su id sale de la REST por slug. */
async function restPadre(slug) {
  const r = await fetchJson(REST_BASE + "?slug=" + encodeURIComponent(slug) + "&_fields=id,slug", { heads: restHeads(), timeoutMs: REST_TIMEOUT });
  if (!r.ok || !Array.isArray(r.body)) return null;
  const hit = r.body.find((p) => p && String(p.slug) === slug && Number(p.id) > 0);
  return hit ? { id: Number(hit.id), total: totalRest(r.headers) } : null;
}

async function restPagina(padreId, pagina, orden) {
  return fetchJson(REST_BASE + "?parent=" + padreId + "&per_page=" + REST_PER + "&page=" + pagina +
    "&orderby=date&order=" + orden + "&_fields=id,slug", { heads: restHeads(), timeoutMs: REST_TIMEOUT });
}

function restVuelca(e, body, slug) {
  for (const p of body || []) {
    if (!p || !(Number(p.id) > 0) || !p.slug || !/capitulo/i.test(String(p.slug))) continue;
    enumPon(e, filaDe(p.slug, p.id));
  }
}

/** Trae páginas REST ascendentes hasta cubrir el lote pedido (o hasta que la REST se acabe).
 *  El contador de páginas ascendentes es PROPIO (el set «paginas» también guarda las de
 *  descenso del lector, y mezclarlas haría saltar páginas). */
async function enumRestHasta(e, slug, objetivo) {
  for (let k = e.ascTraidas + 1; k <= REST_MAX && !e.restFin; k++) {
    if (e.ascTraidas * REST_PER >= objetivo) break;
    const r = await restPagina(e.rest.id, k, "asc");
    if (!r.ok || !Array.isArray(r.body)) { e.restFin = true; break; }
    e.ascTraidas = k;
    e.paginas.add("asc" + k);
    restVuelca(e, r.body, slug);
    if (r.body.length < REST_PER) { e.restFin = true; e.completa = true; }
    if (!e.rest.total) e.rest.total = totalRest(r.headers);
  }
  if (e.restFin) e.completa = true;
}

// ---------- plan B: la paginación de la propia ficha ----------

async function enumFichaPaginas(e, slug) {
  if (e.rest && e.rest.id) return; // con la REST viva esto no hace falta
  const html = await fichaDe(slug);
  const urls = new Set();
  const re = new RegExp("href=\"(?:https?:\\/\\/[^\"\\/]+)?\\/(" + slug + "\\/(?:[^\"?]*[?&]cpage=(\\d+)|[^\"?]*page\\/(\\d+)))", "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[2] || m[3]);
    if (n >= 2 && n <= 60 && m[1]) urls.add("/" + m[1]);
  }
  if (!urls.size) { e.completa = true; return; }
  const lista = [...urls].slice(0, 40);
  for (let i = 0; i < lista.length; i += 4) {
    const rs = await Promise.allSettled(lista.slice(i, i + 4).map((u) => getHtml(u, { what: "la lista de capítulos en DevilNovels" })));
    for (const r of rs) if (r.status === "fulfilled" && r.value) enumVuelca(e, r.value, slug);
  }
  e.completa = true;
}

/** Estado de la enumeración de una obra: ficha volcada + primer intento de AJAX (plan A) y
 *  de REST (plan B), cada uno una sola vez. */
async function enumCaps(slug) {
  const e = enumDe(slug);
  if (e.completa) return e;
  if (!e.fichaHecha) {
    e.fichaHecha = true;
    try {
      const html = await fichaDe(slug);
      enumVuelca(e, html, slug);
      e.locked = lockedIdsDe(html);
      e.ajaxPendiente = catIdDe(html);
      e.pageId = pageIdDe(html);
    } catch { /* sin ficha: solo el id que ya se conozca */ }
  }
  // plan A: el mismo XHR que hace la página (dv_load_chapters); el total real llega en la
  // primera respuesta. Si no hay cat_id o el endpoint no responde, cae al plan B.
  if (!e.ajaxIntentada) {
    e.ajaxIntentada = true;
    if (e.ajaxPendiente) {
      try {
        const r1 = await ajaxCaps(e.ajaxPendiente, 1);
        if (r1) {
          e.ajax = { catId: e.ajaxPendiente, total: r1.total, pages: r1.pages };
          e.ajTraidas = 1;
          e.paginas.add("aj1");
          ajaxVuelca(e, r1, e.locked);
          if ((r1.pages && r1.pages <= 1) || (r1.caps || []).length < AJAX_PER) { e.ajFin = true; e.completa = true; }
        }
      } catch { /* plan B */ }
    }
  }
  if (e.ajax && e.ajFin) e.completa = true;
  // plan B: la REST de WordPress (una sola vez por obra). El PAGE_ID de la ficha, si existe,
  // evita la búsqueda por slug — pero se VALIDA con su primera página: un marcador equivocado
  // no trae capítulos (un falso «completa» devolvería solo los extremos, el bug original).
  if (!e.ajax && !e.restIntentada) {
    e.restIntentada = true;
    e.rest = { id: 0, total: undefined };
    if (e.pageId) {
      try {
        const r1 = await restPagina(Number(e.pageId), 1, "asc");
        if (r1.ok && Array.isArray(r1.body)) {
          const antes = e.ids.size;
          restVuelca(e, r1.body, slug);
          if (r1.body.length && e.ids.size > antes) {
            e.rest.id = Number(e.pageId);
            e.ascTraidas = 1;
            e.paginas.add("asc1");
            if (!e.rest.total) e.rest.total = totalRest(r1.headers);
            if (r1.body.length < REST_PER) { e.restFin = true; e.completa = true; }
          }
        }
      } catch { /* PAGE_ID malo o REST cerrada: búsqueda por slug */ }
    }
    if (!e.rest.id) {
      let padre = null;
      try { padre = await restPadre(slug); } catch { padre = null; }
      e.rest = padre ? { id: padre.id, total: padre.total } : { id: 0, total: undefined };
      if (e.rest.id) {
        try {
          const r1 = await restPagina(e.rest.id, 1, "asc");
          if (r1.ok && Array.isArray(r1.body)) {
            e.ascTraidas = 1;
            e.paginas.add("asc1");
            restVuelca(e, r1.body, slug);
            if (r1.body.length < REST_PER) { e.restFin = true; e.completa = true; }
            if (!e.rest.total) e.rest.total = totalRest(r1.headers);
          } else e.rest.id = 0;
        } catch { e.rest.id = 0; }
      }
    }
  }
  if (!e.ajax && e.rest && e.rest.id && e.restFin) e.completa = true;
  return e;
}

function filaACap(r) {
  return { slug: r.capSlug + "." + r.id, number: r.number, title: "Capítulo " + r.number, pago: r.pago };
}

/** Lote de capítulos para la pantalla ({items, next, total}) — la carga progresiva del detalle. */
export async function capsPage(src, slug, opts = {}) {
  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const per = Math.min(100, Math.max(10, Math.floor(Number(opts.postsPerPage) || 50)));
  const e = await enumCaps(slug);
  if (e.ajax) await enumAjaxHasta(e, page * per);
  else if (e.rest && e.rest.id) await enumRestHasta(e, slug, page * per);
  else if (!e.fichaPaginas) { e.fichaPaginas = true; await enumFichaPaginas(e, slug); }
  const rows = enumLista(e);
  const desde = (page - 1) * per;
  const total = e.ajax && e.ajax.total ? e.ajax.total : (e.rest && e.rest.total ? e.rest.total : (e.completa ? rows.length : undefined));
  return {
    items: rows.slice(desde, desde + per).map(filaACap),
    next: desde + per < rows.length ? page + 1 : null,
    total,
  };
}

/** Lista COMPLETA (lector y respaldos): trae todo lo alcanzable de una obra, con caché de 2 h. */
export async function capsList(src, slug) {
  const enCache = capsCacheGet(slug);
  if (enCache) return enCache.map(filaACap);
  const e = await enumCaps(slug);
  if (e.ajax) await enumAjaxHasta(e, Infinity);
  else if (e.rest && e.rest.id) await enumRestHasta(e, slug, Infinity);
  else if (!e.fichaPaginas) { e.fichaPaginas = true; await enumFichaPaginas(e, slug); }
  const rows = enumLista(e);
  if (rows.length) capsCachePut(slug, rows);
  return rows.map(filaACap);
}

/** Búsqueda de capítulos por el AJAX del sitio (search=, límite #3 del RCA 2026-11): busca en
 *  TODA la obra — incluso en los capítulos que la carga progresiva todavía no trajo. NO toca la
 *  enumeración (mezclar resultados filtrados en e.ids corrompería la lista completa); trae su
 *  propia paginación con el total filtrado. */
export async function capsSearch(src, slug, query, page) {
  const q = String(query || "").trim();
  const p = Math.max(1, Math.floor(Number(page) || 1));
  if (!q) return capsPage(src, slug, { page: p });
  const html = await fichaDe(slug);
  const catId = catIdDe(html);
  if (!catId) return { items: [], next: null, total: 0 }; // sin cat_id no hay búsqueda
  const locked = lockedIdsDe(html);
  const r = await ajaxCaps(catId, p, q);
  if (!r) return { items: [], next: null, total: undefined };
  const rows = [];
  for (const item of r.caps || []) {
    const f = filaAjax(item, locked);
    if (f) rows.push(f);
  }
  rows.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  return { items: rows.map(filaACap), next: p < (r.pages || 1) ? p + 1 : null, total: r.total };
}

/** Vecinos del lector (prev/next) sin bajar la obra entera: la lista en caché primero; si no,
 *  el AJAX por la COLA (el servidor entrega ASCENDENTE: la última página trae los capítulos
 *  más nuevos, donde casi siempre está el lector) caminando hacia atrás hasta dar con el
 *  capítulo; sin AJAX, la REST en descenso; y como último respaldo, los extremos de la ficha. */
export async function vecinosDe(slug, id) {
  const enCache = capsCacheGet(slug);
  if (enCache) {
    const i = enCache.findIndex((c) => c.id === String(id));
    if (i >= 0) return vecinosEn(enCache, i);
  }
  const busco = String(id);
  const e = await enumCaps(slug);
  if (e.ajax) {
    const tope = Math.min(e.ajax.pages || 1, AJAX_MAX_PAGINAS);
    for (let m = 0; m < 8 && tope - m >= 1; m++) {
      const k = tope - m;
      if (!e.paginas.has("aj" + k)) {
        const r = await ajaxCaps(e.ajax.catId, k);
        if (!r) break;
        e.paginas.add("aj" + k);
        ajaxVuelca(e, r, e.locked);
        if ((r.pages && k >= r.pages) || (r.caps || []).length < AJAX_PER) { e.ajFin = true; e.completa = true; }
      }
      const rows = enumLista(e);
      const i = rows.findIndex((c) => c.id === busco);
      if (i > 0) return vecinosEn(rows, i); // el anterior está a la vista: definitivo
      if (i === 0 && (k <= 1 || e.completa || m >= 7)) return vecinosEn(rows, i);
      // está al INICIO del tramo cargado y pueden existir capítulos más viejos: una página atrás
    }
  } else if (e.rest && e.rest.id) {
    for (let k = 1; k <= 8 && !e.descFin; k++) {
      if (!e.paginas.has("desc" + k)) {
        const r = await restPagina(e.rest.id, k, "desc");
        if (!r.ok || !Array.isArray(r.body)) { e.descFin = true; break; }
        e.paginas.add("desc" + k);
        restVuelca(e, r.body, slug);
        if (r.body.length < REST_PER) { e.descFin = true; e.completa = true; }
      }
      const rows = enumLista(e);
      const i = rows.findIndex((c) => c.id === busco);
      if (i > 0) return vecinosEn(rows, i); // el anterior está a la vista: definitivo
      if (i === 0 && (e.descFin || k >= 8)) return vecinosEn(rows, i);
      // está en la primera posición cargada y pueden existir capítulos más viejos: otra página
    }
  } else if (!e.fichaPaginas) {
    e.fichaPaginas = true;
    await enumFichaPaginas(e, slug);
  }
  const rows = enumLista(e);
  const i = rows.findIndex((c) => c.id === busco);
  return i >= 0 ? vecinosEn(rows, i) : { prev: null, next: null };
}

function vecinosEn(rows, i) {
  return {
    prev: i > 0 ? rows[i - 1].capSlug + "." + rows[i - 1].id : null,
    next: i < rows.length - 1 ? rows[i + 1].capSlug + "." + rows[i + 1].id : null,
  };
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
      const cs2 = m2[1];
      // sin ruido (RCA 2026-11, problema #3): rutas fijas y paginación («page/2», «pagina-3»)
      // NO son capítulos; un capítulo renombrado SIEMPRE lleva un número en su slug
      if (RUTAS_FIJAS.test(cs2) || /^(?:page|pagina|pag|amp|feed|print|comment|comentarios)(?:[-_].*)?$/i.test(cs2) || !/\d/.test(cs2)) continue;
      if (map.has(m2[2])) continue;
      map.set(m2[2], { capSlug: cs2, id: m2[2], number: numDe(cs2) || lastNumberDe(cs2) || m2[2], pago: false });
    }
  }
  // la id de post crece con el tiempo: ordenar por id es el orden cronológico real
  return [...map.values()].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)).slice(0, MAX_CAPS);
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

function dvCleanCards(html, limit) {
  const cards = novelCards(html, limit);
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
  return cards;
}

export async function home(src, opts = {}) {
  // las secciones nativas del sitio: su ranking (home), su listado y sus finalizadas
  const n0 = opts && opts.full ? 60 : 18;
  const settled = await Promise.allSettled([
    getHtml("/"),
    getHtml("/listado-de-novelas"),
    getHtml("/novelas-finalizadas"),
  ]);
  const secs = [
    { id: "ranking", ref: "dv:ranking", t: "Ranking de novelas", te: "Novel ranking", i: 0, n: n0 },
    { id: "todas", ref: "dv:todas", t: "Listado de novelas", te: "All novels", i: 1, n: n0 },
    { id: "finalizadas", ref: "dv:finalizadas", t: "Novelas finalizadas", te: "Finished novels", i: 2, n: n0 },
  ];
  const out = [];
  for (const s of secs) {
    const p = settled[s.i];
    if (p.status !== "fulfilled" || !p.value) continue;
    const items = asItems(dvCleanCards(p.value, s.n));
    if (items.length) out.push({ id: "dv-" + s.id, ref: s.ref, title: s.t, titleEn: s.te, items });
  }
  return out;
}

const DV_BROWSE_CACHE = new Map();
export async function browse(src, kind, cursor) {
  const page = Math.max(1, Number(cursor) || 1);
  const per = 24;
  const k = kind === "pop" || kind === "ranking" ? "ranking"
    : kind === "finalizadas" || kind === "finished" ? "finalizadas"
    : "todas";
  const basePath = k === "ranking" ? "/" : k === "finalizadas" ? "/novelas-finalizadas" : "/listado-de-novelas";
  let all = DV_BROWSE_CACHE.get(k);
  if (!all || Date.now() - all.ts > 300000) {
    const html = await getHtml(basePath, { what: "el catálogo de DevilNovels" });
    all = { items: asItems(dvCleanCards(html, 480)), ts: Date.now() };
    if (all.items.length) DV_BROWSE_CACHE.set(k, all);
  }
  const offset = (page - 1) * per;
  if (offset < all.items.length) {
    const slice = all.items.slice(offset, offset + per);
    const hasMoreInCache = offset + per < all.items.length;
    return { items: slice, next: hasMoreInCache ? String(page + 1) : null };
  }
  // Si el listado paginara por /page/N/ en la web, intenta la página siguiente
  if (page > 1 && basePath !== "/") {
    try {
      const htmlP = await getHtml(basePath + "/page/" + page + "/", { what: "el catálogo de DevilNovels" });
      const itemsP = asItems(dvCleanCards(htmlP, per));
      return { items: itemsP, next: itemsP.length >= 16 && page < 20 ? String(page + 1) : null };
    } catch { /* sin página extra */ }
  }
  return { items: [], next: null };
}

export async function detail(src, slug) {
  // la ficha pasa por la caché compartida con la enumeración de capítulos (una red, no dos)
  const html = await fichaDe(slug);
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
  return {
    slug,
    title: pick(/property="og:title"[^>]*content="([^"]+)"/) ||
      pick(/<h1[^>]*class="[^"]*(?:post-title|entry-title)[^"]*"[^>]*>([^<]{1,220})</) ||
      pick(/<h1[^>]*>([^<]{1,220})<\/h1>/) ||
      slug.replace(/-/g, " "),
    overview: overview || undefined,
    poster: poster || undefined,
    genres,
    // el total real llega de la REST en el primer lote (X-WP-Total); no se baja la obra aquí
  };
}

/** Lista COMPLETA y vecinos viven en el motor de enumeración (más arriba): capsList entrega
 *  todos los capítulos alcanzables y vecinosDe los del lector sin bajar la obra entera. */

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
  let marcaUsada = "";
  const marcas = [
    'class="reading-content"', 'id="chapter-content"', 'class="chapter-content"',
    'class="entry-content"', 'class="post-content"', 'class="text-content"',
    'class="content-read"', 'class="chapterbody"', 'itemprop="articleBody"', "<article",
  ];
  for (const marca of marcas) {
    const i = html.indexOf(marca);
    if (i >= 0) { seg = html.slice(i, i + 500000); marcaUsada = marca; break; }
  }
  if (!seg) seg = html.slice(0, 500000);
  // si el corte cayó en <article, la cabecera del post (título, meta, banner) entró en el tramo:
  // re-corta al contenedor del contenido que venga dentro
  if (marcaUsada === "<article") {
    const inner = seg.search(/class="[^"]*(?:entry-content|chapter-content|reading-content|content-read|text-content)/i);
    if (inner > 0) seg = seg.slice(inner);
  }
  // corta el ruido del pie (comentarios, navegación, aviso del sitio) antes de convertir a párrafos;
  // desde la 2.18 la comparación es insensible a mayúsculas y cubre el pie real del tema (RCA #3b)
  const cortes = ["novelaschinas", "comments-area", 'id="respond"', "post-navigation", "related-posts",
    "manga-discussion", "membership", "entry-footer", "site-footer", "footer-site", "post-tags",
    "tags-links", "cat-links", "jp-relatedposts", "sharedaddy", "author-box", "breadcrumb",
    "screen-reader-text", "wpp-", "wpdiscuz", "related-novels", "navegacion-capitulos"];
  for (const c of cortes) {
    const j = seg.toLowerCase().indexOf(c.toLowerCase());
    if (j > 500) seg = seg.slice(0, j);
  }
  const p = htmlToParagraphs(seg);
  // las imágenes ANTES del primer párrafo son la cabecera del sitio (banner, logo, portada del
  // post): nunca son ilustraciones del capítulo — fuera (RCA 2026-11, problema #3a)
  const corteP = seg.search(/<p[\s>]/i);
  if (corteP > 0) {
    const k = (seg.slice(0, corteP).match(/<img\b/gi) || []).length;
    if (k > 0 && p.imgs.length) p.imgs = p.imgs.slice(Math.min(k, p.imgs.length));
  }

  // vecinos sin bajar la obra entera: caché → REST en descenso → extremos de la ficha
  let prev = null, next = null;
  try {
    const v = await vecinosDe(slug, id);
    prev = v.prev;
    next = v.next;
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
    if (/novelaschinas\.org|devilnovels\.com|derechos reservados|pol[ií]tica de privacidad|\bdmca\b|inicia sesi[oó]n|historial de lectura|©\s*20\d\d/i.test(t) && t.length < 300) continue;
    if (/^(prev\s+next|comments? for|deja una respuesta|tu direcci[oó]n de correo|class=|href=|<|data-|compartir|share)/i.test(t.trim().slice(0, 40)) && t.length < 300) continue;
    // chrome real del tema (RCA 2026-11, problema #3b): etiquetas, navegación, llamados a la UI
    if (/^(?:etiquetas?\s*[:.]|categor[ií]as?\s*[:.]|tags?\s*[:.]|comp[aá]rtelo|comparte esto|guardar\b|guarda mi|anterior\s*[:.]|siguiente\s*[:.]|leer ahora|leer m[aá]s|anuncio|publicidad|suscr[ií]bete)/i.test(t.trim()) && t.length < 160) continue;
    if (/está bloqueado|membresía lo lees|desbloqueo|suscr[ií]bete para|membres[ií]a (?:requerida|necesaria)/i.test(t) && t.length < 220 && out.length >= 6) continue;
    out.push(t);
  }
  return out;
}

export async function login() {
  netError({ message: "DevilNovels no necesita cuenta para leer: las novelas son públicas" }, "el inicio de sesión");
}
