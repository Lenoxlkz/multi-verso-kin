// olympus.js — Adaptador para Olympus (olympusxyz.com): cómics (imágenes) y novelas ligeras (texto).
// Codifica el tipo en el slug interno («c.<slug>» | «n.<slug>») para despachar sin peticiones extra.

import { fetchJson, fetchText, join, netError, toItem, cacheKey, cacheGet, cacheSet, TTL } from "./env.js";

const API_HEADS = { Accept: "application/json, text/plain, */*" };
const MEDIA_BASE = "https://media.imagesolymp.xyz/";

export const OL_GENRES = {
  "1": "Acción",
  "3": "Apocalíptico",
  "4": "Artes marciales",
  "5": "Aventura",
  "6": "Ciencia Ficción",
  "7": "Comedia",
  "9": "Cultivación",
  "12": "Ecchi",
  "14": "Fantasía",
  "16": "Harem",
  "17": "Histórico",
  "19": "Magia",
  "20": "Misterio",
  "21": "Murim",
  "22": "Psicológico",
  "25": "Reencarnación",
  "26": "Romance",
};

const fullSlugCache = new Map();
const capsMem = new Map();

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
  return decodeHtml(String(s || "").replace(/<[^>]+>/g, " "))
    .replace(/\u200e|\u200f/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function encodeOlSlug(type, rawSlug) {
  const prefix = String(type || "").toLowerCase() === "novel" ? "n." : "c.";
  const safe = String(rawSlug || "").replace(/[^A-Za-z0-9._~-]/g, "-");
  const full = prefix + safe;
  if (full.length <= 116) return full;
  const clipped = full.slice(0, 116);
  fullSlugCache.set(clipped, { type: prefix === "n." ? "novel" : "comic", slug: safe });
  return clipped;
}

export function decodeOlSlug(encSlug) {
  const raw = String(encSlug || "");
  if (fullSlugCache.has(raw)) return fullSlugCache.get(raw);
  if (raw.startsWith("n.")) return { type: "novel", slug: raw.slice(2) };
  if (raw.startsWith("c.")) return { type: "comic", slug: raw.slice(2) };
  return { type: "comic", slug: raw };
}

function absCover(cover) {
  const c = String(cover || "").trim();
  if (!c) return undefined;
  if (/^https?:\/\//i.test(c)) return c;
  if (c.startsWith("//")) return "https:" + c;
  return MEDIA_BASE + c.replace(/^\/+/, "");
}

function seriesToCard(src, m) {
  if (!m || !m.slug) return null;
  const encSlug = encodeOlSlug(m.type || "comic", m.slug);
  const genres = Array.isArray(m.genres)
    ? m.genres.map((g) => (typeof g === "string" ? g : g && g.name)).filter(Boolean)
    : undefined;
  return toItem(src, {
    slug: encSlug,
    title: cleanText(m.name || m.title || m.slug),
    poster: absCover(m.cover),
    overview: m.summary ? cleanText(m.summary) : undefined,
    genres,
    year: m.created_at ? String(m.created_at).slice(0, 4) : undefined,
  });
}

async function getAllSeriesList(src) {
  const ck = cacheKey("ol-all", src);
  const cached = cacheGet(ck, TTL.list);
  if (Array.isArray(cached) && cached.length) return cached;
  const { ok, status, body } = await fetchJson(join(src, "/api/series/list"), { heads: API_HEADS });
  if (!ok || !body || !Array.isArray(body.data)) {
    throw kino.error(status === 404 ? "not_found" : "unavailable", "olympus list HTTP " + status);
  }
  const slim = body.data.map((x) => ({
    s: x.slug,
    n: x.name,
    c: x.cover,
    t: x.type === "novel" ? "novel" : "comic",
  }));
  if (slim.length) cacheSet(ck, slim);
  return slim;
}

export async function list(src, { page = 1, order = "new", type, genreId, statusId } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const params = ["page=" + p];
    if (type === "novel" || type === "comic") params.push("type=" + type);
    if (genreId) params.push("genres=" + encodeURIComponent(String(genreId)));
    if (statusId) params.push("status=" + encodeURIComponent(String(statusId)));
    params.push("direction=" + (order === "az" ? "asc" : "desc"));

    const { ok, status, body } = await fetchJson(join(src, "/api/series?" + params.join("&")), { heads: API_HEADS });
    if (!ok || !body) throw kino.error(status === 404 ? "not_found" : "unavailable", "olympus HTTP " + status);
    const pageObj = (body.data && body.data.series) || {};
    const rows = Array.isArray(pageObj.data) ? pageObj.data : [];
    const items = rows.map((m) => seriesToCard(src, m)).filter(Boolean);
    const curPage = Number(pageObj.current_page) || p;
    const lastPage = Number(pageObj.last_page) || curPage;
    return { items, next: curPage < lastPage ? String(curPage + 1) : null };
  } catch (e) {
    netError(e, "Olympus");
  }
}

export async function tops(src, { page = 1, kind = "daily" } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const rankType = kind === "weekly" || kind === "monthly" ? kind : "daily";
    const { ok, status, body } = await fetchJson(join(src, "/api/rankings?type=" + rankType + "&page=" + p), { heads: API_HEADS });
    if (!ok || !body) throw kino.error(status === 404 ? "not_found" : "unavailable", "olympus rankings HTTP " + status);
    const rows = Array.isArray(body.data) ? body.data : [];
    const items = rows.map((m) => seriesToCard(src, m)).filter(Boolean);
    const curPage = Number(body.current_page) || p;
    const lastPage = Number(body.last_page) || curPage;
    return { items, next: curPage < lastPage ? String(curPage + 1) : null };
  } catch (e) {
    netError(e, "Olympus");
  }
}

