import {
  SOURCES, fetchText, netError, toItem, cacheGet, cacheSet, cacheKey, TTL,
} from "./env.js";

// Adaptador LectorFenix (https://lectorfenix.com)
// Expone endpoints SvelteKit __data.json codificados con devalue.

const API_HEADS = { Accept: "application/json, text/plain, */*" };
const MAX_SLUG_LEN = 112;
const fullSlugCache = new Map();
const capsMem = new Map();
const pagesMem = new Map();

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

function encodeLfSlug(rawSlug) {
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

function decodeLfSlug(encSlug) {
  const s = String(encSlug || "").trim();
  return fullSlugCache.get(s) || s;
}

// Decodifica arrays indexados de SvelteKit (__data.json / devalue)
export function decodeDevalue(data) {
  if (!Array.isArray(data) || !data.length) return {};
  const seen = new Map();
  function walk(val) {
    if (typeof val === "number") {
      if (val === -1) return undefined;
      if (val === -2) return NaN;
      if (val === -3) return Infinity;
      if (val === -4) return -Infinity;
      if (val === -5) return -0;
      if (val === -6) return null;
      if (val < 0 || val >= data.length) return undefined;
      if (seen.has(val)) return seen.get(val);
      const raw = data[val];
      if (Array.isArray(raw)) {
        const arr = [];
        seen.set(val, arr);
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i];
          arr.push(typeof item === "number" ? walk(item) : item);
        }
        return arr;
      }
      if (raw && typeof raw === "object") {
        const obj = {};
        seen.set(val, obj);
        const keys = Object.keys(raw);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const v = raw[k];
          obj[k] = typeof v === "number" ? walk(v) : v;
        }
        return obj;
      }
      return raw;
    }
    return val;
  }
  return walk(0);
}

async function fetchSvelteData(url) {
  const { ok, status, text } = await fetchText(url, { heads: API_HEADS });
  if (!ok || !text) return { ok, status, data: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status, data: null };
  }
  const nodes = Array.isArray(parsed && parsed.nodes) ? parsed.nodes : [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n && n.type === "data" && Array.isArray(n.data)) {
      return { ok: true, status, data: decodeDevalue(n.data) };
    }
  }
  return { ok: false, status, data: null };
}

function mapComicRow(src, row) {
  if (!row || typeof row !== "object") return null;
  const rawSlug = String(row.comic_slug || row.slug || "").trim();
  const title = cleanText(row.comic_title || row.title || row.name || rawSlug);
  if (!rawSlug || !title) return null;
  const poster = absUrl(row.comic_cover || row.coverImage || row.urlCover || "", SOURCES[src].host);
  return toItem(src, { slug: encodeLfSlug(rawSlug), title, poster });
}

export async function homeSections(src) {
  const ck = cacheKey("lfHome", src);
  const hit = cacheGet(ck, TTL.home);
  if (hit) return hit;
  try {
    const { ok, status, data } = await fetchSvelteData(join(src, "/__data.json"));
    if (!ok || !data || !data.homeData) {
      throw kino.error("unavailable", "lectorfenix home HTTP " + status);
    }
    const hd = data.homeData;
    const popular = (hd.comics_popular || []).map((r) => mapComicRow(src, r)).filter(Boolean);
    const popularToday = (hd.comics_popular_today || []).map((r) => mapComicRow(src, r)).filter(Boolean);
    const recent = (hd.comics_recent || []).map((r) => mapComicRow(src, r)).filter(Boolean);
    const out = { popular, popularToday, recent };
    cacheSet(ck, out);
    return out;
  } catch (e) {
    netError(e, "LectorFenix");
  }
}

export async function list(src, { page = 1, genre = "", sort = "updated_at", q = "" } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const params = ["page=" + p, "isDesc=true"];
    if (sort) params.push("sort=" + encodeURIComponent(sort));
    if (genre) params.push("genres=" + encodeURIComponent(genre));
    if (q) params.push("q=" + encodeURIComponent(q));
    const url = join(src, "/comics/__data.json?" + params.join("&"));
    const { ok, status, data } = await fetchSvelteData(url);
    if (!ok || !data || !data.results) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "lectorfenix HTTP " + status);
    }
    const r = data.results;
    const items = (r.comics || []).map((c) => mapComicRow(src, c)).filter(Boolean);
    const cur = Number(r.page) || p;
    const totalPages = Number(r.totalPages) || cur;
    return { items, next: cur < totalPages ? String(cur + 1) : null };
  } catch (e) {
    netError(e, "LectorFenix");
  }
}

export async function tops(src, page = 1) {
  return list(src, { page, sort: "views" });
}

export async function latest(src, page = 1) {
  return list(src, { page, sort: "updated_at" });
}

export async function search(src, q, page = 1) {
  const query = String(q || "").trim();
  if (!query) return { items: [], next: null };
  return list(src, { page, sort: "views", q: query });
}

function mapStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "completed" || s === "finalizado") return "Finalizado";
  if (s === "hiatus" || s === "pausado") return "Pausado";
  if (s === "ongoing" || s === "emision") return "En curso";
  return raw ? cleanText(raw) : undefined;
}

