// zonatmoorg.js — adaptador de RASPAJE HTML para ZonaTMO.org (zo).
// zonatmo.org NO sirve la API JSON /wp-api/ (esa es de zonatmo.net, que sigue en zonatmo.js).
// El sitio clásico de TuMangaOnline vive en .org y la receta funcional está probada en
// producción por el plugin de referencia ZonaTM0 (v1.2.1, yumehotaru41-rgb):
//   • /library/<tipo>/<id>/<slug>/     — la página de la obra trae TODAS las filas de capítulos
//   • /biblioteca?title=&filter_by=title&order_item=…&order_dir=…&_pg=1&page=N
//                                      — AJAX (X-Requested-With) que responde { html: fragmento }
//   • /view_uploads/<id>/              — el lector; sus páginas viven en
//                                        storage.zonatmo.org/chapters/<id>/<n>.webp
//   • no hay cuentas ni tokens: todo es público y sin sesión
// El slug interno codifica el trío del sitio con puntos (admisible por ID_RE):
//   "manga.12345.solo-leveling"  →  /library/manga/12345/solo-leveling/
// El slug de capítulo codifica id de subida y número: "up-456789.n200.5".

import { fetchText, join, toItem, netError, SOURCES } from "./env.js";

const HOST = SOURCES.zo.host;
const MAX_CAPS = 490; // tope de capítulos por obra (una pantalla de Kino admite ~600 nodos)

// ---------- red ----------

async function getHtml(path, timeoutMs) {
  const r = await fetchText(join("zo", path), {
    heads: { Accept: "text/html", Referer: HOST + "/" },
    timeoutMs: timeoutMs || 45000,
  });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Esta obra no está disponible en ZonaTMO.org."; }
    netError(e, "ZonaTMO.org");
  }
  return r.text;
}

/** La rejilla de /biblioteca llega como JSON { html: fragmento } (como pide la web con XHR). */
async function libHtml(page, order, q, dir, genreId) {
  let url = join("zo", "/biblioteca?title=" + encodeURIComponent(q || "") +
    "&filter_by=title&order_item=" + (order || "likes_count") +
    "&order_dir=" + (dir === "asc" ? "asc" : "desc") + "&_pg=1&page=" + page);
  if (genreId) url += "&genders[]=" + encodeURIComponent(String(genreId));
  const r = await fetchText(url, {
    heads: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: HOST + "/biblioteca",
      "X-Requested-With": "XMLHttpRequest",
    },
    timeoutMs: 25000,
  });
  if (!r.ok) netError(new Error("HTTP " + r.status), "ZonaTMO.org (biblioteca)");
  let frag = "";
  const j = r.text.indexOf("{");
  if (j >= 0) {
    try { frag = JSON.parse(r.text.slice(j)).html || ""; } catch { /* abajo: texto plano */ }
  }
  return frag || r.text; // si el sitio cambió de formato, la rejilla completa también sirve
}

// ---------- scraping ----------

function clean(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ").trim();
}

function absUrl(u) {
  u = String(u || "").trim();
  if (!u || /^data:/.test(u)) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("/") === 0) return HOST + u;
  return u;
}

function natCmp(a, b) {
  const A = String(a).match(/\d+|\D+/g) || [], B = String(b).match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || "", y = B[i] || "";
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d) return d;
    } else {
      const c = x.localeCompare(y);
      if (c) return c;
    }
  }
  return 0;
}

/** "manga.12345.solo-leveling" → "manga/12345/solo-leveling" */
function deSlug(slug) {
  return String(slug).split(".").join("/");
}

/** Tarjetas de obra: enlaces …/library/<tipo>/<id>/<slug>/ del fragmento. Las novelas se saltan (sin páginas). */
function seriesCards(html, max) {
  const out = [], seen = {};
  const re = /href="(?:https:\/\/zonatmo\.org)?\/library\/([a-z_-]+)\/(\d+)\/([a-z0-9-]+)\/?"/g;
  let m;
  while ((m = re.exec(html)) !== null && out.length < (max || 40)) {
    const type = m[1], id = m[2], name = m[3];
    if (seen[id] || type === "page") continue;
    seen[id] = true;
    if (type === "novel" || type === "novela") continue;
    const win = html.slice(m.index, m.index + 3500);
    let title = "";
    const th = win.match(/<h4[^>]*\btitle="([^"]{1,200})"/) || win.match(/<h4[^>]*>\s*([^<]{1,200})</);
    if (th) title = clean(th[1]);
    if (!title) title = name.replace(/-/g, " ");
    let poster = "";
    const im = win.match(/<img[^>]+(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/);
    if (im) poster = absUrl(im[1]);
    if (!poster) {
      const bg = win.match(/data-bg="([^"]+)"/);
      if (bg) poster = absUrl(bg[1]);
    }
    if (!poster) {
      const st = win.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\s*\)/);
      if (st) poster = absUrl(st[1]);
    }
    out.push({ slug: type + "." + id + "." + name, poster, title });
  }
  return out;
}

