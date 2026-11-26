// leercapitulo.js — Adaptador para LeerCapitulo (www.leercapitulo.co).
// Usa /search/?q= JSON para búsqueda instantánea y HTML SSR para catálogo, fichas y lector.
// El slug se codifica como "<shortId>.<slugRecortado>" (<= 112 chars) para respetar el tope ID_RE
// de 120 chars; si un slug se recorta, leercapitulo.co redirige (301) por shortId automáticamente.

import { fetchJson, fetchText, join, netError, toItem, cacheKey, cacheGet, cacheSet, TTL } from "./env.js";

export const LC_GENRES = {
  action: "Acción",
  adventure: "Aventura",
  comedy: "Comedia",
  drama: "Drama",
  fantasy: "Fantasía",
  historical: "Histórico",
  horror: "Horror",
  isekai: "Isekai",
  mystery: "Misterio",
  psychological: "Psicológico",
  romance: "Romance",
  "sci-fi": "Ciencia Ficción",
  seinen: "Seinen",
  shoujo: "Shoujo",
  shounen: "Shounen",
  "slice-of-life": "Recuentos",
  sports: "Deportes",
  tragedy: "Tragedia",
  wuxia: "Wuxia",
  ecchi: "Ecchi",
};

const fullSlugMem = new Map();
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
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(src, u) {
  const s = String(u || "").trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  return join(src, s);
}

export function encodeLcSlug(shortId, slugPart) {
  const id = String(shortId || "").replace(/[^A-Za-z0-9_-]/g, "");
  const tail = String(slugPart || "m").replace(/[^A-Za-z0-9._~-]/g, "-");
  if (id && tail) fullSlugMem.set(id, tail);
  const full = id + "." + tail;
  return full.length <= 112 ? full : full.slice(0, 112).replace(/[-.]+$/, "") || id;
}

export function decodeLcSlug(encSlug) {
  const raw = String(encSlug || "");
  const dot = raw.indexOf(".");
  if (dot < 0) return { shortId: raw, tail: fullSlugMem.get(raw) || "m" };
  const shortId = raw.slice(0, dot);
  const tail = fullSlugMem.get(shortId) || raw.slice(dot + 1) || "m";
  return { shortId, tail };
}

