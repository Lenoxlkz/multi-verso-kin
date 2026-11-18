// novels.js — las seis fuentes de novelas ligeras de Multi-verso Kin (v2.4).
// Cada una expone la misma interfaz que zonatmo.js y manhwa.js:
//   search(src, q)            -> { items: [Item de Kino] }
//   home(src)                 -> [{ id, title, titleEn, items }]  (secciones nativas del propio sitio)
//   detail(src, slug)         -> { slug, title, overview, poster, genres, chapters: [{slug, number, title, pago}] }
//   chapter(src, slug, capId) -> { text: [párrafos], imgs?: [url], number, title, direction, prev, next }
// Verificado en vivo (2026-11):
//   sk · Skynovels      API JSON: /v1/novels?q=, /v1/novels/{id}, /v1/novels/{id}/chapters, /v1/chapters/{cid}
//                       (content = { format:"text", paragraphs:[…] }; capítulos con is_vip/locked)
//   mk · MatchaNovels   API propia: /api/v1/public/novels?search=, /{slug}, /{slug}/chapters,
//                       /{slug}/chapters/{número} (content = HTML con <p>)
//   as · Astral Novels  WordPress.com public-api: categorías = novelas, posts = capítulos (content HTML)
//   an · Anslid         Madara: /?s={q}&post_type=wp-manga, /novela/?m_orderby=trending|latest|views|rating|new,
//                       POST {novela}/ajax/chapters/ (XHR), contenido en {novela}/capitulo-N/
//   dv · DevilNovels    Madara estándar (mismo motor que Anslid; tras Cloudflare, no verificable desde el kit:
//                       se usa la misma estructura y un error elegante si Kino no puede llegar)
//   ln · LegnNovels     Madara estándar (ídem)
// El lector de novelas es de TEXTO: el campo `text` (array de párrafos) lo pinta screen.js como párrafos,
// no como imágenes. Los ref siguen siendo "<src>|m|<slug>" y "<src>|c|<slug>|<capítulo>".

import { fetchText, fetchJson, join, toItem, clip, netError, UA, timeoutFor, cacheKey, cacheGet, cacheSet } from "./env.js";

// Las listas de capítulos cambian poco: 2 h de caché ahorra el XHR/POST de cada lectura.
const CAPS_TTL = 7200000;

/** Lista de capítulos de una obra con caché (2 h). `loader` trae la lista cruda del sitio. */
async function capsOf(src, slug, loader) {
  const ck = cacheKey("caps", src + "|" + slug);
  const cached = cacheGet(ck, CAPS_TTL);
  if (Array.isArray(cached) && cached.length) return cached;
  const caps = await loader();
  if (Array.isArray(caps) && caps.length) cacheSet(ck, caps);
  return caps || [];
}
import { PAGO_TEXT_RE, PAGO_CLASS_RE } from "./env.js";

// ---------- utilidades compartidas ----------

function heads(extra) {
  return Object.assign({ "User-Agent": UA, Accept: "text/html,application/json,*/*" }, extra || {});
}

/** Decodifica entidades HTML comunes sin construir un DOM. */
function unescapeHtml(t) {
  return String(t || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    });
}

/** HTML de un capítulo -> lista de párrafos de texto (y las ilustraciones aparte).
 * Los sitios usan <p> (Matcha), <div> anidados importados de Blogspot (Anslid) o Gutenberg (Astral):
 * el texto se separa por CIERRE de bloque (</p>, </div>, <br>) y se limpia por línea. */
function htmlToParagraphs(html, maxChars) {
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
    if (text.length >= (maxChars || 900)) break;
  }
  return { text, imgs };
}

/** Párrafos que solo repiten la etiqueta de bloqueo VIP no son contenido. */
function esRelleno(t) {
  return /está bloqueado|membresía lo lees|desbloqueo|suscr[ií]bete para/i.test(t);
}

