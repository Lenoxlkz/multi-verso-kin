// manhwa.js — adaptador de ManhwaShot (manhwass.lat y manhwashot.lat son la misma aplicación Next.js).
// Verificado en vivo (2026-11):
//   GET /api/search/?q={texto}          -> JSON { results: [{ postId, title, slug, cover }] }
//   GET /explorar/ y /explorar/page/N/  -> HTML SSR, tarjetas div.s-card con a.s-card-title e img de portada (15 por página)
//   GET /explorar/?estado=on-going|end  -> filtro de estado (chips reales del sitio)
//   GET /manga/{slug}/                  -> HTML SSR: h1 título, meta description (sinopsis), og:image portada,
//                                          capítulos en a.ch-row dentro de .chapters-grid
//   GET /manga/{slug}/{capitulo}/       -> HTML SSR del lector: img[src*="img/WP-manga/"] en orden y capítulos vecinos
// Las imágenes NO piden Referer. La sesión vive en cookies (la ventana visible las recolecta).
// El sitio es webtoon (vertical): el lector usa desplazamiento con zoom, no páginas volteadas.

import { fetchText, fetchJson, join, toItem, netError, UA, msCookie, timeoutFor , PAGO_TEXT_RE, PAGO_CLASS_RE } from "./env.js";

function heads() {
  const c = msCookie();
  const h = { "User-Agent": UA };
  if (c) h.Cookie = c;
  return h;
}

function hasHtml() {
  return typeof kino.html === "object" && kino.html && typeof kino.html.select === "function";
}

/** kino.html.select con red de seguridad: en el kit de Node el método existe pero lanza error al
 * llamarlo (usa Jsoup, que solo está dentro de Kino). Devuelve null y el llamador usa el respaldo. */
function trySelect(html, css) {
  try {
    if (hasHtml()) return kino.html.select(html, css);
  } catch (e) {
    return null;
  }
  return null;
}

/** Título limpio desde el alt de la portada («… portada») o de un nodo de texto. */
function cleanTitle(t) {
  return String(t || "").replace(/\s+/g, " ").replace(/\s*portada\s*$/i, "").trim();
}

/** Una tarjeta div.s-card: slug, título (alt o a.s-card-title) y portada. Funciona con kino.html (Jsoup
 * dentro de Kino) y con regex de respaldo (el kit de Node no trae Jsoup). */
function cardsOf(html, limit) {
  const out = [];
  const cards = trySelect(html, "div.s-card");
  if (cards) {
    for (const card of cards) {
      if (limit && out.length >= limit) break;
      const a = kino.html.select(card.html, "a[href^=\"/manga/\"]");
      let slug = null;
      for (const x of a) {
        const m = /^\/manga\/([a-z0-9-]+)\/?$/.exec((x.attrs && x.attrs.href) || "");
        if (m) { slug = m[1]; break; }
      }
      if (!slug) continue;
      const img = kino.html.select(card.html, "img");
      let cover, title;
      if (img.length && img[0].attrs) {
        cover = img[0].attrs.src;
        title = cleanTitle(img[0].attrs.alt);
      }
      if (!title) {
        const t = kino.html.select(card.html, "a.s-card-title");
        if (t.length && t[0].text) title = cleanTitle(t[0].text);
      }
      out.push({ slug, title: title || slug.replace(/-/g, " "), cover });
    }
    return out;
  }
  // Respaldo con regex: trocea por tarjeta y saca slug, portada y alt.
  const chunks = String(html).split('class="s-card"');
  for (let i = 1; i < chunks.length; i++) {
    if (limit && out.length >= limit) break;
    const seg = chunks[i].slice(0, 2500);
    const m = /href="\/manga\/([a-z0-9-]+)\/?"/.exec(seg);
    if (!m) continue;
    const img = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/.exec(seg) || /<img[^>]+alt="([^"]*)"[^>]*src="([^"]+)"/.exec(seg);
    let cover, title;
    if (img) {
      if (img.length === 3 && img[0].indexOf("src=") < img[0].indexOf("alt=")) { cover = img[1]; title = img[2]; }
      else if (img.length === 3) { title = img[1]; cover = img[2]; }
      if (cover) cover = cover.replace(/&amp;/g, "&");
    }
    out.push({ slug: m[1], title: cleanTitle(title) || m[1].replace(/-/g, " "), cover });
  }
  return out;
}

