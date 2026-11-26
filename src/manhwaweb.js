import {
  SOURCES, fetchJson, netError, toItem, cacheGet, cacheSet, cacheKey, TTL,
} from "./env.js";

// Adaptador ManhwaWeb (https://manhwaweb.com · API https://api.manhwaweb.com).
// Nota: las imágenes en img1mw.xyz/img2mw.xyz/uploads.manhwaweb.com requieren Referer https://manhwaweb.com/.

const API = "https://api.manhwaweb.com";
const API_HEADS = { Accept: "application/json, text/plain, */*" };
const MAX_SLUG_LEN = 112;
const fullSlugCache = new Map();
const capsMem = new Map();
const pagesMem = new Map();

function absUrl(raw, base) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return "https:" + s;
  return base + (s.startsWith("/") ? s : "/" + s);
}

function cleanText(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function encodeMwSlug(rawSlug) {
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

function decodeMwSlug(encSlug) {
  const s = String(encSlug || "").trim();
  return fullSlugCache.get(s) || s;
}

function mapRow(src, row) {
  if (!row || typeof row !== "object") return null;
  const rawSlug = String(row.real_id || row._id || row.id_rel || row.id_manhwa || "").trim();
  const title = cleanText(row.name_esp || row.the_real_name || row.name_manhwa || row._name || rawSlug);
  if (!rawSlug || !title) return null;
  const poster = absUrl(row._imagen || row.img || "", SOURCES[src].host);
  return toItem(src, {
    slug: encodeMwSlug(rawSlug),
    title,
    poster,
    adult: row._erotico === "si" ? true : undefined,
  });
}

function dedupeItems(list) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || seen.has(it.ref)) continue;
    seen.add(it.ref);
    out.push(it);
  }
  return out;
}

export async function homeSections(src) {
  const ck = cacheKey("mwHome", src);
  const hit = cacheGet(ck, TTL.home);
  if (hit) return hit;

  try {
    const [latRes, popRes, newRes] = await Promise.allSettled([
      fetchJson(API + "/latest/new-manhwa", { heads: API_HEADS }),
      fetchJson(API + "/manhwa/library?order_item=popularidad&order_dir=desc&page=0", { heads: API_HEADS }),
      fetchJson(API + "/manhwa/nuevos", { heads: API_HEADS }),
    ]);

    const latestRaw = latRes.status === "fulfilled" && latRes.value.ok
      ? (((latRes.value.body || {}).manhwas || {})._manhwas || [])
      : [];
    const popRaw = popRes.status === "fulfilled" && popRes.value.ok
      ? ((popRes.value.body || {}).data || [])
      : [];
    const newRaw = newRes.status === "fulfilled" && newRes.value.ok
      ? ((newRes.value.body || {}).utimos_mangas_creados || [])
      : [];

    const recent = dedupeItems(latestRaw.map((r) => mapRow(src, r)).filter(Boolean));
    const popular = dedupeItems(popRaw.map((r) => mapRow(src, r)).filter(Boolean));
    const fresh = dedupeItems(newRaw.map((r) => mapRow(src, r)).filter(Boolean));

    if (!recent.length && !popular.length && !fresh.length) {
      throw kino.error("unavailable", "manhwaweb sin datos");
    }
    const out = { recent, popular, fresh };
    cacheSet(ck, out);
    return out;
  } catch (e) {
    netError(e, "ManhwaWeb");
  }
}

