import {
  SOURCES, fetchText, netError, toItem,
} from "./env.js";

// Adaptador VisualIkigai (https://visualikigai.cmpunjabrashancard.pk)
// Sitio SSR en Qwik con cómics y novelas ligeras.

const MAX_SLUG_LEN = 112;
const fullSlugCache = new Map();
const capsMem = new Map();
const metaMem = new Map();

function join(src, path) {
  const base = SOURCES[src].host;
  if (!path) return base;
  return path.startsWith("http") ? path : base + (path.startsWith("/") ? path : "/" + path);
}

function absUrl(raw, base) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return "https:" + s;
  return base + (s.startsWith("/") ? s : "/" + s);
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function cleanText(s) {
  return decodeHtml(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function encodeIkSlug(rawSlug) {
  const clean = String(rawSlug || "").replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!clean) return "";
  if (clean.length <= MAX_SLUG_LEN) return clean;
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = ((h * 31) + clean.charCodeAt(i)) >>> 0;
  const tag = h.toString(36);
  const short = clean.slice(0, MAX_SLUG_LEN - tag.length - 1) + "_" + tag;
  fullSlugCache.set(short, clean);
  if (fullSlugCache.size > 400) fullSlugCache.delete(fullSlugCache.keys().next().value);
  return short;
}

function decodeIkSlug(encSlug) {
  const s = String(encSlug || "").trim();
  return fullSlugCache.get(s) || s;
}

function parseCards(src, html) {
  const out = [];
  const seen = new Set();
  // Tarjetas principales de /series/: <a href="/series/<slug>/" class="card ...">...</a>
  const cardRe = /<a[^>]+href=["']\/series\/([a-z0-9-]+)\/?["'][^>]*class=["'][^"']*\bcard\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const rawSlug = m[1];
    if (!rawSlug || seen.has(rawSlug)) continue;
    seen.add(rawSlug);
    const block = m[2];
    const h3Match = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block);
    const imgMatch = /<img[^>]+>/i.exec(block);
    const imgTag = imgMatch ? imgMatch[0] : "";
    const posterRaw = (/(?:data-src|src)=["']([^"']+)["']/i.exec(imgTag) || [])[1] || "";
    const altTitle = (/\balt=["']([^"']+)["']/i.exec(imgTag) || [])[1] || "";
    const title = cleanText((h3Match && h3Match[1]) || altTitle || rawSlug.replace(/-/g, " "));
    if (!title) continue;
    const badge = cleanText((/<div[^>]+class=["'][^"']*\bbadge[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block) || [])[1] || "");
    const enc = encodeIkSlug(rawSlug);
    const poster = absUrl(posterRaw, SOURCES[src].host);
    metaMem.set(src + "|" + enc, { title, poster, badge });
    if (metaMem.size > 500) metaMem.delete(metaMem.keys().next().value);
    const it = toItem(src, { slug: enc, title, poster });
    if (it) out.push(it);
  }
  return out;
}

function extractMaxPage(html) {
  let max = 1;
  const re = /[?&]pagina=(\d+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

export async function list(src, { page = 1, genre = "", sort = "last_chapter_date", type = "", q = "" } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const params = ["pagina=" + p];
    if (sort) params.push("ordenar=" + encodeURIComponent(sort), "direccion=desc");
    if (genre) params.push("generos[]=" + encodeURIComponent(genre));
    if (type) params.push("tipos[]=" + encodeURIComponent(type));
    if (q) params.push("buscar=" + encodeURIComponent(q));
    const url = join(src, "/series/?" + params.join("&"));
    const { ok, status, text } = await fetchText(url);
    if (!ok || !text) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "ikigai HTTP " + status);
    }
    const items = parseCards(src, text);
    const maxP = extractMaxPage(text);
    const next = (items.length > 0 && p < maxP) ? String(p + 1) : null;
    return { items, next };
  } catch (e) {
    netError(e, "Ikigai");
  }
}

export async function tops(src, page = 1) {
  return list(src, { page, sort: "view_count" });
}

export async function latest(src, page = 1) {
  return list(src, { page, sort: "last_chapter_date" });
}

export async function search(src, q, page = 1) {
  const query = String(q || "").trim();
  if (!query) return { items: [], next: null };
  return list(src, { page, sort: "view_count", q: query });
}

function extractDetailFields(src, html, encSlug, rawSlug) {
  const h1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || "");
  const cached = metaMem.get(src + "|" + encSlug) || {};

  // Portada principal (rs:fill:350:500 o /series/covers/ dentro de main)
  const mainMatch = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  const mainHtml = mainMatch ? mainMatch[1] : html;
  const coverMatch = /<img[^>]+src=["'](https:\/\/[^"']*ikigaimangas\.cloud\/[^"']*\/rs:fill:350:500[^"']+|https:\/\/[^"']*\/covers\/[^"']+)["'][^>]*>/i.exec(mainHtml)
    || /<img[^>]+src=["'](https:\/\/[^"']+)["'][^>]*alt=["'][^"']*["'][^>]*>/i.exec(mainHtml);
  const poster = absUrl((coverMatch && coverMatch[1]) || cached.poster || "", SOURCES[src].host);

  // Sinopsis: <meta name="description"> o párrafo largo en main
  let overview = cleanText((/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html) || [])[1] || "");
  if (!overview || /Lee el último|Ikigai Mangas/i.test(overview)) {
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = pRe.exec(mainHtml)) !== null) {
      const txt = cleanText(pm[1]);
      if (txt.length > 45 && !/Lee el último|Webtoon|Manhwa es el término|Una novela es|Wuxia es un género/i.test(txt)) {
        overview = txt;
        break;
      }
    }
  }

  // Géneros dentro de main (enlaces a generos[]=...)
  const genres = [];
  const gSeen = new Set();
  const gRe = /<a[^>]+href=["'][^"']*generos\[\]=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let gm;
  while ((gm = gRe.exec(mainHtml)) !== null) {
    const g = cleanText(gm[1]);
    if (g && !gSeen.has(g)) {
      gSeen.add(g);
      genres.push(g);
    }
  }

  // Estado y tipo
  let statusName;
  if (/Completa|Finalizado/i.test(mainHtml)) statusName = "Finalizado";
  else if (/En Curso/i.test(mainHtml)) statusName = "En curso";
  else if (/Pausad/i.test(mainHtml)) statusName = "Pausado";

  const isNovel = /-novela\d*$/i.test(rawSlug) || /Novela/i.test(cached.badge || "") || /\bNovela\b/i.test(h1);
  const demographyName = isNovel ? "Novela ligera" : "Cómic · Manhwa";

  return {
    slug: encSlug,
    title: h1 || cached.title || cleanText(rawSlug.replace(/-/g, " ")),
    overview,
    poster,
    genres,
    statusName,
    demographyName,
    score: undefined,
    totalChapters: undefined,
    adult: genres.some((g) => /\+18|Adulto|Gore/i.test(g)),
  };
}

function extractChapterLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']\/capitulo\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const chId = m[1];
    const rawTxt = cleanText(m[2]);
    if (!chId || seen.has(chId)) continue;
    // Ignorar botones "Primer Capítulo" / "Último Capítulo" que duplican el enlace de la lista
    if (/^(primer|último|ultimo)\s+cap/i.test(rawTxt)) continue;
    seen.add(chId);
    const numMatch = /Cap[ií]tulo\s*(\d+(?:\.\d+)?)/i.exec(rawTxt) || /^(\d+(?:\.\d+)?)/.exec(rawTxt);
    const number = numMatch ? String(numMatch[1]) : String(chId);
    out.push({
      slug: chId,
      number,
      title: "Capítulo " + number,
      pago: false,
    });
  }
  return out;
}

export async function detail(src, encSlug) {
  try {
    const rawSlug = decodeIkSlug(encSlug);
    const url = join(src, "/series/" + encodeURIComponent(rawSlug) + "/");
    const { ok, status, text } = await fetchText(url);
    if (!ok || !text) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "ikigai detail HTTP " + status);
    }
    const info = extractDetailFields(src, text, encSlug, rawSlug);
    // Estimar total aproximado si conocemos páginas de capítulos
    const maxPage = extractMaxPage(text);
    const firstCaps = extractChapterLinks(text);
    if (firstCaps.length && maxPage === 1) info.totalChapters = firstCaps.length;
    else if (firstCaps.length && maxPage > 1) info.totalChapters = firstCaps.length * maxPage;
    return info;
  } catch (e) {
    netError(e, "Ikigai");
  }
}