export async function latest(src) {
  return list(src, { page: 1, order: "new", type: "comic" });
}

export async function search(src, q) {
  try {
    const raw = String((q && (q.q || q)) || "").trim().toLowerCase();
    if (!raw) return { items: [], next: null };
    const all = await getAllSeriesList(src);
    const tokens = raw.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const x of all) {
      const nameL = String(x.n || "").toLowerCase();
      const slugL = String(x.s || "").toLowerCase();
      if (tokens.every((tok) => nameL.includes(tok) || slugL.includes(tok))) {
        const card = seriesToCard(src, { slug: x.s, name: x.n, cover: x.c, type: x.t });
        if (card) hits.push({ card, exact: nameL.startsWith(raw) ? 0 : 1 });
      }
    }
    hits.sort((a, b) => a.exact - b.exact);
    return { items: hits.slice(0, 40).map((h) => h.card), next: null };
  } catch (e) {
    netError(e, "Olympus");
  }
}

export async function detail(src, encSlug) {
  try {
    const { type, slug } = decodeOlSlug(encSlug);
    const qs = type === "novel" ? "?type=novel" : "";
    const { ok, status, body } = await fetchJson(join(src, "/api/series/" + encodeURIComponent(slug) + qs), { heads: API_HEADS });
    if (!ok || !body || !body.data) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "olympus detail HTTP " + status);
    }
    const d = body.data;
    const genres = Array.isArray(d.genres) ? d.genres.map((g) => cleanText(g && g.name)).filter(Boolean) : [];
    const total = Number(d.chapter_count || d.total_chapters) || undefined;
    return {
      slug: encSlug,
      title: cleanText(d.name || slug),
      overview: cleanText(d.summary || d.synopsis || ""),
      poster: absCover(d.cover),
      genres,
      statusName: d.status && d.status.name ? cleanText(d.status.name) : undefined,
      demographyName: type === "novel" ? "Novela ligera" : "Cómic · Manhwa",
      score: undefined,
      totalChapters: total,
      adult: false,
    };
  } catch (e) {
    netError(e, "Olympus");
  }
}

function mapChapterList(rows) {
  return (rows || []).map((ch) => {
    const chSlug = String(ch.name != null ? ch.name : ch.id).trim();
    const numMatch = /(\d+(?:\.\d+)?)/.exec(chSlug);
    const num = numMatch ? Number(numMatch[1]) : NaN;
    return {
      slug: chSlug,
      number: Number.isFinite(num) ? String(num) : chSlug,
      title: ch.title ? cleanText(ch.title) : "Capítulo " + chSlug,
      pago: false,
    };
  });
}

export async function chapters(src, encSlug, { page = 1, order = "asc" } = {}) {
  try {
    const { type, slug } = decodeOlSlug(encSlug);
    const p = Math.max(1, Number(page) || 1);
    const dir = order === "desc" ? "desc" : "asc";
    const typeQ = type === "novel" ? "&type=novel" : "";
    const url = join(src, "/api/series/" + encodeURIComponent(slug) + "/chapters?page=" + p + "&direction=" + dir + typeQ);
    const { ok, status, body } = await fetchJson(url, { heads: API_HEADS });
    if (!ok || !body || !Array.isArray(body.data)) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "olympus chapters HTTP " + status);
    }
    const items = mapChapterList(body.data);
    const meta = body.meta || {};
    const cur = Number(meta.current_page) || p;
    const last = Number(meta.last_page) || cur;
    if (p === 1 && items.length) {
      capsMem.set(src + "|" + encSlug, items.map((c) => c.slug));
    } else if (capsMem.has(src + "|" + encSlug)) {
      const merged = capsMem.get(src + "|" + encSlug).slice();
      for (const it of items) if (!merged.includes(it.slug)) merged.push(it.slug);
      capsMem.set(src + "|" + encSlug, merged);
    }
    return { items, next: cur < last ? String(cur + 1) : null };
  } catch (e) {
    netError(e, "Olympus");
  }
}