export async function list(src, { page = 1, orderItem = "popularidad", orderDir = "desc", genre = "", tipo = "", estado = "", q = "" } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const p0 = p - 1;
    const qs = [
      "buscar=" + encodeURIComponent(q || ""),
      "estado=" + encodeURIComponent(estado || ""),
      "tipo=" + encodeURIComponent(tipo || ""),
      "erotico=",
      "demografia=",
      "order_item=" + encodeURIComponent(orderItem || "popularidad"),
      "order_dir=" + encodeURIComponent(orderDir || "desc"),
      "page=" + p0,
      "generes=" + encodeURIComponent(genre || ""),
    ].join("&");
    const { ok, status, body } = await fetchJson(API + "/manhwa/library?" + qs, { heads: API_HEADS });
    if (!ok || !body || !Array.isArray(body.data)) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "manhwaweb HTTP " + status);
    }
    const items = dedupeItems(body.data.map((r) => mapRow(src, r)).filter(Boolean));
    return { items, next: body.next ? String(p + 1) : null };
  } catch (e) {
    netError(e, "ManhwaWeb");
  }
}

export async function tops(src, page = 1) {
  return list(src, { page, orderItem: "popularidad", orderDir: "desc" });
}

export async function latest(src, page = 1) {
  const p = Math.max(1, Number(page) || 1);
  if (p === 1) {
    try {
      const hs = await homeSections(src);
      if (hs.recent && hs.recent.length) return { items: hs.recent, next: "2" };
    } catch { /* fallback a library por fecha de creación */ }
  }
  return list(src, { page: p, orderItem: "creacion", orderDir: "desc" });
}

export async function search(src, q, page = 1) {
  const query = String(q || "").trim();
  if (!query) return { items: [], next: null };
  return list(src, { page, q: query, orderItem: "popularidad" });
}

function mapStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "finalizado" || s === "completed") return "Finalizado";
  if (s === "pausado" || s === "hiatus") return "Pausado";
  if (s === "publicandose" || s === "ongoing") return "En curso";
  return raw ? cleanText(raw) : undefined;
}

function extractChSlug(ch, rawSeriesSlug) {
  const link = String((ch && ch.link) || "");
  const m = /\/leer\/([A-Za-z0-9._~-]+)/i.exec(link);
  if (m && m[1]) return m[1];
  const ver = Array.isArray(ch && ch.versions) && ch.versions[0] && String(ch.versions[0].link || "");
  const m2 = /\/leer\/([A-Za-z0-9._~-]+)/i.exec(ver);
  if (m2 && m2[1]) return m2[1];
  const n = ch && ch.chapter != null ? String(ch.chapter) : "1";
  return (String(rawSeriesSlug) + "-" + n).replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 112);
}

function cacheComicChapters(src, encSlug, rawSeriesSlug, data) {
  const rawList = Array.isArray(data && data.chapters) && data.chapters.length
    ? data.chapters
    : (Array.isArray(data && data.chapters_esp) ? data.chapters_esp : []);

  const sorted = rawList.slice().sort((a, b) => (Number(a.chapter) || 0) - (Number(b.chapter) || 0));
  const out = sorted.map((ch, idx) => {
    const chSlug = extractChSlug(ch, rawSeriesSlug);
    const num = ch.chapter != null ? String(ch.chapter) : String(idx + 1);
    const imgs = Array.isArray(ch.img) ? ch.img.map((u) => absUrl(u, SOURCES[src].host)).filter(Boolean) : [];
    if (imgs.length) {
      pagesMem.set(src + "|" + encSlug + "|" + chSlug, {
        pages: imgs,
        number: num,
        title: "Capítulo " + num,
      });
      if (pagesMem.size > 1500) pagesMem.delete(pagesMem.keys().next().value);
    }
    return {
      slug: chSlug,
      number: num,
      title: "Capítulo " + num,
      pago: false,
    };
  });
  capsMem.set(src + "|" + encSlug, out);
  if (capsMem.size > 200) capsMem.delete(capsMem.keys().next().value);
  return out;
}