function pickChaptersFromComic(src, encSlug, comic) {
  const scans = Array.isArray(comic && comic.comicScans) ? comic.comicScans : [];
  let best = [];
  for (let i = 0; i < scans.length; i++) {
    const chs = Array.isArray(scans[i] && scans[i].chapters) ? scans[i].chapters : [];
    if (chs.length > best.length) best = chs;
  }
  const sorted = best.slice().sort((a, b) => (Number(a.chapterNumber) || 0) - (Number(b.chapterNumber) || 0));
  const out = sorted.map((ch) => {
    const chSlug = String(ch.id);
    const num = ch.chapterNumber != null ? String(ch.chapterNumber) : chSlug;
    const pages = Array.isArray(ch.urlPages) ? ch.urlPages.map((u) => absUrl(u, SOURCES[src].host)).filter(Boolean) : [];
    if (pages.length) {
      pagesMem.set(src + "|" + encSlug + "|" + chSlug, {
        pages,
        number: num,
        title: ch.title ? cleanText(ch.title) : "Capítulo " + num,
      });
      if (pagesMem.size > 1500) pagesMem.delete(pagesMem.keys().next().value);
    }
    return {
      slug: chSlug,
      number: num,
      title: ch.title ? cleanText(ch.title) : "Capítulo " + num,
      pago: false,
    };
  });
  capsMem.set(src + "|" + encSlug, out);
  if (capsMem.size > 200) capsMem.delete(capsMem.keys().next().value);
  return out;
}

export async function detail(src, encSlug) {
  try {
    const slug = decodeLfSlug(encSlug);
    const url = join(src, "/comics/" + encodeURIComponent(slug) + "/__data.json");
    const { ok, status, data } = await fetchSvelteData(url);
    if (!ok || !data || !data.comic) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "lectorfenix detail HTTP " + status);
    }
    const c = data.comic;
    const chList = pickChaptersFromComic(src, encSlug, c);
    const genres = Array.isArray(c.genres)
      ? c.genres.map((g) => cleanText(typeof g === "string" ? g : g && g.name)).filter(Boolean)
      : Array.isArray(c.comicGenres)
        ? c.comicGenres.map((g) => cleanText(g && (g.name || (g.genre && g.genre.name)))).filter(Boolean)
        : [];
    const overview = cleanText(String(c.description || "").replace(/Haz click aqu[ií] para ir a la novela\s*\[[^\]]+\]/gi, ""));
    return {
      slug: encSlug,
      title: cleanText(c.title || c.name || slug),
      overview,
      poster: absUrl(c.coverImage || c.urlCover || "", SOURCES[src].host),
      genres,
      statusName: mapStatus(c.status),
      demographyName: c.type ? cleanText(c.type.charAt(0).toUpperCase() + c.type.slice(1)) : "Manga · Manhwa",
      score: undefined,
      totalChapters: chList.length || undefined,
      adult: Boolean(c.isNsfw || c.isHentai),
    };
  } catch (e) {
    netError(e, "LectorFenix");
  }
}

export async function chapters(src, encSlug, { page = 1, order = "asc" } = {}) {
  try {
    const key = src + "|" + encSlug;
    let all = capsMem.get(key);
    if (!all || !all.length) {
      await detail(src, encSlug);
      all = capsMem.get(key) || [];
    }
    const ordered = order === "desc" ? all.slice().reverse() : all;
    const per = 40;
    const p = Math.max(1, Number(page) || 1);
    const start = (p - 1) * per;
    const items = ordered.slice(start, start + per);
    const next = start + per < ordered.length ? String(p + 1) : null;
    return { items, next };
  } catch (e) {
    netError(e, "LectorFenix");
  }
}

export async function chapter(src, encSlug, chSlug) {
  try {
    const slug = decodeLfSlug(encSlug);
    const key = src + "|" + encSlug;
    const mem = pagesMem.get(key + "|" + String(chSlug));
    const listCh = capsMem.get(key) || [];
    const idx = listCh.findIndex((c) => String(c.slug) === String(chSlug));
    if (mem && mem.pages.length && idx >= 0) {
      return {
        pages: mem.pages,
        number: mem.number,
        title: mem.title,
        direction: "vertical",
        prev: idx > 0 ? listCh[idx - 1].slug : null,
        next: idx >= 0 && idx < listCh.length - 1 ? listCh[idx + 1].slug : null,
      };
    }

    const url = join(src, "/comics/" + encodeURIComponent(slug) + "/chapters/" + encodeURIComponent(String(chSlug)) + "/__data.json");
    const { ok, status, data } = await fetchSvelteData(url);
    if (!ok || !data || !data.chapter) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "lectorfenix chapter HTTP " + status);
    }
    const ch = data.chapter;
    const rawPages = ch.url_pages || ch.urlPages || [];
    const pages = rawPages.map((u) => absUrl(u, SOURCES[src].base)).filter(Boolean);
    if (!pages.length) {
      throw kino.error("unavailable", "lectorfenix capítulo sin páginas");
    }
    const num = ch.chapter_number != null ? String(ch.chapter_number) : String(chSlug);
    return {
      pages,
      number: num,
      title: ch.title ? cleanText(ch.title) : "Capítulo " + num,
      direction: "vertical",
      prev: ch.prev_chapter_id != null ? String(ch.prev_chapter_id) : (idx > 0 ? listCh[idx - 1].slug : null),
      next: ch.next_chapter_id != null ? String(ch.next_chapter_id) : (idx >= 0 && idx < listCh.length - 1 ? listCh[idx + 1].slug : null),
    };
  } catch (e) {
    netError(e, "LectorFenix");
  }
}