function dropFiller(text) {
  const out = [];
  for (const t of text) {
    if (out.length >= 6 && esRelleno(t) && t.length < 220) continue;
    // chrome del sitio (navegación de capítulo, comentarios, restos de etiquetas): nunca es contenido
    if (/^(prev\s+next|comments? for chapter|manga discussion|deja una respuesta|tu direcci[oó]n de correo|class=|href=|<|data-)/i.test(t.trim().slice(0, 40)) && t.length < 300) continue;
    out.push(t);
  }
  return out;
}

function asItems(src, list) {
  return list.map((m) => toItem(src, m)).filter(Boolean);
}

// ---------- madara (anslid, devilnovels, legnnovels) ----------

function madaraHost(src) {
  return src === "an" ? "https://anslid.com" : src === "dv" ? "https://devilnovels.com" : "https://legnnovels.com";
}

/** Tarjetas de un archivo/búsqueda madara: div.page-item-detail con enlace, portada y título. */
function madaraCards(html, src, limit) {
  const out = [];
  const chunks = String(html).split(/class="page-item-detail/);
  const re = /href="https?:\/\/[^"]*\/novela\/([a-z0-9-]+)\/"/i;
  for (let i = 1; i < chunks.length; i++) {
    if (limit && out.length >= limit) break;
    const seg = chunks[i].slice(0, 3500);
    const m = re.exec(seg);
    if (!m || m[1] === "feed") continue;
    const img = /<img[^>]+src="([^"]+)"/.exec(seg) || /data-src="([^"]+)"/.exec(seg);
    const h = /<h(?:3|4|5)[^>]*>\s*<a[^>]*>([^<]{1,200})<\/a>/.exec(seg) || /<a[^>]*rel="bookmark"[^>]*>([^<]{1,200})<\/a>/.exec(seg);
    const title = h ? unescapeHtml(h[1]).trim() : m[1].replace(/-novela$/, "").replace(/-/g, " ");
    out.push({
      slug: m[1],
      title,
      overview: undefined,
      poster: img ? img[1].replace(/&amp;/g, "&") : undefined,
    });
  }
  return out;
}