async function ensureChapterNeighbors(src, encSlug, chSlug) {
  const key = src + "|" + encSlug;
  let listSlugs = capsMem.get(key);
  if (!listSlugs || !listSlugs.includes(chSlug)) {
    const det = cacheGet(cacheKey("det", src + "|m|" + encSlug), TTL.detail);
    if (det && Array.isArray(det.chapters) && det.chapters.length) {
      listSlugs = det.chapters.map((c) => {
        const parts = String(c.r || "").split("|");
        return parts.slice(3).join("|");
      }).filter(Boolean);
    }
  }
  if (!listSlugs || !listSlugs.includes(chSlug)) {
    try {
      const c1 = await chapters(src, encSlug, { page: 1, order: "asc" });
      listSlugs = (c1.items || []).map((c) => c.slug);
    } catch { listSlugs = []; }
  }
  const idx = listSlugs ? listSlugs.indexOf(chSlug) : -1;
  return {
    prev: idx > 0 ? listSlugs[idx - 1] : null,
    next: idx >= 0 && idx < listSlugs.length - 1 ? listSlugs[idx + 1] : null,
  };
}

function extractComicImages(html) {
  const pages = [];
  const seen = new Set();
  const re = /<img[^>]+(?:data-src|src)=["'](https:\/\/media\.imagesolymp\.xyz\/comics\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (/\/covers\/|avatar|banner|logo|icon/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    pages.push(u);
  }
  if (!pages.length) {
    // Respaldo genérico por si Nuxt cambia subdominio del CDN
    const anyRe = /<img[^>]+src=["'](https?:\/\/[^"']+\.(?:webp|jpe?g|png)(?:\?[^"']*)?)["'][^>]*>/gi;
    while ((m = anyRe.exec(html)) !== null) {
      const u = m[1];
      if (/\/assets\/|\/covers\/|logo|avatar|favicon|badge|discord|paypal/i.test(u)) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      pages.push(u);
    }
  }
  return pages;
}

function extractNovelParagraphs(html) {
  const artMatch = /<article[^>]*class=["'][^"']*\bnovel\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(html)
    || /<div[^>]*class=["'][^"']*\bnovel\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const raw = artMatch ? artMatch[1] : "";
  if (!raw) return [];
  const normalized = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const out = [];
  for (const line of normalized.split(/\r?\n/)) {
    const text = decodeHtml(line).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/tradujo gente que no cobra|olympusscanlation|olympusxyz|únete a nuestro discord/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

export async function chapter(src, encSlug, chSlug) {
  try {
    const { type, slug } = decodeOlSlug(encSlug);
    const kindSeg = type === "novel" ? "novela-" : "comic-";
    const url = join(src, "/series/" + kindSeg + encodeURIComponent(slug) + "/capitulo/" + encodeURIComponent(String(chSlug)));
    const { ok, status, text } = await fetchText(url);
    if (!ok || !text) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "olympus chapter HTTP " + status);
    }
    const { prev, next } = await ensureChapterNeighbors(src, encSlug, String(chSlug));
    const rawH1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text) || [])[1] || "");
    const titleTag = cleanText((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || "").split("|")[0].trim();
    const h1 = (rawH1 && !/^(recomendadas|comentarios|olympus)/i.test(rawH1)) ? rawH1 : (titleTag || "");
    const numMatch = /(\d+(?:\.\d+)?)/.exec(String(chSlug));
    const number = numMatch ? String(numMatch[1]) : String(chSlug);

    if (type === "novel") {
      const paragraphs = extractNovelParagraphs(text);
      if (!paragraphs.length) {
        throw kino.error("unavailable", "olympus novela sin contenido legible");
      }
      return {
        text: paragraphs,
        imgs: [],
        number,
        title: h1 || ("Capítulo " + number),
        direction: "vertical",
        prev,
        next,
      };
    }

    const pages = extractComicImages(text);
    if (!pages.length) {
      throw kino.error("unavailable", "olympus capítulo sin páginas de imagen");
    }
    return {
      pages,
      number,
      title: h1 || ("Capítulo " + number),
      direction: "vertical",
      prev,
      next,
    };
  } catch (e) {
    netError(e, "Olympus");
  }
}