function cardsToItems(src, cards) {
  return cards.map((c) => toItem(src, { slug: c.slug, title: c.title, poster: c.poster })).filter(Boolean);
}

/** Filas de capítulos: li.upload-link con data-chapter-number y enlaces /view_uploads/<id> (uno por grupo). */
function chapterList(html) {
  const map = new Map();
  const rowRe = /<li[^>]*upload-link[^>]*>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const end = html.indexOf("</li>", m.index);
    const row = html.slice(m.index, end > 0 ? end : m.index + 6000);
    const num = ((row.match(/data-chapter-number="([^"]*)"/) ||
      row.match(/class="chapter-number"[^>]*data-number="([^"]*)"/) || [])[1] || "").trim();
    // «200.50» → «200.5» y «12.00» → «12»: el sitio muestra el número sin ceros finales
    const numN = (num.match(/\d+(?:\.\d+)?/) || [""])[0];
    const numL = numN && numN.indexOf(".") >= 0 ? String(parseFloat(numN)) : numN;
    const upRe = /href="(?:https:\/\/zonatmo\.org)?\/view_uploads\/(\d+)\/?"/g;
    let u;
    while ((u = upRe.exec(row)) !== null) {
      const id = u[1];
      if (map.has(id)) continue;
      const near = row.slice(Math.max(0, u.index - 600), u.index + 600);
      const sm = near.match(/href="[^"]*\/groups\/[^"]*"[^>]*>([^<]{1,60})</);
      const scan = sm ? clean(sm[1]) : "";
      map.set(id, { id, num: numL || id, scan });
    }
  }
  if (!map.size) {
    // plan B: enlaces /view_uploads/ sueltos si el marcado cambia
    const re = /href="(?:https:\/\/zonatmo\.org)?\/view_uploads\/(\d+)\/?"/g;
    let u;
    while ((u = re.exec(html)) !== null) {
      if (map.has(u[1])) continue;
      const near = html.slice(Math.max(0, u.index - 500), u.index + 500);
      const numN = (((near.match(/data-chapter-number="([^"]*)"/) ||
        near.match(/Cap[ií]tulo\s*(\d+(?:\.\d+)?)/i) || [])[1] || "").trim()) || u[1];
      map.set(u[1], { id: u[1], num: numN, scan: "" });
    }
  }
  const arr = [...map.values()];
  arr.sort((a, b) => natCmp(a.num, b.num) || (a.scan || "").localeCompare(b.scan || ""));
  return arr.slice(0, MAX_CAPS);
}

// Caché de listas de capítulos por obra (los vecinos del lector salen de aquí sin re-raspar)
// y deduplicación en vuelo cuando detail() y chapters() arrancan en paralelo.
const SERIE_CACHE = new Map();
const INFLIGHT_SERIE = new Map();
const SERIE_TTL = 600000;
function serieCachePut(slug, chapters) {
  SERIE_CACHE.set(slug, { chapters, ts: Date.now() });
  if (SERIE_CACHE.size > 10) {
    const first = SERIE_CACHE.keys().next().value;
    SERIE_CACHE.delete(first);
  }
}
async function fetchSeriesHtml(slug) {
  let p = INFLIGHT_SERIE.get(slug);
  if (!p) {
    p = getHtml("/library/" + deSlug(slug) + "/").finally(() => {
      if (INFLIGHT_SERIE.get(slug) === p) INFLIGHT_SERIE.delete(slug);
    });
    INFLIGHT_SERIE.set(slug, p);
  }
  return p;
}
async function chaptersDe(slug, html0) {
  const c = SERIE_CACHE.get(slug);
  if (c && Date.now() - c.ts < SERIE_TTL) return c.chapters;
  const html = html0 || await fetchSeriesHtml(slug);
  const chapters = chapterList(html);
  if (chapters.length) serieCachePut(slug, chapters);
  return chapters;
}

/** Metadatos de la página de la obra. */
function seriesMeta(html, slug) {
  const pick = (re) => { const m = html.match(re); return m ? clean(m[1]) : ""; };
  let poster = "";
  const im = html.match(/<img[^>]*class="[^"]*book-thumbnail[^"]*"[^>]*>/);
  if (im) poster = absUrl((im[0].match(/(?:data-src|src)="([^"]+)"/) || [])[1]);
  if (!poster) poster = pick(/property="og:image"[^>]*content="([^"]+)"/) || pick(/content="([^"]+)"[^>]*property="og:image"/);
  let overview = "";
  const sy = html.match(/id="manga-synopsis"[^>]*>([\s\S]{0,3000}?)<\/(?:p|div)>/);
  if (sy) overview = clean(sy[1].replace(/<[^>]+>/g, " "));
  if (!overview) overview = pick(/property="og:description"[^>]*content="([^"]+)"/);
  const genres = [];
  const gre = /href="[^"]*\/tag\/[^"]*"[^>]*>([^<]{1,50})</g;
  let g;
  while ((g = gre.exec(html)) !== null && genres.length < 20) {
    const t = clean(g[1]);
    if (t && genres.indexOf(t) < 0) genres.push(t);
  }
  return {
    slug,
    title: pick(/<h1[^>]*class="[^"]*element-title[^"]*"[^>]*>([^<]{1,200})</) ||
      pick(/property="og:title"[^>]*content="([^"]+)"/) || deSlug(slug).split("/")[2].replace(/-/g, " "),
    poster: poster || undefined,
    overview: overview.slice(0, 600) || undefined,
    genres: genres.slice(0, 5),
  };
}