function asItems(src, cards) {
  return cards.map((c) => toItem(src, { slug: c.slug, title: c.title, poster: c.cover })).filter(Boolean);
}

/** Busca con la API JSON del sitio. */
export async function search(src, q) {
  const { ok, body } = await fetchJson(join(src, "/api/search/?q=" + encodeURIComponent(String(q).slice(0, 100))), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!ok || !body || !Array.isArray(body.results)) return { items: [], next: null, degraded: true };
  return {
    items: body.results.slice(0, 30).map((r) => toItem(src, { slug: r.slug, title: r.title, poster: r.cover })).filter(Boolean),
    next: null,
  };
}

/** Página N de «Explorar» (catálogo completo; `estado`: on-going | end | on-hold | canceled | upcoming; `genero`: slug). */
export async function list(src, { page = 1, estado, genero } = {}) {
  const path = page > 1 ? "/explorar/page/" + page + "/" : "/explorar/";
  const qs = [];
  if (estado) qs.push("estado=" + encodeURIComponent(estado));
  if (genero) qs.push("genero=" + encodeURIComponent(genero));
  const url = join(src, path + (qs.length ? "?" + qs.join("&") : ""));
  const r = await fetchText(url, { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok) netError(new Error("HTTP " + r.status), "Manhwa");
  const cards = cardsOf(r.text, 30);
  return { items: asItems(src, cards), next: cards.length >= 15 ? String(page + 1) : null };
}

/** La fila «Últimas actualizaciones» de la portada del sitio. */
export async function latest(src) {
  const r = await fetchText(join(src, "/"), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok) netError(new Error("HTTP " + r.status), "la portada de Manhwa");
  return { items: asItems(src, cardsOf(r.text, 24)), next: null };
}

/** Detalle de un manga desde su página SSR. */
export async function detail(src, slug) {
  const r = await fetchText(join(src, "/manga/" + slug + "/"), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Este manga no está disponible en " + (src === "mh" ? "ManhwaShot" : "ManhwaSS") + "."; }
    netError(e, "el detalle");
  }
  const html = r.text;
  const h1 = trySelect(html, "h1");
  const title = (h1 && h1.length && h1[0].text ? cleanTitle(h1[0].text) : "") || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const desc = /<meta name="description" content="([^"]{0,600})"/.exec(html);
  const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html) || /<meta[^>]+content="([^"]+)"[^>]+property="og:image"/.exec(html);
  const chapters = [];
  const rows = trySelect(html, ".chapters-grid a.ch-row");
  if (rows) {
    for (const a of rows) {
      const m = /^\/manga\/[a-z0-9-]+\/([^/"]+)\/?$/.exec((a.attrs && a.attrs.href) || "");
      if (!m) continue;
      const label = (a.text || "").replace(/\s+/g, " ").trim();
      chapters.push({ slug: m[1], number: m[1].replace(/^capitulo-/, ""), title: label || ("Capítulo " + m[1].replace(/^capitulo-/, "")), pago: PAGO_TEXT_RE.test(label) || PAGO_CLASS_RE.test(String((a.attrs && a.attrs.class) || "")) });
      if (chapters.length >= 500) break;
    }
  } else {
    // Respaldo con regex: el bloque .chapters-grid y sus enlaces a.ch-row.
    const i0 = html.indexOf("chapters-grid");
    const seg = i0 >= 0 ? html.slice(i0, i0 + 400000) : html;
    const re = /href="\/manga\/[a-z0-9-]+\/(capitulo-[0-9.]+)\/"/g;
    let m;
    while ((m = re.exec(seg)) && chapters.length < 500) {
      chapters.push({ slug: m[1], number: m[1].replace(/^capitulo-/, ""), title: "Capítulo " + m[1].replace(/^capitulo-/, "") });
    }
  }
  chapters.reverse(); // el HTML va de más nuevo a más viejo: el detalle lista de más viejo a más nuevo
  return {
    slug,
    title,
    overview: desc ? String(desc[1]).trim() : undefined,
    poster: og ? og[1].replace(/&amp;/g, "&") : undefined,
    chapters,
  };
}

/** El número de un capítulo («capitulo-493» -> 493, «capitulo-12.5» -> 12.5, «capitulo-0.1» -> 0.1). */
function capNum(s) {
  const n = Number(String(s).replace(/^capitulo-/, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Imágenes de un capítulo y vecinos (prev = el mayor número menor, next = el menor número mayor). */
export async function chapter(src, slug, chapterSlug) {
  const r = await fetchText(join(src, "/manga/" + slug + "/" + chapterSlug + "/"), { heads: heads(), timeoutMs: timeoutFor(src) });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    if (r.status === 404) { e.code = "not_found"; e.userMessage = "Este capítulo ya no está disponible."; }
    netError(e, "el capítulo");
  }
  const html = r.text;
  const pages = [];
  const imgs = trySelect(html, 'img[src*="img/WP-manga/"]');
  if (imgs) {
    for (const im of imgs) {
      const u = im.attrs && im.attrs.src;
      if (u && /^https:/i.test(u) && pages.indexOf(u) < 0) pages.push(u);
    }
  } else {
    const re = /src="(https:\/\/img\.[a-z.]+\/img\/WP-manga\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (pages.indexOf(m[1]) < 0) pages.push(m[1].replace(/&amp;/g, "&"));
    }
  }
  // Capítulos vecinos por número, con TODOS los capítulos que el lector enlaza.
  const caps = [];
  const navs = trySelect(html, 'a[href*="/capitulo-"]');
  if (navs) {
    for (const a of navs) {
      const m = /\/capitulo-([0-9.]+)\/?$/.exec((a.attrs && a.attrs.href) || "");
      if (m && caps.indexOf(m[1]) < 0) caps.push(m[1]);
    }
  } else {
    const re = /href="\/manga\/[a-z0-9-]+\/(capitulo-[0-9.]+)\/"/g;
    let m;
    while ((m = re.exec(html))) {
      if (caps.indexOf(m[1]) < 0) caps.push(m[1]);
      if (caps.length >= 12) break;
    }
  }
  const cur = capNum(chapterSlug);
  let prev = null, next = null;
  for (const c of caps) {
    const n = capNum(c);
    if (!Number.isFinite(n) || n === cur) continue;
    if (n < cur && (prev === null || n > capNum(prev))) prev = c;
    if (n > cur && (next === null || n < capNum(next))) next = c;
  }
  return {
    pages,
    number: String(chapterSlug).replace(/^capitulo-/, ""),
    title: "Capítulo " + String(chapterSlug).replace(/^capitulo-/, ""),
    direction: "ltr",
    prev,
    next,
  };
}

/** Intento de inicio de sesión con usuario/correo y contraseña (el sitio puede pedir Turnstile). */
export async function login(src, user, password) {
  try {
    const r = await kino.fetch(join(src, "/api/auth/login/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { json: { login: user, password, device: "kino-plugin" } },
      timeoutMs: 15000,
    });
    const body = r.json ? r.json() : null;
    if (r.ok && body && body.user) return { ok: true, user: body.user };
    const msg = body && body.error ? String(body.error) : "";
    if (msg.toLowerCase().includes("turnstile") || msg.toLowerCase().includes("verificaci")) {
      return { ok: false, message: "El sitio pidió su verificación anti-bot: usa «Entrar con ventana» en los ajustes." };
    }
    return { ok: false, message: msg ? ("No se entró: " + msg.slice(0, 140)) : "No se entró: usa «Entrar con ventana» en los ajustes." };
  } catch (e) {
    return { ok: false, message: "No se pudo contactar al sitio: usa «Entrar con ventana» en los ajustes." };
  }
}