export async function chapters(src, encSlug, { page = 1, order = "asc" } = {}) {
  try {
    const rawSlug = decodeIkSlug(encSlug);
    const p = Math.max(1, Number(page) || 1);
    const dir = order === "desc" ? "desc" : "asc";

    if (dir === "desc") {
      const url = join(src, "/series/" + encodeURIComponent(rawSlug) + "/?pagina=" + p);
      const { ok, status, text } = await fetchText(url);
      if (!ok || !text) {
        throw kino.error(status === 404 ? "not_found" : "unavailable", "ikigai chapters HTTP " + status);
      }
      const items = extractChapterLinks(text);
      const maxP = extractMaxPage(text);
      return { items, next: p < maxP ? String(p + 1) : null };
    }

    // Ikigai ordena de más nuevo a más viejo en ?pagina=1..lastPage.
    // Para orden ascendente ("Capítulo 1" primero), recorremos desde lastPage hacia 1.
    const url1 = join(src, "/series/" + encodeURIComponent(rawSlug) + "/?pagina=1");
    const r1 = await fetchText(url1);
    if (!r1.ok || !r1.text) {
      throw kino.error(r1.status === 404 ? "not_found" : "unavailable", "ikigai chapters HTTP " + r1.status);
    }
    const maxP = extractMaxPage(r1.text);
    const targetPage = Math.max(1, maxP - p + 1);
    let html = r1.text;
    if (targetPage !== 1) {
      const rp = await fetchText(join(src, "/series/" + encodeURIComponent(rawSlug) + "/?pagina=" + targetPage));
      if (!rp.ok || !rp.text) {
        throw kino.error(rp.status === 404 ? "not_found" : "unavailable", "ikigai chapters HTTP " + rp.status);
      }
      html = rp.text;
    }
    const items = extractChapterLinks(html).slice().reverse();
    const key = src + "|" + encSlug;
    if (p === 1 && items.length) {
      capsMem.set(key, items.map((c) => c.slug));
    } else if (capsMem.has(key)) {
      const merged = capsMem.get(key).slice();
      for (const it of items) if (!merged.includes(it.slug)) merged.push(it.slug);
      capsMem.set(key, merged);
    }
    return { items, next: p < maxP ? String(p + 1) : null };
  } catch (e) {
    netError(e, "Ikigai");
  }
}

function extractReaderNeighbors(html) {
  let prev = null;
  let next = null;
  const re = /<a[^>]+href=["']\/capitulo\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const txt = cleanText(m[2]);
    if (/anterior/i.test(txt) && !prev) prev = id;
    if (/siguiente/i.test(txt) && !next) next = id;
  }
  return { prev, next };
}

function extractComicPages(html) {
  const pages = [];
  const seen = new Set();
  const re = /<img[^>]+(?:data-src|src)=["'](https:\/\/[^"']*ikigaimangas\.cloud\/series\/(\d+)\/(\d+)\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    const seriesId = m[2];
    if (seriesId === "1000" || /BannerConcurso|covers/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    pages.push(u);
  }
  return pages;
}

function extractNovelParagraphs(html) {
  const startMatch = /<div[^>]+class=["'][^"']*\bprose\b[^"']*["'][^>]*>/i.exec(html);
  if (!startMatch) return [];
  const after = html.slice(startMatch.index + startMatch[0].length);
  const endIdx = after.search(/<\/section>|<\/main>|<nav\b|<!--\/qv-->\s*<\/div>\s*<div/i);
  const raw = endIdx >= 0 ? after.slice(0, endIdx) : after.slice(0, 60000);
  const normalized = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const out = [];
  for (const line of normalized.split(/\r?\n/)) {
    const text = cleanText(line);
    if (!text || text.length < 2) continue;
    if (/Si ves este mensaje, significa que el sitio web|traducci[oó]n fue posible gracias a nuestros patrocinadores|este problema suele resolverse/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

export async function chapter(src, encSlug, chSlug) {
  try {
    const url = join(src, "/capitulo/" + encodeURIComponent(String(chSlug)) + "/");
    const { ok, status, text } = await fetchText(url);
    if (!ok || !text) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "ikigai chapter HTTP " + status);
    }
    const { prev, next } = extractReaderNeighbors(text);
    const titleTag = cleanText((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || "").split("|")[0].trim();
    const h1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text) || [])[1] || "");
    const numMatch = /Cap[ií]tulo\s*(\d+(?:\.\d+)?)/i.exec(titleTag + " " + h1);
    const number = numMatch ? String(numMatch[1]) : String(chSlug);

    const pages = extractComicPages(text);
    if (pages.length) {
      return {
        pages,
        number,
        title: titleTag || ("Capítulo " + number),
        direction: "vertical",
        prev,
        next,
      };
    }

    const paragraphs = extractNovelParagraphs(text);
    if (paragraphs.length) {
      return {
        text: paragraphs,
        imgs: [],
        number,
        title: titleTag || ("Capítulo " + number),
        direction: "vertical",
        prev,
        next,
      };
    }

    throw kino.error("unavailable", "ikigai capítulo sin contenido legible");
  } catch (e) {
    netError(e, "Ikigai");
  }
}