// ---------- lector ----------

/** Páginas del lector: imágenes …/chapters/<uploadId>/<n>.(webp|jpe?g|png|avif|gif) en el HTML en bruto
 *  (así no se cuelan portadas ni banners), y como última carta las img del lector (class reader-image). */
function readerImages(html, uploadId) {
  const out = [], seen = {};
  const re = new RegExp("https?:\\/\\/[^\"'\\s>]+\\/chapters\\/" + uploadId +
    "\\/\\d+\\.(?:webp|jpe?g|png|avif|gif)", "g");
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[0]]) continue;
    seen[m[0]] = true;
    out.push(m[0]);
  }
  if (!out.length) {
    const re2 = /<img[^>]*class="[^"]*reader-image[^"]*"[^>]*>/g;
    let t;
    while ((t = re2.exec(html)) !== null) {
      const src = (t[0].match(/(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/) || [])[1];
      if (!src || seen[src]) continue;
      seen[src] = true;
      const u = absUrl(src);
      if (u) out.push(u);
    }
  }
  const num = (u) => parseInt((u.match(/\/(\d+)\.[a-z0-9]+(?:\?|$)/i) || [])[1], 10) || 0;
  out.sort((a, b) => num(a) - num(b));
  return out;
}

/** "up-456789.n200.5" → { id: "456789", num: "200.5" } */
function chapterSlugDe(s) {
  const m = String(s || "").match(/^up-(\d+)\.n(.+)$/);
  return m ? { id: m[1], num: m[2] } : null;
}

// ---------- interfaz de adaptador ----------

const ORDEN = { new: "created_at", score: "likes_count", az: "title", old: "created_at" };

export async function list(src, { page = 1, order = "new", search, genreId, postsPerPage = 24 } = {}) {
  const item = ORDEN[order] || "likes_count";
  const dir = order === "az" || order === "old" ? "asc" : "desc";
  const html = await libHtml(page, item, search || "", dir, genreId);
  const cards = seriesCards(html, postsPerPage || 24);
  const hasNext = cards.length >= Math.min(16, postsPerPage || 24) && page < 30;
  return { items: cardsToItems(src, cards), next: hasNext ? String(page + 1) : null };
}

export async function tops(src, { page = 1, postsPerPage = 24 } = {}) {
  return list(src, { page, order: "score", postsPerPage });
}

export async function latest(src) {
  return list(src, { page: 1, order: "new", postsPerPage: 24 });
}

export async function search(src, q, { page = 1, postsPerPage = 24 } = {}) {
  return list(src, { page, order: "likes_count", search: q, postsPerPage });
}

export async function detail(src, slug) {
  const html = await fetchSeriesHtml(slug);
  const meta = seriesMeta(html, slug);
  const chapters = await chaptersDe(slug, html);
  return { ...meta, totalChapters: chapters.length };
}

export async function chapters(src, slug, { order = "asc" } = {}) {
  const list0 = await chaptersDe(slug);
  const arr = list0.slice();
  if (order === "desc") arr.reverse();
  return {
    items: arr.map((c) => ({
      id: "up-" + c.id + ".n" + c.num,
      slug: "up-" + c.id + ".n" + c.num,
      number: c.num,
      title: "Capítulo " + c.num + (c.scan ? " · " + c.scan : ""),
      group: c.scan || undefined,
      pago: false,
    })),
    next: null, // el HTML de la obra trae todos los capítulos: no hay paginación
    total: arr.length,
  };
}

export async function chapter(src, slug, chapterSlug) {
  const ch = chapterSlugDe(chapterSlug);
  if (!ch) netError({ message: "capítulo desconocido" }, "el capítulo");
  const html = await getHtml("/view_uploads/" + ch.id + "/", 45000);
  const pages = readerImages(html, ch.id);
  if (!pages.length) netError({ message: "sin páginas" }, "las páginas del capítulo");
  // vecinos desde la lista de la obra (una raspa, el resto sale de caché)
  let prev = null, next = null;
  try {
    const lista = await chaptersDe(slug);
    const i = lista.findIndex((x) => x.id === ch.id);
    if (i >= 0) {
      if (i > 0) prev = "up-" + lista[i - 1].id + ".n" + lista[i - 1].num;
      if (i < lista.length - 1) next = "up-" + lista[i + 1].id + ".n" + lista[i + 1].num;
    }
  } catch { /* los vecinos son optativos */ }
  return { pages, number: ch.num, title: "Capítulo " + ch.num, direction: "ltr", prev, next };
}

export async function login() {
  netError({ message: "ZonaTMO.org no usa cuentas: el sitio público no las pide" }, "el inicio de sesión");
}