function extractLcCards(src, html) {
  const items = [];
  const seen = new Set();
  const blocks = String(html || "").split(/<article\b[^>]*class=["'][^"']*lc-card/i).slice(1);
  for (const blk of blocks) {
    const endIdx = blk.indexOf("</article>");
    const slice = endIdx >= 0 ? blk.slice(0, endIdx) : blk.slice(0, 1800);
    const linkM = /href=["'](?:https?:\/\/[^/]+)?\/manga\/([A-Za-z0-9_-]+)\/([^/"'?#]+)\/?["']/i.exec(slice);
    if (!linkM) continue;
    const shortId = linkM[1];
    const slugPart = linkM[2];
    if (seen.has(shortId)) continue;
    seen.add(shortId);

    const imgM = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(slice);
    const nameM = /<a[^>]*class=["'][^"']*lc-card-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(slice)
      || /<img[^>]*alt=["']([^"']+)["']/i.exec(slice);
    const title = cleanText((nameM && nameM[1]) || slugPart.replace(/-/g, " "));
    const card = toItem(src, {
      slug: encodeLcSlug(shortId, slugPart),
      title: title || slugPart,
      poster: imgM ? absUrl(src, imgM[1]) : undefined,
    });
    if (card) items.push(card);
  }
  return items;
}

function extractHomeSection(html, headingRegex) {
  const m = headingRegex.exec(html);
  if (!m) return "";
  const rest = html.slice(m.index + m[0].length);
  const nextSection = rest.search(/<section\b|<footer\b/i);
  return nextSection >= 0 ? rest.slice(0, nextSection) : rest.slice(0, 25000);
}

export async function homeSections(src) {
  try {
    const { ok, status, text } = await fetchText(join(src, "/"));
    if (!ok || !text) throw kino.error("unavailable", "leercapitulo home HTTP " + status);
    const tendHtml = extractHomeSection(text, /<h[23][^>]*>\s*Tendencias\s*<\/h[23]>/i);
    const popHtml = extractHomeSection(text, /<h[23][^>]*>\s*Populares\s*<\/h[23]>/i);
    const ultHtml = extractHomeSection(text, /<h[23][^>]*>\s*Ultimos mangas\s*<\/h[23]>/i);
    return {
      trending: extractLcCards(src, tendHtml),
      popular: extractLcCards(src, popHtml),
      latest: extractLcCards(src, ultHtml),
    };
  } catch (e) {
    netError(e, "LeerCapitulo");
  }
}

export async function list(src, { page = 1, genre, estado, type, sort } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const qs = ["page=" + p];
    if (genre) qs.push("genre=" + encodeURIComponent(String(genre)));
    if (estado) qs.push("status=" + encodeURIComponent(String(estado)));
    if (type) qs.push("type=" + encodeURIComponent(String(type)));
    if (sort) qs.push("sort=" + encodeURIComponent(String(sort)));

    const { ok, status, text } = await fetchText(join(src, "/manga/?" + qs.join("&")));
    if (!ok || !text) throw kino.error(status === 404 ? "not_found" : "unavailable", "leercapitulo HTTP " + status);

    const items = extractLcCards(src, text);
    const nextMatch = new RegExp("page=" + (p + 1) + "\\b", "i").test(text);
    return { items, next: nextMatch && items.length ? String(p + 1) : null };
  } catch (e) {
    netError(e, "LeerCapitulo");
  }
}

export async function tops(src) {
  const hs = await homeSections(src);
  const items = hs.popular.length ? hs.popular : hs.trending;
  if (items.length) return { items, next: null };
  return list(src, { page: 1 });
}

export async function latest(src) {
  const hs = await homeSections(src);
  const items = hs.latest.length ? hs.latest : hs.trending;
  if (items.length) return { items, next: "2" };
  return list(src, { page: 1 });
}

export async function search(src, q) {
  try {
    const query = String((q && (q.q || q)) || "").trim();
    if (!query) return { items: [], next: null };
    const { ok, status, body } = await fetchJson(join(src, "/search/?q=" + encodeURIComponent(query)), {
      heads: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: join(src, "/"),
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
    });
    if (!ok || !Array.isArray(body)) {
      throw kino.error("unavailable", "leercapitulo search HTTP " + status);
    }
    const items = [];
    for (const row of body) {
      if (!row || !row.uri) continue;
      const m = /\/manga\/([A-Za-z0-9_-]+)\/([^/"'?#]+)/i.exec(row.uri);
      if (!m) continue;
      const card = toItem(src, {
        slug: encodeLcSlug(m[1], m[2]),
        title: cleanText(row.name || m[2].replace(/-/g, " ")),
        poster: absUrl(src, row.cover_uri),
      });
      if (card) items.push(card);
    }
    return { items: items.slice(0, 40), next: null };
  } catch (e) {
    netError(e, "LeerCapitulo");
  }
}

function parseDetailChapters(html) {
  const raw = [];
  const seen = new Set();
  const re = /<a[^>]+href=["'](?:https?:\/\/[^/]+)?\/leer\/([A-Za-z0-9_-]+)\/[^/"'?#]+\/([^/"'?#]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const chSlug = decodeURIComponent(m[2]);
    if (seen.has(chSlug)) continue;
    seen.add(chSlug);
    const labelHtml = m[3];
    const nSpan = /<span[^>]*class=["'][^"']*\bn\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(labelHtml);
    const rawLabel = cleanText((nSpan && nSpan[1]) || labelHtml);
    const numMatch = /(\d+(?:\.\d+)?)/.exec(chSlug) || /(\d+(?:\.\d+)?)/.exec(rawLabel);
    const num = numMatch ? Number(numMatch[1]) : NaN;
    raw.push({
      slug: chSlug,
      number: Number.isFinite(num) ? String(num) : chSlug,
      title: rawLabel || ("Capítulo " + chSlug),
      pago: false,
    });
  }
  raw.sort((a, b) => {
    const na = Number(a.number), nb = Number(b.number);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return 0;
  });
  return raw;
}

export async function detail(src, encSlug) {
  try {
    const { shortId, tail } = decodeLcSlug(encSlug);
    const { ok, status, text } = await fetchText(join(src, "/manga/" + encodeURIComponent(shortId) + "/" + encodeURIComponent(tail) + "/"));
    if (!ok || !text) throw kino.error(status === 404 ? "not_found" : "unavailable", "leercapitulo detail HTTP " + status);

    const h1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text) || [])[1] || tail.replace(/-/g, " "));
    const coverM = /<img[^>]+src=["']([^"']*\/covers\/[^"']+)["']/i.exec(text);
    const synM = /<p[^>]*id=["']example2["'][^>]*>([\s\S]*?)<\/p>/i.exec(text)
      || /Sinopsis[\s\S]{0,160}<p[^>]*>([\s\S]*?)<\/p>/i.exec(text)
      || /<div[^>]*class=["'][^"']*summary[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(text);
    const statusM = /<span[^>]*class=["']k["'][^>]*>\s*Estado\s*<\/span>[\s\S]{0,120}?<a[^>]*>([\s\S]*?)<\/a>/i.exec(text);
    const typeM = /<span[^>]*class=["']k["'][^>]*>\s*Tipo\s*<\/span>[\s\S]{0,120}?<a[^>]*>([\s\S]*?)<\/a>/i.exec(text);
    const genres = [];
    const gRe = /<a[^>]+href=["'][^"']*\?genre=[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
    let gm;
    while ((gm = gRe.exec(text)) !== null) {
      const g = cleanText(gm[1]);
      if (g && !genres.includes(g)) genres.push(g);
    }

    const allChs = parseDetailChapters(text);
    if (allChs.length) {
      capsMem.set(src + "|" + encSlug, allChs);
    }
    return {
      slug: encSlug,
      title: h1,
      overview: synM ? cleanText(synM[1]) : "",
      poster: coverM ? absUrl(src, coverM[1]) : undefined,
      genres,
      statusName: statusM ? cleanText(statusM[1]) : undefined,
      demographyName: typeM ? cleanText(typeM[1]) : "Manga · Manhwa",
      score: undefined,
      totalChapters: allChs.length || undefined,
      adult: false,
    };
  } catch (e) {
    netError(e, "LeerCapitulo");
  }
}

export async function chapters(src, encSlug, { page = 1, postsPerPage = 50, order = "asc" } = {}) {
  try {
    let all = capsMem.get(src + "|" + encSlug);
    if (!all) {
      await detail(src, encSlug);
      all = capsMem.get(src + "|" + encSlug) || [];
    }
    const ordered = order === "desc" ? all.slice().reverse() : all;
    const p = Math.max(1, Number(page) || 1);
    const per = Math.max(10, Number(postsPerPage) || 50);
    const start = (p - 1) * per;
    const slice = ordered.slice(start, start + per);
    return { items: slice, next: start + per < ordered.length ? String(p + 1) : null };
  } catch (e) {
    netError(e, "LeerCapitulo");
  }
}

function parseChapterSelectNeighbors(html, chSlug) {
  const selM = /<select[^>]*id=["']chapterSelect["'][^>]*>([\s\S]*?)<\/select>/i.exec(html);
  if (!selM) return { prev: null, next: null };
  const list = [];
  const optRe = /<option[^>]+value=["'][^"']*\/leer\/[^/]+\/[^/]+\/([^/"'?#]+)\/?["'][^>]*>/gi;
  let m;
  while ((m = optRe.exec(selM[1])) !== null) {
    const val = decodeURIComponent(m[1]);
    if (!list.includes(val)) list.push(val);
  }
  // El select en LeerCapitulo viene descendente (último capítulo primero) -> invertimos a ascendente
  const asc = list.slice().reverse();
  const idx = asc.indexOf(String(chSlug));
  return {
    prev: idx > 0 ? asc[idx - 1] : null,
    next: idx >= 0 && idx < asc.length - 1 ? asc[idx + 1] : null,
  };
}

export async function chapter(src, encSlug, chSlug) {
  try {
    const { shortId, tail } = decodeLcSlug(encSlug);
    const url = join(src, "/leer/" + encodeURIComponent(shortId) + "/" + encodeURIComponent(tail) + "/" + encodeURIComponent(String(chSlug)) + "/");
    const { ok, status, text } = await fetchText(url);
    if (!ok || !text) throw kino.error(status === 404 ? "not_found" : "unavailable", "leercapitulo chapter HTTP " + status);

    const pages = [];
    const seen = new Set();
    const imgTagRe = /<img\b[^>]*>/gi;
    let tm;
    while ((tm = imgTagRe.exec(text)) !== null) {
      const tag = tm[0];
      const dsM = /\bdata-src=["']([^"']+)["']/i.exec(tag);
      const srcM = /\bsrc=["']([^"']+)["']/i.exec(tag);
      const rawUrl = (dsM && dsM[1]) || (srcM && srcM[1]) || "";
      if (!/^https?:\/\/[^"']+\.(?:webp|jpe?g|png|avif)(?:\?[^"']*)?$/i.test(rawUrl)) continue;
      if (/\/covers\/|logo|avatar|favicon|discord|banner|ads|spinner|loading/i.test(rawUrl)) continue;
      if (seen.has(rawUrl)) continue;
      seen.add(rawUrl);
      pages.push(rawUrl);
    }
    if (!pages.length) {
      throw kino.error("unavailable", "leercapitulo capítulo sin imágenes");
    }

    let { prev, next } = parseChapterSelectNeighbors(text, chSlug);
    if (!prev && !next) {
      const cached = capsMem.get(src + "|" + encSlug) || [];
      const idx = cached.findIndex((c) => c.slug === String(chSlug));
      if (idx >= 0) {
        prev = idx > 0 ? cached[idx - 1].slug : null;
        next = idx < cached.length - 1 ? cached[idx + 1].slug : null;
      }
    }
    const numMatch = /(\d+(?:\.\d+)?)/.exec(String(chSlug));
    const number = numMatch ? String(numMatch[1]) : String(chSlug);
    const h1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text) || [])[1] || "");

    return {
      pages,
      number,
      title: h1 || ("Capítulo " + number),
      direction: "vertical",
      prev,
      next,
    };
  } catch (e) {
    netError(e, "LeerCapitulo");
  }
}