export async function detail(src, encSlug) {
  const rawSlug = decodeMwSlug(encSlug);
  const ck = cacheKey("mwDet", rawSlug);
  const hit = cacheGet(ck, TTL.detail);
  if (hit) return hit;

  try {
    const { ok, status, body } = await fetchJson(API + "/manhwa/see/" + encodeURIComponent(rawSlug), { heads: API_HEADS });
    if (!ok || !body || (!body._id && !body.real_id)) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "manhwaweb HTTP " + status);
    }
    const chs = cacheComicChapters(src, encSlug, rawSlug, body);
    const genres = [];
    if (Array.isArray(body._categoris)) {
      for (const obj of body._categoris) {
        if (obj && typeof obj === "object") {
          for (const k of Object.keys(obj)) {
            const val = cleanText(obj[k]);
            if (val && genres.indexOf(val) < 0) genres.push(val);
          }
        } else if (typeof obj === "string" && obj.trim()) {
          genres.push(obj.trim());
        }
      }
    }
    const res = {
      slug: encSlug,
      title: cleanText(body.name_esp || body.the_real_name || body._name || rawSlug),
      overview: body._sinopsis ? cleanText(body._sinopsis) : undefined,
      poster: absUrl(body._imagen || "", SOURCES[src].host),
      genres: genres.slice(0, 10),
      statusName: mapStatus(body._status),
      demographyName: body._tipo ? cleanText(String(body._tipo)).toUpperCase() : undefined,
      totalChapters: chs.length || Number(body._numero_cap) || undefined,
      adult: body._erotico === "si" ? true : undefined,
    };
    cacheSet(ck, res);
    return res;
  } catch (e) {
    netError(e, "ManhwaWeb");
  }
}

export async function chapters(src, encSlug, { page = 1, postsPerPage = 60, order = "asc" } = {}) {
  try {
    const memKey = src + "|" + encSlug;
    let all = capsMem.get(memKey);
    if (!all) {
      await detail(src, encSlug);
      all = capsMem.get(memKey) || [];
    }
    const ordered = order === "desc" ? all.slice().reverse() : all;
    const p = Math.max(1, Number(page) || 1);
    const per = Math.max(10, Math.min(250, Number(postsPerPage) || 60));
    const start = (p - 1) * per;
    const slice = ordered.slice(start, start + per);
    const next = start + per < ordered.length ? String(p + 1) : null;
    return { items: slice, next, total: ordered.length };
  } catch (e) {
    netError(e, "ManhwaWeb");
  }
}

export async function chapter(src, encSlug, chSlug) {
  try {
    const memKey = src + "|" + encSlug;
    if (!capsMem.has(memKey)) {
      await detail(src, encSlug).catch(() => {});
    }
    const memPage = pagesMem.get(memKey + "|" + chSlug);
    let pages = memPage && memPage.pages ? memPage.pages : [];
    let number = memPage ? memPage.number : "";
    let title = memPage ? memPage.title : "";

    if (!pages.length) {
      const { ok, status, body } = await fetchJson(API + "/chapters/see_new/" + encodeURIComponent(String(chSlug)), { heads: API_HEADS });
      if (!ok || !body || !Array.isArray(body.img) || !body.img.length) {
        throw kino.error(status === 404 ? "not_found" : "unavailable", "manhwaweb chapter HTTP " + status);
      }
      pages = body.img.map((u) => absUrl(u, SOURCES[src].host)).filter(Boolean);
      if (body.chapter != null) number = String(body.chapter);
      title = body.name ? cleanText(body.name) + (number ? " — Cap. " + number : "") : ("Capítulo " + (number || chSlug));
    }

    const listAll = capsMem.get(memKey) || [];
    const idx = listAll.findIndex((c) => c.slug === String(chSlug));
    const prev = idx > 0 ? listAll[idx - 1].slug : null;
    const next = idx >= 0 && idx + 1 < listAll.length ? listAll[idx + 1].slug : null;
    if (!number && idx >= 0) number = listAll[idx].number;
    if (!title) title = "Capítulo " + (number || chSlug);

    return {
      slug: chSlug,
      number: number || "",
      title,
      pages,
      direction: "ttb",
      prev,
      next,
    };
  } catch (e) {
    netError(e, "ManhwaWeb");
  }
}