async function madaraSearch(src, q) {
  // Madara busca por XHR (action=wp-manga-search-manga): la página HTML de resultados llega vacía aquí.
  try {
    const r = await fetchText(madaraHost(src) + "/wp-admin/admin-ajax.php", {
      heads: heads({ "X-Requested-With": "XMLHttpRequest", Referer: madaraHost(src) + "/", "Content-Type": "application/x-www-form-urlencoded" }),
      method: "POST",
      body: "action=wp-manga-search-manga&title=" + encodeURIComponent(q),
      timeoutMs: timeoutFor(src),
    });
    if (r.ok && r.text) {
      const d = JSON.parse(r.text);
      const items = [];
      for (const it of (d && d.data) || []) {
        const m = /\/novela\/([a-z0-9-]+)\//i.exec((it && it.url) || "");
        if (m && items.length < 30) {
          items.push(toItem(src, { slug: m[1], title: (it.title || m[1]).trim() }));
        }
      }
      const ok = items.filter(Boolean);
      if (ok.length) return { items: ok };
    }
  } catch { /* cae al respaldo HTML */ }
  // Respaldo: la página de búsqueda con tarjetas (otras variantes de madara sí la sirven).
  const r2 = await fetchText(madaraHost(src) + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga", { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r2.ok) netError(new Error("HTTP " + r2.status), "la búsqueda en " + madaraHost(src));
  return { items: asItems(src, madaraCards(r2.text, src, 30)) };
}

async function madaraHome(src) {
  // Secciones nativas del propio sitio (sus filtros m_orderby reales).
  const specs = [
    { id: "trending", t: "Tendencias", te: "Trending", ob: "trending" },
    { id: "latest", t: "Últimas actualizaciones", te: "Latest updates", ob: "latest" },
    { id: "views", t: "Más leídas", te: "Most read", ob: "views" },
    { id: "rating", t: "Mejor valoradas", te: "Top rated", ob: "rating" },
    { id: "new", t: "Nuevas", te: "New", ob: "new" },
  ];
  const settled = await Promise.allSettled(specs.map((s) =>
    fetchText(madaraHost(src) + "/novela/?m_orderby=" + s.ob, { heads: heads(), timeoutMs: timeoutFor(src) })));
  const out = [];
  for (let i = 0; i < specs.length; i++) {
    const p = settled[i];
    if (p.status !== "fulfilled" || !p.value.ok) continue;
    const items = asItems(src, madaraCards(p.value.text, src, 14));
    if (items.length) out.push({ id: src + "-" + specs[i].id, title: specs[i].t, titleEn: specs[i].te, items });
  }
  return out;
}

async function madaraDetail(src, slug) {
  const r = await fetchText(madaraHost(src) + "/novela/" + slug + "/", { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Esta novela no está disponible en la fuente."; }
    netError(e, "el detalle");
  }
  const html = r.text;
  const t = /<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>\s*<a[^>]*>([^<]{1,220})<\/a>/.exec(html)
    || /<h1[^>]*>([^<]{1,220})<\/h1>/.exec(html)
    || /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/.exec(html);
  const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html);
  const desc = /<meta name="description" content="([^"]{0,600})"/.exec(html)
    || /<div[^>]*class="[^"]*summary__content[^"]*"[^>]*>([\s\S]{10,900}?)<\/div>/.exec(html);
  const genres = [];
  const g0 = html.indexOf("genres-content");
  if (g0 >= 0) {
    const seg = html.slice(g0, g0 + 2000);
    const re = />([^<>]{2,40})<\/a>/g;
    let m;
    while ((m = re.exec(seg)) && genres.length < 6) genres.push(unescapeHtml(m[1]).trim());
  }
  // Lista de capítulos por XHR (el sitio la carga igual con JS).
  const chapters = await madaraChapters(src, slug, html);
  return {
    slug,
    title: t ? unescapeHtml(t[1]).trim() : slug.replace(/-novela$/, "").replace(/-/g, " "),
    overview: desc ? unescapeHtml(String(desc[1]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : undefined,
    poster: og ? og[1].replace(/&amp;/g, "&") : undefined,
    genres,
    chapters,
  };
}

/** Lista de capítulos madara: POST {novela}/ajax/chapters/ (el mismo XHR que hace la página). */
async function madaraChapters(src, slug, detailHtml) {
  return capsOf(src, slug, () => madaraChaptersNet(src, slug, detailHtml));
}

/** La lista cruda por red (POST XHR del sitio, respaldo en el HTML del detalle). */
async function madaraChaptersNet(src, slug, detailHtml) {
  const caps = [];
  try {
    const r = await fetchText(madaraHost(src) + "/novela/" + slug + "/ajax/chapters/", {
      heads: heads({ "X-Requested-With": "XMLHttpRequest", Referer: madaraHost(src) + "/novela/" + slug + "/", "Content-Type": "application/x-www-form-urlencoded" }),
      method: "POST",
      timeoutMs: timeoutFor(src),
    });
    if (r.ok && r.text && /chapter/i.test(r.text.slice(0, 60000))) {
      const re = /href="https?:\/\/[^"]*\/novela\/[a-z0-9-]+\/((?:[a-z0-9-]+\/)?capitulo-[0-9.]+(?:-[0-9]+)?)\/"/gi;
      let m;
      while ((m = re.exec(r.text)) && caps.length < 800) {
        const cs = m[1];
        const num = String(cs).replace(/^.*capitulo-/, "").replace(/\/$/, "");
        caps.push({ slug: cs, number: num, title: "Capítulo " + num, pago: PAGO_TEXT_RE.test("capitulo " + num) && false });
      }
    }
  } catch { /* cae al respaldo */ }
  if (!caps.length && detailHtml) {
    const re = /href="https?:\/\/[^"]*\/novela\/[a-z0-9-]+\/((?:[a-z0-9-]+\/)?capitulo-[0-9.]+(?:-[0-9]+)?)\/"/gi;
    let m;
    while ((m = re.exec(detailHtml)) && caps.length < 800) {
      const num = String(m[1]).replace(/^.*capitulo-/, "");
      caps.push({ slug: m[1], number: num, title: "Capítulo " + num });
    }
  }
  caps.reverse(); // el HTML va de más nuevo a más viejo
  return caps;
}

