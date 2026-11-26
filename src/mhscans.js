import {
  SOURCES, fetchText, netError, toItem, PAGO_TEXT_RE, cacheGet, cacheSet, cacheKey, TTL,
} from "./env.js";

// Adaptador MHScans (https://mhscans.com) — fuente mixta (cómics + novelas).
// Expone Astro SSR (/library, /comics/<slug>, /comics/<slug>/chapters?page=N&asc=1, /leer/<id>).

const MAX_SLUG_LEN = 112;
const fullSlugCache = new Map();

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

function encodeMcSlug(rawSlug) {
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

function decodeMcSlug(encSlug) {
  const s = String(encSlug || "").trim();
  return fullSlugCache.get(s) || s;
}

function parseLibraryCards(src, html, page) {
  const base = SOURCES[src].host;
  const srcHtml = String(html || "");
  const mainMatch = /<main\b[\s\S]*?<\/main>/i.exec(srcHtml);
  const scope = mainMatch ? mainMatch[0] : srcHtml;
  const items = [];
  const seen = new Set();

  const anchorRe = /<a\b([^>]*href=["'](?:https?:\/\/[^"']+)?\/comics\/([^"'?#\/]+)\/?["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(scope)) !== null) {
    const attrs = m[1];
    const rawSlug = decodeURIComponent(m[2]);
    if (!rawSlug || seen.has(rawSlug)) continue;
    const inner = m[3];
    const imgMatch = /<img\b[^>]*\b(?:data-src|src)=["']([^"']+)["'][^>]*>/i.exec(inner);
    const titleTagMatch = /<(?:h2|h3|h4)\b[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>/i.exec(inner);
    const altMatch = /\balt=["']([^"']+)["']/i.exec(imgMatch ? imgMatch[0] : "");
    const titleAttrMatch = /\btitle=["']([^"']+)["']/i.exec(attrs);
    const title = cleanText(
      (titleTagMatch && titleTagMatch[1]) ||
      (titleAttrMatch && titleAttrMatch[1]) ||
      (altMatch && altMatch[1]) ||
      inner.replace(/<[^>]+>/g, " ")
    );
    if (!title) continue;
    seen.add(rawSlug);
    const posterRaw = imgMatch ? decodeHtml(imgMatch[1]) : "";
    const poster = posterRaw && !/site\/logos|avatar/i.test(posterRaw) ? absUrl(posterRaw, base) : "";
    const item = toItem(src, { slug: encodeMcSlug(rawSlug), title, poster });
    if (item) items.push(item);
  }

  // Detectar si existe una página posterior en la paginación (/library?...page=N)
  const cur = Math.max(1, Number(page) || 1);
  let maxPage = cur;
  const pageRe = /[?&]page=(\d+)/gi;
  let pm;
  while ((pm = pageRe.exec(scope)) !== null) {
    const n = Number(pm[1]);
    if (Number.isFinite(n) && n > maxPage) maxPage = n;
  }
  return { items, next: maxPage > cur ? String(cur + 1) : null };
}

export async function list(src, { page = 1, sort = "updated", genre = "", type = "", status = "", q = "" } = {}) {
  try {
    const p = Math.max(1, Number(page) || 1);
    const params = ["page=" + p];
    if (sort) params.push("sort=" + encodeURIComponent(sort));
    if (genre) params.push("genre=" + encodeURIComponent(genre));
    if (type) params.push("type=" + encodeURIComponent(type));
    if (status) params.push("status=" + encodeURIComponent(status));
    if (q) params.push("q=" + encodeURIComponent(q));
    const url = join(src, "/library?" + params.join("&"));
    const { ok, status: st, text } = await fetchText(url);
    if (!ok || !text) {
      throw kino.error(st === 404 ? "not_found" : "unavailable", "mhscans HTTP " + st);
    }
    return parseLibraryCards(src, text, p);
  } catch (e) {
    netError(e, "MHScans");
  }
}

export async function tops(src, page = 1) {
  return list(src, { page, sort: "views" });
}

export async function latest(src, page = 1) {
  return list(src, { page, sort: "updated" });
}

export async function search(src, q, page = 1) {
  const query = String(q || "").trim();
  if (!query) return { items: [], next: null };
  return list(src, { page, q: query });
}

function parseChapterLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["'](?:https?:\/\/[^"']+)?\/leer\/([A-Za-z0-9._~-]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const chId = m[1];
    if (!chId || seen.has(chId)) continue;
    const rawText = cleanText(m[2]);
    if (!rawText || /^comenzar\s+lectura$/i.test(rawText) || /^continuar/i.test(rawText)) continue;
    seen.add(chId);
    const cleaned = rawText
      .replace(/\bHace\s+[\w\s]+?(?:minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|a[ñn]os?)\b/gi, "")
      .replace(/\bGRATIS\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const numMatch = /(?:cap[ií]tulo|cap\.?)\s*(\d+(?:\.\d+)?)/i.exec(cleaned) || /(\d+(?:\.\d+)?)/.exec(cleaned);
    const num = numMatch ? numMatch[1] : String(out.length + 1);
    const pago = PAGO_TEXT_RE.test(cleaned);
    out.push({
      slug: chId,
      number: num,
      title: cleaned || ("Capítulo " + num),
      pago,
    });
  }
  return out;
}

export async function detail(src, encSlug) {
  const rawSlug = decodeMcSlug(encSlug);
  const ck = cacheKey("mcDet", rawSlug);
  const hit = cacheGet(ck, TTL.detail);
  if (hit) return hit;

  try {
    const base = SOURCES[src].host;
    const { ok, status, text } = await fetchText(join(src, "/comics/" + encodeURIComponent(rawSlug)));
    if (!ok || !text) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "mhscans HTTP " + status);
    }

    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    const title = cleanText((h1 && h1[1]) || (titleTag && titleTag[1].split("|")[0]) || rawSlug);

    let poster = "";
    const coverMatch = /<img\b[^>]*\bsrc=["']([^"']*\/uploads\/covers\/[^"']+)["'][^>]*>/i.exec(text);
    if (coverMatch) poster = absUrl(decodeHtml(coverMatch[1]), base);

    const paragraphs = [];
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = pRe.exec(text)) !== null) {
      const pTxt = cleanText(pm[1]);
      if (!pTxt || pTxt.length < 30) continue;
      if (/avisos del autor|iniciar sesi[oó]n|derechos reservados/i.test(pTxt)) continue;
      paragraphs.push(pTxt);
      if (paragraphs.length >= 2) break;
    }
    const overview = paragraphs.join("\n\n").slice(0, 1800) || undefined;

    const genres = [];
    const gRe = /href=["'][^"']*\/library\?genre=[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
    let gm;
    while ((gm = gRe.exec(text)) !== null) {
      const gName = cleanText(gm[1]);
      if (gName && genres.indexOf(gName) < 0) genres.push(gName);
      if (genres.length >= 10) break;
    }

    let statusName;
    if (/\bFinalizado\b|\bCompletad[oa]\b/i.test(text)) statusName = "Finalizado";
    else if (/\bEn pausa\b|\bHiatus\b/i.test(text)) statusName = "Pausado";
    else if (/\bEn emisi[oó]n\b|\bEn curso\b/i.test(text)) statusName = "En curso";

    let totalChapters;
    const countMatch = /data-cl-count=["'](\d+)["']/i.exec(text);
    if (countMatch) totalChapters = Number(countMatch[1]);

    const res = {
      slug: encSlug,
      title,
      overview,
      poster,
      genres,
      statusName,
      totalChapters,
    };
    cacheSet(ck, res);
    return res;
  } catch (e) {
    netError(e, "MHScans");
  }
}

export async function chapters(src, encSlug, { page = 1, order = "asc" } = {}) {
  try {
    const rawSlug = decodeMcSlug(encSlug);
    const p = Math.max(1, Number(page) || 1);
    const ascParam = order === "desc" ? "" : "&asc=1";
    const apiUrl = join(src, "/comics/" + encodeURIComponent(rawSlug) + "/chapters?page=" + p + ascParam);
    const res = await fetchText(apiUrl);
    if (res.ok && res.text) {
      const items = parseChapterLinks(res.text);
      const totalPages = Number(res.headers["x-pages"] || res.headers["X-Pages"] || 1);
      if (items.length) {
        return {
          items,
          next: p < totalPages ? String(p + 1) : null,
          total: Number(res.headers["x-total"] || res.headers["X-Total"]) || undefined,
        };
      }
    }
    // Respaldo: extraer los enlaces /leer/ desde el HTML del detalle
    const det = await fetchText(join(src, "/comics/" + encodeURIComponent(rawSlug)));
    if (!det.ok || !det.text) {
      throw kino.error(det.status === 404 ? "not_found" : "unavailable", "mhscans HTTP " + det.status);
    }
    let items = parseChapterLinks(det.text);
    if (order !== "desc") items = items.slice().reverse();
    return { items, next: null };
  } catch (e) {
    netError(e, "MHScans");
  }
}

export async function chapter(src, _encSlug, chId) {
  try {
    const base = SOURCES[src].host;
    const { ok, status, text } = await fetchText(join(src, "/leer/" + encodeURIComponent(String(chId))));
    if (!ok || !text) {
      throw kino.error(status === 404 ? "not_found" : "unavailable", "mhscans HTTP " + status);
    }

    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    const rawTitle = cleanText(titleTag ? titleTag[1].replace(/discord$/i, "") : "");
    const numMatch = /Cap\.?\s*(\d+(?:\.\d+)?)/i.exec(rawTitle);
    const number = numMatch ? numMatch[1] : "";
    const title = rawTitle || ("Capítulo " + (number || chId));

    // Páginas de cómic (/uploads/pages/..., /wp-content/uploads/WP-manga/data/... o class="page-img")
    const pages = [];
    const seen = new Set();
    const imgTagRe = /<img\b[^>]*>/gi;
    let im;
    while ((im = imgTagRe.exec(text)) !== null) {
      const tag = im[0];
      const dataSrc = /\bdata-src=["']([^"']+)["']/i.exec(tag);
      const srcAttr = /\bsrc=["']([^"']+)["']/i.exec(tag);
      const rawUrl = (dataSrc && dataSrc[1]) || (srcAttr && srcAttr[1]) || "";
      if (!rawUrl || /^data:/i.test(rawUrl)) continue;
      if (/\/uploads\/(?:site|logos|avatars|covers)\//i.test(rawUrl)) continue;
      const isReaderImg =
        /\/uploads\/pages\//i.test(rawUrl) ||
        /\/wp-content\/uploads\/WP-manga\/data\//i.test(rawUrl) ||
        /\bpage-img\b/i.test(tag);
      if (!isReaderImg) continue;
      const url = absUrl(decodeHtml(rawUrl), base);
      if (url && !seen.has(url)) {
        seen.add(url);
        pages.push(url);
      }
    }

    // Contenido de novela (<div class="novel-content">...</div>) como array de párrafos
    let novelLines = [];
    if (!pages.length) {
      const ncStart = /<div\b[^>]*class=["'][^"']*novel-content[^"']*["'][^>]*>/i.exec(text);
      if (ncStart) {
        const after = text.slice(ncStart.index + ncStart[0].length);
        const endMark = after.search(/<\/div>\s*(?:<\/footer>|<footer|<script|<div\b[^>]*class=["'][^"']*nav|<section)/i);
        const chunk = endMark > 0 ? after.slice(0, endMark) : after.slice(0, 80000);
        novelLines = chunk
          .replace(/<(?:br|hr)\b[^>]*\/?>/gi, "\n")
          .replace(/<\/(?:div|p|h[1-6]|li|blockquote)>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .split(/\n+/)
          .map((line) => decodeHtml(line).replace(/\s+/g, " ").trim())
          .filter((line) => line.length >= 2);
      }
    }

    if (!pages.length && !novelLines.length) {
      throw kino.error("not_found", "Este capítulo no tiene páginas ni texto legibles.");
    }

    // Enlaces anterior / siguiente alrededor del selector de capítulos (deduplicado: hay 2 selects) o bar-nav
    let prev = null;
    let next = null;
    const optList = [];
    const optNums = [];
    const seenOpts = new Set();
    const optRe = /<option\b[^>]*value=["'](?:\/leer\/)?([A-Za-z0-9._~-]+)["']([^>]*)>([\s\S]*?)<\/option>/gi;
    let om;
    let curIdx = -1;
    while ((om = optRe.exec(text)) !== null) {
      const id = om[1];
      if (!id || seenOpts.has(id)) continue;
      seenOpts.add(id);
      if (/\bselected\b/i.test(om[2]) || id === chId) curIdx = optList.length;
      optList.push(id);
      const nm = /(\d+(?:\.\d+)?)/.exec(om[3]);
      optNums.push(nm ? Number(nm[1]) : NaN);
    }
    if (curIdx >= 0 && optList.length > 1) {
      const firstN = optNums[0];
      const lastN = optNums[optNums.length - 1];
      const isDesc = Number.isFinite(firstN) && Number.isFinite(lastN) ? firstN > lastN : true;
      if (isDesc) {
        prev = optList[curIdx + 1] || null;
        next = optList[curIdx - 1] || null;
      } else {
        prev = optList[curIdx - 1] || null;
        next = optList[curIdx + 1] || null;
      }
    }
    // Sobreescribir con botones explícitos Anterior / Siguiente si existen en el HTML
    const navRe = /<a\b[^>]*href=["'](?:https?:\/\/[^"']+)?\/leer\/([A-Za-z0-9._~-]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
    let nm;
    while ((nm = navRe.exec(text)) !== null) {
      const lbl = cleanText(nm[2]);
      if (/^anterior$/i.test(lbl) || /cap\.\s*anterior/i.test(lbl)) prev = nm[1];
      else if (/^siguiente$/i.test(lbl) || /cap\.\s*siguiente/i.test(lbl)) next = nm[1];
    }
    if (prev === chId) prev = null;
    if (next === chId) next = null;

    if (novelLines.length && !pages.length) {
      return {
        slug: chId,
        number,
        title,
        pages: [],
        text: novelLines,
        imgs: [],
        direction: "ttb",
        prev,
        next,
      };
    }

    return {
      slug: chId,
      number,
      title,
      pages,
      direction: "ttb",
      prev,
      next,
    };
  } catch (e) {
    netError(e, "MHScans");
  }
}