async function madaraChapter(src, slug, capId) {
  const url = madaraHost(src) + "/novela/" + slug + "/" + capId + "/";
  const r = await fetchText(url, { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Este capítulo ya no está disponible."; }
    netError(e, "el capítulo");
  }
  const html = r.text;
  let i0 = html.indexOf('class="reading-content"');
  if (i0 < 0) i0 = html.indexOf("reading-content");
  let seg = i0 >= 0 ? html.slice(i0, i0 + 400000) : html;
  // corta antes de los comentarios y demás ruido del tema (no son capítulo)
  const cortes = ["manga-discussion", "comments-area", "id=\"respond\"", "MANGA DISCUSSION", "c-blog__footer", "wp-manga-nav-content"];
  for (const c of cortes) {
    const j = seg.indexOf(c);
    if (j > 200) seg = seg.slice(0, j);
  }
  const p = htmlToParagraphs(seg, 900);
  // Vecinos: la lista completa (XHR) enlaza todos; con la lista en caché basta.
  const caps = (await madaraChapters(src, slug)).map((c) => c.slug);
  const cur = capId;
  const idx = caps.indexOf(cur);
  return {
    text: dropFiller(p.text),
    imgs: p.imgs,
    number: String(capId).replace(/^.*capitulo-/, ""),
    title: "Capítulo " + String(capId).replace(/^.*capitulo-/, ""),
    direction: "ltr",
    prev: idx >= 0 && idx < caps.length - 1 ? caps[idx + 1] : null,
    next: idx > 0 ? caps[idx - 1] : null,
  };
}

// ---------- skynovels ----------

const SK_API = "https://api.skynovels.net";

function skPoster(n) {
  return n.image ? SK_API + "/img/" + n.image : undefined;
}

async function skSearch(src, q) {
  const r = await fetchJson(SK_API + "/v1/novels?q=" + encodeURIComponent(q) + "&limit=40", { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body) netError(new Error("HTTP " + r.status), "la búsqueda en Skynovels");
  const items = [];
  for (const n of r.body.items || []) {
    if (items.length >= 40) break;
    items.push(toItem(src, {
      slug: String(n.id),
      title: n.title,
      overview: n.synopsis ? clip(n.synopsis, 200) : undefined,
      poster: skPoster(n),
      rating: n.rating != null ? Number(n.rating) : undefined,
    }));
  }
  return { items: items.filter(Boolean) };
}

async function skHome(src) {
  const r = await fetchJson(SK_API + "/v1/home", { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body) return [];
  const b = r.body;
  const secs = [
    { id: "updated", t: "Actualizadas hoy", te: "Updated today", k: "updated" },
    { id: "trending", t: "Tendencias de hoy", te: "Trending today", k: "trendingViews" },
    { id: "week", t: "Lo más leído de la semana", te: "Most read this week", k: "weeklyViews" },
    { id: "month", t: "Lo más leído del mes", te: "Most read this month", k: "monthlyViews" },
    { id: "views", t: "Lo más leído de siempre", te: "Most read of all time", k: "views" },
    { id: "top", t: "Mejor valoradas", te: "Top rated", k: "top_rated" },
    { id: "recent", t: "Recientes", te: "Recent", k: "recent" },
    { id: "finished", t: "Finalizadas", te: "Finished", k: "finished" },
  ];
  const out = [];
  for (const s of secs) {
    const raw = b[s.k];
    const list = Array.isArray(raw) ? raw
      : raw && Array.isArray(raw.novels) ? raw.novels
      : raw && Array.isArray(raw.items) ? raw.items
      : raw && raw.novel ? [raw.novel]
      : [];
    if (!Array.isArray(list) || !list.length) continue;
    const items = asItems(src, list.slice(0, 14).map((n) => ({
      slug: String(n.id),
      title: n.title || n.nvl_title,
      overview: undefined,
      poster: skPoster(n),
    }))).filter(Boolean);
    if (items.length) out.push({ id: src + "-" + s.id, title: s.t, titleEn: s.te, items });
  }
  return out;
}

async function skDetail(src, slug) {
  const r = await fetchJson(SK_API + "/v1/novels/" + encodeURIComponent(slug), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body || !r.body.id) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Esta novela no está disponible en Skynovels."; }
    netError(e, "el detalle");
  }
  const n = r.body;
  const chapters = [];
  const rawCaps = await capsOf(src, slug, async () => {
    const cr = await fetchJson(SK_API + "/v1/novels/" + encodeURIComponent(slug) + "/chapters?limit=800", { heads: heads(), timeoutMs: timeoutFor(src) });
    return Array.isArray(cr.body) ? cr.body : (cr.body && cr.body.items) || [];
  });
  for (const c of rawCaps) {
    const num = c.number != null ? String(c.number) : String(c.id);
    chapters.push({
      slug: String(c.id),
      number: num,
      title: c.title || ("Capítulo " + num),
      pago: Boolean(c.is_vip || c.locked),
    });
  }
  chapters.sort((a, b) => Number(a.number) - Number(b.number));
  return {
    slug,
    title: n.title,
    overview: n.synopsis ? clip(n.synopsis, 600) : undefined,
    poster: skPoster(n),
    genres: Array.isArray(n.genres) ? n.genres.map((g) => String(g.name || g)).filter(Boolean).slice(0, 6) : undefined,
    status: n.status === "Finished" ? "Finalizada" : undefined,
    chapters,
  };
}

async function skChapter(src, slug, capId) {
  const r = await fetchJson(SK_API + "/v1/chapters/" + encodeURIComponent(capId), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Este capítulo no está disponible en Skynovels."; }
    netError(e, "el capítulo");
  }
  const b = r.body;
  let paras = [];
  const c = b.content;
  if (c && Array.isArray(c.paragraphs)) paras = c.paragraphs.map((x) => String(x).replace(/[\u200b-\u200f\uFEFF\u2060]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  else if (typeof c === "string") paras = htmlToParagraphs(c).text;
  else if (b.chp_content) paras = htmlToParagraphs(b.chp_content).text;
  return {
    text: dropFiller(paras).slice(0, 900),
    number: b.number != null ? String(b.number) : capId,
    title: unescapeHtml(b.title || ("Capítulo " + capId)),
    direction: "ltr",
    prev: b.prev_id ? String(b.prev_id) : null,
    next: b.next_id ? String(b.next_id) : null,
  };
}

// ---------- matchanovels ----------

const MK_API = "https://matchanovels.com/api/v1/public";

function mkCover(u) {
  if (!u) return undefined;
  return /^https:/i.test(u) ? u : "https://matchanovels.com" + String(u);
}

async function mkSearch(src, q) {
  const r = await fetchJson(MK_API + "/novels?search=" + encodeURIComponent(q) + "&page=1", { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body) netError(new Error("HTTP " + r.status), "la búsqueda en MatchaNovels");
  const items = [];
  for (const n of r.body.items || []) {
    if (items.length >= 40) break;
    items.push(toItem(src, {
      slug: String(n.slug),
      title: n.title,
      poster: mkCover(n.cover_image_url),
      overview: n.synopsis ? clip(n.synopsis, 200) : undefined,
    }));
  }
  return { items: items.filter(Boolean) };
}

async function mkHome(src) {
  // El catálogo del sitio: listas por orden y por estado (el propio filtro de su web).
  const specs = [
    { id: "latest", t: "Actualizaciones recientes", te: "Latest updates", p: "page=1" },
    { id: "views", t: "Más leídas", te: "Most read", p: "page=1&order=views" },
    { id: "followers", t: "Más seguidas", te: "Most followed", p: "page=1&order=followers" },
    { id: "completed", t: "Completadas", te: "Completed", p: "page=1&status=completed" },
    { id: "ongoing", t: "En curso", te: "Ongoing", p: "page=1&status=ongoing" },
  ];
  const settled = await Promise.allSettled(specs.map((s) =>
    fetchJson(MK_API + "/novels?" + s.p, { heads: heads(), timeoutMs: timeoutFor(src) })));
  const out = [];
  for (let i = 0; i < specs.length; i++) {
    const p = settled[i];
    if (p.status !== "fulfilled" || !p.value.ok || !p.value.body) continue;
    const items = asItems(src, (p.value.body.items || []).slice(0, 14).map((n) => ({
      slug: String(n.slug),
      title: n.title,
      poster: mkCover(n.cover_image_url),
    }))).filter(Boolean);
    if (items.length) out.push({ id: src + "-" + specs[i].id, title: specs[i].t, titleEn: specs[i].te, items });
  }
  return out;
}

async function mkDetail(src, slug) {
  const r = await fetchJson(MK_API + "/novels/" + encodeURIComponent(slug), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body || !r.body.id) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Esta novela no está disponible en MatchaNovels."; }
    netError(e, "el detalle");
  }
  const n = r.body;
  const rawCaps = await capsOf(src, slug, async () => {
    const cr = await fetchJson(MK_API + "/novels/" + encodeURIComponent(slug) + "/chapters", { heads: heads(), timeoutMs: timeoutFor(src) });
    return Array.isArray(cr.body) ? cr.body : [];
  });
  const chapters = rawCaps.map((c) => ({
    slug: String(c.chapter_number),
    number: String(c.chapter_number),
    title: c.title || ("Capítulo " + c.chapter_number),
    pago: Boolean(c.is_vip_only),
  }));
  chapters.sort((a, b) => Number(a.number) - Number(b.number));
  return {
    slug,
    title: n.title,
    overview: n.synopsis ? clip(String(n.synopsis).replace(/<[^>]+>/g, " "), 600) : undefined,
    poster: mkCover(n.cover_image_url),
    genres: Array.isArray(n.genres) ? n.genres.map((g) => String(g.name || g)).filter(Boolean).slice(0, 6) : undefined,
    chapters,
  };
}

async function mkChapter(src, slug, capId) {
  const r = await fetchJson(MK_API + "/novels/" + encodeURIComponent(slug) + "/chapters/" + encodeURIComponent(capId), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Este capítulo no está disponible en MatchaNovels."; }
    netError(e, "el capítulo");
  }
  const b = r.body;
  const p = htmlToParagraphs(b.content || "");
  // vecinos desde la lista en caché (sin re-pedir el detalle: 2 peticiones menos por capítulo)
  const caps = (await capsOf(src, slug, async () => {
    const cr = await fetchJson(MK_API + "/novels/" + encodeURIComponent(slug) + "/chapters", { heads: heads(), timeoutMs: timeoutFor(src) });
    return Array.isArray(cr.body) ? cr.body : [];
  })).map((c) => String(c.chapter_number));
  const idx = caps.indexOf(String(capId));
  return {
    text: dropFiller(p.text),
    imgs: p.imgs,
    number: String(b.chapter_number),
    title: unescapeHtml(b.title || ("Capítulo " + capId)),
    direction: "ltr",
    prev: idx >= 0 && idx < caps.length - 1 ? caps[idx + 1] : null,
    next: idx > 0 ? caps[idx - 1] : null,
  };
}

// ---------- astral (WordPress.com) ----------

const AS_API = "https://public-api.wordpress.com/rest/v1.1/sites/astralnovelstranslations.wordpress.com";

async function asApi(path, src) {
  const r = await fetchJson(AS_API + path, { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok || !r.body) netError(new Error("HTTP " + r.status), "Astral Novels");
  return r.body;
}

function asCover(post) {
  return post && (post.featured_image || (post.post_thumbnail && post.post_thumbnail.URL)) || undefined;
}

/** La categoría de la novela de este post (con su slug limpio, no su nombre con espacios). */
function asCat(post) {
  const c = post && post.categories && Object.values(post.categories)[0];
  return c && c.slug ? String(c.slug) : null;
}

async function asSearch(src, q) {
  // Busca capítulos y agrupa por su novela (categoría): un resultado por novela.
  const b = await asApi("/posts?search=" + encodeURIComponent(q) + "&number=40", src);
  const seen = [];
  const out = [];
  for (const p of b.posts || []) {
    const cat = asCat(p);
    if (!cat || seen.indexOf(cat) >= 0) continue;
    seen.push(cat);
    out.push(toItem(src, {
      slug: cat,
      title: cat.replace(/-/g, " "),
      overview: clip(p.title, 120),
      poster: asCover(p),
    }));
    if (out.length >= 24) break;
  }
  return { items: out.filter(Boolean) };
}

async function asHome(src) {
  // El sitio es un blog: su portada es el feed de publicaciones. Lo nativo es «últimos capítulos».
  const b = await asApi("/posts?number=30", src);
  const items = [];
  for (const p of b.posts || []) {
    const cat = asCat(p);
    if (!cat) continue;
    const it = toItem(src, {
      slug: cat,
      title: cat.replace(/-/g, " "),
      overview: clip(p.title, 120),
      poster: asCover(p),
    });
    if (it && !items.some((x) => x.id === it.id)) items.push(it);
    if (items.length >= 14) break;
  }
  return items.length ? [{ id: src + "-latest", title: "Últimos capítulos publicados", titleEn: "Latest chapter posts", items }] : [];
}

async function asCaps(src, slug) {
  const b = await asApi("/posts?category=" + encodeURIComponent(slug) + "&number=100", src);
  const caps = [];
  for (const p of b.posts || []) {
    const m = /cap[ií]tulo\s*([0-9.]+)/i.exec(p.title || "");
    const num = m ? m[1] : String(p.ID);
    caps.push({ slug: String(p.ID), number: num, title: p.title || ("Capítulo " + num), pago: false });
  }
  caps.reverse(); // de más viejo a más nuevo
  return caps;
}

async function asDetail(src, slug) {
  const caps = await capsOf(src, slug, () => asCaps(src, slug));
  const first = (await asApi("/posts?category=" + encodeURIComponent(slug) + "&number=1", src)).posts || [];
  return {
    slug,
    title: slug.replace(/-/g, " "),
    overview: first.length ? clip(String(first[0].title), 160) : undefined,
    poster: asCover(first[0]),
    chapters: caps,
  };
}

async function asChapter(src, slug, capId) {
  const b = await asApi("/posts/" + encodeURIComponent(capId), src);
  if (!b || !b.ID) netError(new Error("not_found"), "el capítulo");
  const p = htmlToParagraphs(b.content || "");
  const caps = (await capsOf(src, slug, () => asCaps(src, slug))).map((c) => c.slug);
  const idx = caps.indexOf(String(capId));
  return {
    text: dropFiller(p.text),
    imgs: p.imgs,
    number: (/[Cc]ap[ií]tulo\s*([0-9.]+)/.exec(b.title || "") || [])[1] || String(capId),
    title: unescapeHtml(b.title || ("Capítulo " + capId)),
    direction: "ltr",
    prev: idx >= 0 && idx < caps.length - 1 ? caps[idx + 1] : null,
    next: idx > 0 ? caps[idx - 1] : null,
  };
}

// ---------- despacho por fuente ----------

const KIND_OF = { sk: "sk", mk: "mk", as: "as", an: "madara", dv: "madara", ln: "madara" };

export function novelKind(src) {
  return KIND_OF[src] || null;
}

export async function novelSearch(src, q) {
  const k = KIND_OF[src];
  if (k === "sk") return skSearch(src, q);
  if (k === "mk") return mkSearch(src, q);
  if (k === "as") return asSearch(src, q);
  return madaraSearch(src, q);
}

export async function novelHome(src) {
  const k = KIND_OF[src];
  if (k === "sk") return skHome(src);
  if (k === "mk") return mkHome(src);
  if (k === "as") return asHome(src);
  return madaraHome(src);
}

export async function novelDetail(src, slug) {
  const k = KIND_OF[src];
  if (k === "sk") return skDetail(src, slug);
  if (k === "mk") return mkDetail(src, slug);
  if (k === "as") return asDetail(src, slug);
  return madaraDetail(src, slug);
}

export async function novelChapter(src, slug, capId) {
  const k = KIND_OF[src];
  if (k === "sk") return skChapter(src, slug, capId);
  if (k === "mk") return mkChapter(src, slug, capId);
  if (k === "as") return asChapter(src, slug, capId);
  return madaraChapter(src, slug, capId);
}
