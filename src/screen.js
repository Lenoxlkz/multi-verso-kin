// screen.js — la pantalla propia de Multi-verso Kin (apiVersion 14), v2.
//
// Novedades de velocidad y UX:
//  - Caché en kino.storage con lectura síncrona: la portada, el detalle y la búsqueda pintan al instante
//    si ya se vieron antes (los datos se refrescan en paralelo por detrás).
//  - Todo lo cargable en paralelo va en paralelo; los dominios gemelos tienen plazo corto para no frenar.
//  - Salida real en todas partes: el leading es «atrás» (route.pop) o «cerrar» en la portada; Atrás del
//    sistema descarga la ruta apilada.
//  - Barra flotante inferior (Ajustes + Descargas) y botón flotante de búsqueda: al bajar el contenido
//    se ocultan y al subir vuelven.
//  - Descargas de capítulos: botón de descarga a la derecha de cada capítulo, lotes de 5/10/20/30 con
//    selector, cola con progreso en vivo (temporizador) y cuota de 14 MB.
//  - Colores: el tema del plugin (violeta) tiñe las páginas del plugin por defecto; los 8 temas de la app
//    se ponen con un botón en Ajustes.

import { cfChallengeSeen, cfClassify, cfStateFor, cfStatus, cfForget, cfClearChallenge, cfSaveCookies, imgHeads, isCfChallenge, fetchText, timeoutFor, UA, SOURCES, NOVEL_SOURCES, HOME_TABS, parseRef, mangaRef, chapterRef, cacheKey, cacheGet, cacheSet, TTL } from "./env.js";
import * as zt from "./zonatmo.js";
import * as zoA from "./zonatmoorg.js";
import * as ms from "./manhwa.js";
import * as ol from "./olympus.js";
import * as lc from "./leercapitulo.js";
import * as ik from "./ikigai.js";
import * as lf from "./lectorfenix.js";
import * as mc from "./mhscans.js";
import * as mw from "./manhwaweb.js";
import * as nv from "./novels.js";
import { browse, SOURCE_CATALOG, catalogEntryFor, parseBrowseRef } from "./catalog.js";
import { THEMES } from "./themes.js";

// El adaptador de novelas expone la misma interfaz (search/home/detail/chapter) que los de manga.
const nvAd = { search: nv.novelSearch, list: null, latest: null, detail: nv.novelDetail, chapter: nv.novelChapter };
const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : SOURCES[src].kind === "zonatmoorg" ? zoA : SOURCES[src].kind === "manhwa" ? ms : SOURCES[src].kind === "olympus" ? ol : SOURCES[src].kind === "leercapitulo" ? lc : SOURCES[src].kind === "ikigai" ? ik : SOURCES[src].kind === "lectorfenix" ? lf : SOURCES[src].kind === "mhscans" ? mc : SOURCES[src].kind === "manhwaweb" ? mw : nvAd);
const isNovel = (src) => NOVEL_SOURCES.indexOf(src) >= 0;
const isMixed = (src) => SOURCES[src] && (SOURCES[src].kind === "olympus" || SOURCES[src].kind === "ikigai" || SOURCES[src].kind === "mhscans");
const hasProgress = () => typeof kino.progress === "object" && kino.progress && typeof kino.progress.set === "function";

const RPREF_KEY = "rprefs";
const DEFAULT_RPREFS = {
  mangaMode: "auto",       // "auto" | "pages" | "strip"
  mangaDir: "auto",        // "auto" | "rtl" | "ltr"
  mangaFrame: "edge",      // "edge" | "framed"
  novelSurface: "surface", // "surface" | "surfaceVariant" | "primaryContainer"
  novelSize: "h5",         // "p" | "h5" | "h4"
  novelWidth: 24,          // 16 (wide) | 24 (editorial) | 32 (narrow)
  novelGap: 8,             // 4 | 8 | 12
  novelAlign: "start",     // "start" | "justify"
};

function readRPrefs() {
  try {
    const raw = kino.storage.get(RPREF_KEY);
    if (!raw) return { ...DEFAULT_RPREFS };
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? { ...DEFAULT_RPREFS, ...p } : { ...DEFAULT_RPREFS };
  } catch { return { ...DEFAULT_RPREFS }; }
}

function saveRPrefs(patch) {
  const next = { ...readRPrefs(), ...(patch || {}) };
  try { kino.storage.set(RPREF_KEY, JSON.stringify(next)); } catch { /* optativa */ }
  return next;
}

/** Limpia marcas de Markdown en párrafos de novela para que se lean nítidos en Kino. */
function parseNovelParagraph(raw) {
  const s = String(raw || "").replace(/\\([*_~`])/g, "$1").trim();
  if (!s) return null;
  if (/^(\*\s*){3,}$|^(-+\s*){3,}$|^(_\s*){3,}$|^—+$/.test(s)) return { kind: "break" };
  const headingMatch = /^\*\*([^*]{1,120})\*\*$/.exec(s) || /^#{1,4}\s+(.{1,120})$/.exec(s);
  if (headingMatch) return { kind: "heading", text: headingMatch[1].trim() };
  return { kind: "body", text: s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1") };
}


// ---------- utilidades de estado compacto ----------

function card(src, slug, title, poster) {
  return {
    id: (src + "-" + String(slug)).slice(0, 120),
    ref: mangaRef(src, slug),
    title: String(title || slug).slice(0, 180),
    kind: "movie",
    poster: poster || undefined,
    lang: "es",
    open: { screen: { args: { r: mangaRef(src, slug), t: String(title || "").slice(0, 180) } } },
  };
}

function compactCard(it) {
  return { s: it.ref, t: it.title, p: it.poster || undefined };
}

function expandOne(c) {
  const parsed = parseRef(c.s);
  if (!parsed) return null;
  return card(parsed.src, parsed.a, c.t, c.p);
}

function errText(e) {
  const codes = {
    not_found: "No encontré eso en la fuente (puede que se haya movido de sitio).",
    unavailable: "La fuente no respondió: prueba otra vez o cambia de fuente.",
    rate_limited: "La fuente está pidiendo calma: espera unos segundos.",
    invalid_request: "Esa referencia ya no vale: vuelve a buscar el título.",
  };
  const code = e && e.code ? e.code : "";
  if (codes[code]) return codes[code];
  if (e && e.userMessage) return String(e.userMessage);
  return "No se pudo cargar: prueba otra vez.";
}

// ---------- progreso de lectura ----------

const PROG_KEY = "leyendo";
// Base de cada fuente (host del manifest): sonda de desafío CF y ventana visual para resolverlo.
const FUENTES_URL = {
  zt: "https://zonatmo.net", zo: "https://zonatmo.org",
  ms: "https://manhwass.lat", mh: "https://manhwashot.lat",
  ol: "https://olympusxyz.com", lc: "https://www.leercapitulo.co",
  ik: "https://visualikigai.cmpunjabrashancard.pk", lf: "https://lectorfenix.com",
  mc: "https://mhscans.com", mw: "https://manhwaweb.com",
  sk: "https://api.skynovels.net", mk: "https://matchanovels.com",
  as: "https://astralnovelstranslations.wordpress.com",
  an: "https://anslid.com", dv: "https://devilnovels.com",
};

// Claves únicas por apertura del lector: sin esto, Flutter reutiliza el scrollable del
// capítulo anterior (misma clave y tipo) y el nuevo capítulo arranca a media página —
// el bug clásico que el plugin de referencia ZonaTM0 arregló en su v1.2.1 igual.
let navSeq = 0;
// Throttle del guardado por scroll: storage se escribe al cambiar de página, cada 2% de
// avance o cada 4 s; el contenido ya queda guardado por la regla del punto más leído.
let scrSave = { k: "", at: 0, page: 0, frac: 0 };

/** ¿Kino declara el widget «pages» (apiVersion 17+)? En viejos, la tira siempre. */
function pagesDisponible() {
  try {
    return typeof kino === "object" && kino !== null &&
      typeof kino.screen === "object" && kino.screen !== null &&
      Array.isArray(kino.screen.widgets) && kino.screen.widgets.indexOf("pages") >= 0;
  } catch { return false; }
}

function storageProgress() {
  try {
    const raw = kino.storage.get(PROG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveStorageProgress(mr, data) {
  try {
    const all = storageProgress();
    all[mr] = data;
    const keys = Object.keys(all);
    if (keys.length > 60) {
      keys.sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0));
      for (const k of keys.slice(0, keys.length - 60)) delete all[k];
    }
    kino.storage.set(PROG_KEY, JSON.stringify(all));
  } catch { /* lleno: se pierde el respaldo, no la lectura */ }
}

function progId(mr) {
  return String(mr).split("|").join("-").replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 120);
}

function saveProgress(mr, cr, info, page, frac) {
  if (!mr || !cr) return;
  page = Math.max(1, Number(page) || 1);
  frac = Math.max(0, Math.min(1, Number(frac) || 0));
  // «el punto más leído» de ESTE capítulo: la reapertura (guardado inicial en página 1) y el
  // primer onScroll a 0 no borran lo que ya se leyó; avanzar siempre se acepta.
  const prev = storageProgress()[mr];
  if (prev && prev.cr === cr) {
    const p0 = prev.page || 1, f0 = prev.frac || 0;
    if (p0 > page || (p0 === page && f0 > frac)) return;
    page = Math.max(page, p0);
    frac = Math.max(frac, f0);
  }
  const data = { cr, n: info.number || "", page, total: info.total || 0, frac, ts: Date.now() };
  saveStorageProgress(mr, data);
  if (!hasProgress()) return;
  try {
    kino.progress.set({
      id: progId(mr),
      fraction: frac,
      title: info.mTitle || undefined,
      poster: info.mPoster || undefined,
      label: "Cap. " + (info.number || "?"),
      done: frac >= 0.995 || undefined,
      doneAt: frac >= 0.995 ? Date.now() : undefined,
      resume: JSON.stringify({ mr, cr, n: data.n, page }),
    });
  } catch { /* sin permiso: el respaldo sigue */ }
}

async function readProgress(mr) {
  if (hasProgress()) {
    try {
      const entry = await kino.progress.get(mr);
      if (entry && entry.resume) {
        const r = JSON.parse(entry.resume);
        if (r && r.cr) return { cr: r.cr, n: r.n || "", page: r.page || 1 };
      }
      if (entry && entry.done) return null;
    } catch { /* sin permiso */ }
  }
  const all = storageProgress();
  const d = all[mr];
  return d && d.cr ? { cr: d.cr, n: d.n || "", page: d.page || 1 } : null;
}

// ---------- filas del Home, con caché instantánea ----------

function defaultRefFor(src) {
  const cats = SOURCE_CATALOG[src] && SOURCE_CATALOG[src].cats;
  return (cats && cats[0] && cats[0].ref) || (src + ":all");
}

function inferShelfRef(src, row, idx) {
  if (row && row.ref && parseBrowseRef(row.ref)) return row.ref;
  const id = String((row && row.id) || "");
  if (id === src + "-new") return (src === "ms" || src === "mh") ? src + ":latest" : src + ":new";
  if (id === src + "-pop") return src + ":pop";
  if (id === src + "-top") return src + ":score";
  if (id === src + "-emi") return src + ":on-going";
  if (id === src + "-end") return src + ":end";
  if (id.indexOf(src + "-") === 0) {
    const candidate = src + ":" + id.slice(src.length + 1);
    if (catalogEntryFor(candidate)) return candidate;
  }
  const cats = SOURCE_CATALOG[src] && SOURCE_CATALOG[src].cats;
  if (cats && cats[idx]) return cats[idx].ref;
  return defaultRefFor(src);
}

/** Secciones del Home SOLO para las fuentes de manga, tal y como las muestra cada sitio:
 *  ZonaTMO: actualizados / lo más visto / mejor valorados; ManhwaSS: últimas / en emisión / completados. */
function tabSpecs(src) {
  if (src === "zt" || src === "zo") return [
    { id: src + "-new", src, ref: src + ":new", title: SOURCES[src].name + " · Actualizados", titleEn: SOURCES[src].name + " · Updated", params: { page: 1, order: "new", postsPerPage: 12 } },
    { id: src + "-pop", src, ref: src + ":pop", title: SOURCES[src].name + " · Lo más visto", titleEn: SOURCES[src].name + " · Most read", params: { tops: true, page: 1, postsPerPage: 12 } },
    { id: src + "-top", src, ref: src + ":score", title: SOURCES[src].name + " · Mejor valorados", titleEn: SOURCES[src].name + " · Top rated", params: { page: 1, order: "score", postsPerPage: 12 } },
  ];
  if (src === "ms" || src === "mh") return [
    { id: src + "-new", src, ref: src + ":latest", title: SOURCES[src].name + " · Últimas actualizaciones", titleEn: SOURCES[src].name + " · Latest", params: { latest: true } },
    { id: src + "-emi", src, ref: src + ":on-going", title: SOURCES[src].name + " · En emisión", titleEn: SOURCES[src].name + " · Ongoing", params: { page: 1, estado: "on-going" } },
    { id: src + "-end", src, ref: src + ":end", title: SOURCES[src].name + " · Completados", titleEn: SOURCES[src].name + " · Completed", params: { page: 1, estado: "end" } },
  ];
  if (src === "ol") return [
    { id: "ol-new", src: "ol", ref: "ol:new", title: SOURCES.ol.name + " · Recientes", titleEn: SOURCES.ol.name + " · Latest", params: { page: 1, order: "new", type: "comic" } },
    { id: "ol-pop", src: "ol", ref: "ol:pop", title: SOURCES.ol.name + " · Ranking diario", titleEn: SOURCES.ol.name + " · Daily ranking", params: { tops: true, page: 1, kind: "daily" } },
    { id: "ol-nov", src: "ol", ref: "ol:novels", title: SOURCES.ol.name + " · Novelas ligeras", titleEn: SOURCES.ol.name + " · Light novels", params: { page: 1, order: "new", type: "novel" } },
  ];
  if (src === "lc") return [
    { id: "lc-new", src: "lc", ref: "lc:latest", title: SOURCES.lc.name + " · Últimos mangas", titleEn: SOURCES.lc.name + " · Latest manga", params: { latest: true } },
    { id: "lc-pop", src: "lc", ref: "lc:pop", title: SOURCES.lc.name + " · Tendencias", titleEn: SOURCES.lc.name + " · Trending", params: { tops: true, page: 1 } },
    { id: "lc-emi", src: "lc", ref: "lc:ongoing", title: SOURCES.lc.name + " · En emisión", titleEn: SOURCES.lc.name + " · Ongoing", params: { page: 1, estado: "ongoing" } },
  ];
  if (src === "ik") return [
    { id: "ik-new", src: "ik", ref: "ik:new", title: SOURCES.ik.name + " · Actualizados", titleEn: SOURCES.ik.name + " · Updated", params: { page: 1, sort: "last_chapter_date" } },
    { id: "ik-pop", src: "ik", ref: "ik:pop", title: SOURCES.ik.name + " · Más vistos", titleEn: SOURCES.ik.name + " · Most viewed", params: { tops: true, page: 1 } },
    { id: "ik-nov", src: "ik", ref: "ik:novels", title: SOURCES.ik.name + " · Novelas ligeras", titleEn: SOURCES.ik.name + " · Light novels", params: { page: 1, sort: "last_chapter_date", type: "novel" } },
  ];
  if (src === "lf") return [
    { id: "lf-new", src: "lf", ref: "lf:latest", title: SOURCES.lf.name + " · Actualizados", titleEn: SOURCES.lf.name + " · Updated", params: { homeKey: "recent" } },
    { id: "lf-pop", src: "lf", ref: "lf:pop", title: SOURCES.lf.name + " · Populares", titleEn: SOURCES.lf.name + " · Popular", params: { homeKey: "popular" } },
    { id: "lf-today", src: "lf", ref: "lf:today", title: SOURCES.lf.name + " · Tendencias hoy", titleEn: SOURCES.lf.name + " · Popular today", params: { homeKey: "popularToday" } },
  ];
  if (src === "mc") return [
    { id: "mc-new", src: "mc", ref: "mc:latest", title: SOURCES.mc.name + " · Actualizados", titleEn: SOURCES.mc.name + " · Updated", params: { page: 1, sort: "updated" } },
    { id: "mc-pop", src: "mc", ref: "mc:pop", title: SOURCES.mc.name + " · Más vistos", titleEn: SOURCES.mc.name + " · Most viewed", params: { tops: true, page: 1 } },
    { id: "mc-nov", src: "mc", ref: "mc:novels", title: SOURCES.mc.name + " · Novelas", titleEn: SOURCES.mc.name + " · Novels", params: { page: 1, sort: "updated", type: "Novel" } },
  ];
  if (src === "mw") return [
    { id: "mw-new", src: "mw", ref: "mw:latest", title: SOURCES.mw.name + " · Capítulos recientes", titleEn: SOURCES.mw.name + " · Latest chapters", params: { homeKey: "recent" } },
    { id: "mw-pop", src: "mw", ref: "mw:pop", title: SOURCES.mw.name + " · Populares", titleEn: SOURCES.mw.name + " · Popular", params: { homeKey: "popular" } },
    { id: "mw-nuevos", src: "mw", ref: "mw:new", title: SOURCES.mw.name + " · Recién agregados", titleEn: SOURCES.mw.name + " · Newly added", params: { homeKey: "fresh" } },
  ];
  return [];
}

/** Estantes del Home para UNA fuente (manga: sus filas nativas; novela: las secciones de su sitio). */
async function loadHomeShelves(src, en) {
  try {
    const ck = cacheKey("home", src);
    const cached = cacheGet(ck, TTL.rows);
    if (cached && cached.length && cached[0].ref) return { shelves: cached, cf: false, cfKind: null, err: null };
    let shelves;
    if (isNovel(src)) {
      const raw = await nv.novelHome(src);
      shelves = (raw || []).map((r, idx) => ({ id: r.id, ref: r.ref || inferShelfRef(src, r, idx), title: r.title, titleEn: r.titleEn, items: (r.items || []).map(compactCard).filter(Boolean) }));
    } else {
      const specs = tabSpecs(src);
      const settled = await Promise.allSettled(specs.map(fetchOneRow));
      shelves = [];
      for (const p of settled) if (p.status === "fulfilled" && p.value && p.value.items.length) shelves.push(p.value);
    }
    if (shelves.length) cacheSet(ck, shelves);
    if (!shelves.length) return probeCf(src, en, shelves);
    return { shelves, cf: false, cfKind: null, err: null };
  } catch (e) {
    // los adaptadores lanzan con HTTP 403/503: la sonda decide si fue un desafío de Cloudflare
    return probeCf(src, en, [], SOURCES[src].name + ": " + String((e && e.userMessage) || (e && e.message) || "la fuente no respondió").slice(0, 140));
  }
}

/** Sonda de control: ¿la fuente está tras un muro de Cloudflare y de qué tipo es? */
async function probeCf(src, en, shelves, fallbackErr) {
  const base = FUENTES_URL[src];
  let kind = null;
  // 1) la marca persistente decide solo si es FRESCA (< 15 min): una marca vieja (p. ej. la que
  //    dejó la versión anterior de un adaptador con rutas malas) no puede tumbar la fuente
  //    todo un día sin comprobar; notaHttp ya la renueva o la borra según lo que responda
  const st = base ? cfStateFor(base) : null;
  if (st && st.ageMs < 15 * 60 * 1000) kind = st.kind;
  // 2) si no, un control directo decide (una petición, solo en fallo, con plazo completo);
  //    la respuesta pasa por noteHttp: 200 borra la marca y 403 la renueva, solo
  if (!kind && base) {
    try {
      const ctrl = await fetchText(base + "/", { heads: { Accept: "text/html" }, timeoutMs: 12000 });
      kind = cfClassify(ctrl.status, ctrl.text);
    } catch { /* sin red: el error genérico basta */ }
  }
  if (kind === "challenge") {
    return { shelves, cf: true, cfKind: "challenge", err: en ? SOURCES[src].name + " is behind a Cloudflare challenge" : SOURCES[src].name + " está detrás de un desafío de Cloudflare" };
  }
  if (kind === "blocked") {
    return { shelves, cf: true, cfKind: "blocked", err: en ? SOURCES[src].name + " is blocked by a Cloudflare rule" : SOURCES[src].name + " está bloqueada por una regla de Cloudflare" };
  }
  return { shelves, cf: false, cfKind: null, err: fallbackErr || (en ? SOURCES[src].name + " did not answer" : SOURCES[src].name + " no respondió") };
}

async function fetchOneRow(spec) {
  const a = adapter(spec.src);
  let res;
  if (spec.params.homeKey && typeof a.homeSections === "function") {
    const hs = await a.homeSections(spec.src);
    res = { items: (hs && hs[spec.params.homeKey]) || [] };
  } else if (spec.params.tops) res = await a.tops(spec.src, { page: spec.params.page, postsPerPage: spec.params.postsPerPage });
  else if (spec.params.latest) res = await a.latest(spec.src);
  else res = await a.list(spec.src, spec.params);
  const items = res.items.slice(0, 12).map(compactCard);
  if (items.length) cacheSet(cacheKey("rows", spec.id), items);
  return { id: spec.id, ref: spec.ref, title: spec.title, titleEn: spec.titleEn, items };
}

/** Refresca las 6 filas en paralelo; cada fila entra si pudo. */
/** «Seguir leyendo»: kino.progress (0.9.83+) o el respaldo en storage. */
async function progressEntries() {
  const out = [];
  if (hasProgress()) {
    try {
      const list = await kino.progress.list({ limit: 12 });
      for (const e of Array.isArray(list) ? list : []) {
        if (!e || e.done || !e.resume) continue;
        let resume;
        try { resume = JSON.parse(e.resume); } catch { resume = null; }
        if (!resume || !resume.cr) continue;
        out.push({ r: resume.cr, m: resume.mr, t: e.title || "", p: e.poster || "", b: resume.label || "" });
      }
    } catch { /* sin permiso */ }
  }
  if (!out.length) {
    const all = storageProgress();
    const entries = Object.entries(all).slice(-12).reverse();
    for (const [mr, d] of entries) {
      out.push({ r: d.cr, m: mr, t: "", p: "", b: d.n ? "Cap. " + d.n : "" });
    }
  }
  return out.length ? [{ id: "seguir-screen", title: "Seguir leyendo", titleEn: "Keep reading", items: out }] : [];
}

// ---------- cargadores con caché ----------

async function loadDetail(ref, { skipCache = false } = {}) {
  const p = parseRef(ref);
  if (!p || p.kind !== "m") throw kino.error("invalid_request", "referencia de manga desconocida");
  if (!skipCache) {
    const cached = cacheGet(cacheKey("det", ref), TTL.detail);
    if (cached && cached.title) return cached;
  }
  const a = adapter(p.src);
  let d, chapters = [], next = null, totalCaps;
  const k = SOURCES[p.src].kind;
  if (k === "olympus" || k === "leercapitulo" || k === "ikigai" || k === "lectorfenix" || k === "mhscans" || k === "manhwaweb" || SOURCES[p.src].kind === "zonatmo" || SOURCES[p.src].kind === "zonatmoorg") {
    // detalle y capítulos no dependen entre sí: en paralelo
    const [dRes, cRes] = await Promise.allSettled([a.detail(p.src, p.a), a.chapters(p.src, p.a, { page: 1, postsPerPage: 50, order: "asc" })]);
    if (dRes.status === "rejected") throw dRes.reason;
    d = dRes.value;
    if (cRes.status === "fulfilled") { chapters = cRes.value.items; next = cRes.value.next; }
  } else {
    // novelas: ficha + PRIMER LOTE de capítulos en paralelo (DevilNovels pagina de verdad por
    // la REST de WordPress; las API de una respuesta entregan el lote desde su caché) — nada
    // baja la obra entera para abrir el detalle; «Cargar más» pide lo siguiente
    const [dRes, cRes] = await Promise.allSettled([a.detail(p.src, p.a), nv.novelChapters(p.src, p.a, { page: 1, postsPerPage: 50, order: "asc" })]);
    if (dRes.status === "rejected") throw dRes.reason;
    d = dRes.value;
    if (cRes.status === "fulfilled" && cRes.value && cRes.value.items && cRes.value.items.length) {
      chapters = cRes.value.items;
      next = cRes.value.next;
      totalCaps = cRes.value.total;
    } else if (!chapters.length) {
      chapters = d.chapters || [];
    }
  }
  const det = {
    src: p.src,
    slug: p.a,
    title: d.title,
    overview: d.overview,
    poster: d.poster,
    genres: d.genres || [],
    status: d.statusName,
    demography: d.demographyName,
    score: d.score,
    total: typeof totalCaps === "number" ? totalCaps : d.totalChapters,
    chapters: chapters.slice(0, 250).map((c) => ({ r: chapterRef(p.src, p.a, c.slug), n: c.number, t: c.title, pago: Boolean(c.pago) })),
    next,
    adult: d.adult,
  };
  cacheSet(cacheKey("det", ref), det);
  return det;
}

async function loadChapter(ref, args, { skipCache = false } = {}) {
  const p = parseRef(ref);
  if (!p || p.kind !== "c") throw kino.error("invalid_request", "referencia de capítulo desconocida");
  if (!skipCache) {
    const cached = cacheGet(cacheKey("ch", ref), TTL.chapter);
    if (cached && cached.pages && cached.pages.length) return withChapterMeta(cached, args);
    if (cached && cached.text && cached.text.length) return withChapterMeta(cached, args);
  }
  const c = isNovel(p.src)
    ? await nv.novelChapter(p.src, p.a, p.b)
    : await adapter(p.src).chapter(p.src, p.a, p.b);
  if (c.text && c.text.length) {
    // Novela (fuente de novela o capítulo de novela en fuente mixta como Olympus): el progreso se guarda al entrar.
    const data = {
      ref,
      src: p.src,
      mangaSlug: p.a,
      mr: mangaRef(p.src, p.a),
      text: c.text,
      imgs: c.imgs,
      number: c.number,
      title: c.title,
      direction: c.direction,
      prev: c.prev ? chapterRef(p.src, p.a, c.prev) : null,
      next: c.next ? chapterRef(p.src, p.a, c.next) : null,
      total: Math.max(1, Math.ceil(c.text.slice(0, 600).length / 12)),
      ppages: Math.max(1, Math.ceil(c.text.slice(0, 600).length / 12)),
      mode: "texto",
    };
    cacheSet(cacheKey("ch", ref), data);
    const fin = withChapterMeta(data, args);
    try {
      saveProgress(fin.mr, ref, { number: fin.number, total: fin.ppages || 1, mTitle: fin.mTitle, mPoster: fin.mPoster }, 1, 0.5 / (fin.ppages || 1));
    } catch { /* el progreso es optativo */ }
    return fin;
  }
  const data = {
    ref,
    src: p.src,
    mangaSlug: p.a,
    mr: mangaRef(p.src, p.a),
    pages: c.pages,
    number: c.number,
    title: c.title,
    direction: c.direction,
    prev: c.prev ? chapterRef(p.src, p.a, c.prev) : null,
    next: c.next ? chapterRef(p.src, p.a, c.next) : null,
    total: c.pages.length,
  };
  cacheSet(cacheKey("ch", ref), data);
  return withChapterMeta(data, args);
}

function withChapterMeta(c, args) {
  return { ...c, mTitle: args && args.t ? args.t : c.mTitle, mPoster: args && args.p ? args.p : c.mPoster };
}

// ---------- vista: piezas comunes ----------

function appBar(title, titleEn, ctx, opts) {
  const o = opts || {};
  const onMain = o.close;
  const leading = onMain
    ? { type: "IconButton", icon: "close", labelText: "Cerrar", labelTextEn: "Close", onPressed: { close: true } }
    : { type: "IconButton", icon: "arrow_back", labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "atras" } };
  const actions = Array.isArray(o.actions) ? o.actions.slice(0, 3) : [];
  if (o.share && actions.length < 4) actions.push({ type: "IconButton", icon: "share", labelText: "Compartir", labelTextEn: "Share", onPressed: "share" });
  return { type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false, title, titleEn, leading, actions };
}

function scaffold(title, titleEn, ctx, body, opts) {
  const o = opts || {};
  const s = { type: "Scaffold", appBar: appBar(title, titleEn, ctx, o), body };
  if (o.fab) s.floatingActionButton = o.fab; // slot floatingActionButton: un nodo FloatingActionButton
  if (o.bottomBar) s.bottomNavigationBar = { // slot bottomNavigationBar: una NavigationBar
    type: "navigationBar",
    items: [
      { key: "home", icon: "home", label: "Inicio", labelEn: "Home" },
      { key: "biblioteca", icon: "bookmark", label: "Biblioteca", labelEn: "Library" },
    ],
    value: o.navValue || "home",
    onChanged: "navBar",
  };
  return s;
}

function empty(text, en) {
  return { type: "emptyState", icon: "magic", title: text, titleEn: en || text };
}

/** Error del detalle; si menciona Cloudflare, ofrece resolverlo con la ventana visual. */
function detailErrorBox(msg, ref) {
  const cf = /cloudflare|desafío|challenge/i.test(String(msg));
  const kids = [
    { type: "errorState", icon: "error", title: "Algo falló", titleEn: "Something failed", text: String(msg).slice(0, 300) },
    { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "reintentar", arg: ref } },
  ];
  if (cf) kids.splice(1, 0, { type: "Button", variant: "primary", icon: "lock", labelText: "Resolver desafío de Cloudflare", labelTextEn: "Solve the Cloudflare challenge", onPressed: { event: "cfAbrir", arg: ref } });
  return { type: "Column", gap: 12, padding: 16, children: kids };
}

function errorBox(msg, retryEvent, retryArg) {
  return { type: "Column", gap: 12, padding: 16, children: [
    { type: "errorState", icon: "error", title: "Algo falló", titleEn: "Something failed", text: String(msg).slice(0, 300) },
    { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: retryArg ? { event: retryEvent || "reintentar", arg: retryArg } : { event: retryEvent || "reintentar" } },
  ] };
}

/** El botón flotante de búsqueda, independiente, a la derecha. */
function floatFab() {
  return { type: "FloatingActionButton", icon: "search", labelText: "Buscar en todas las fuentes", labelTextEn: "Search all sources", onPressed: { go: { screen: { route: "buscar" } } }, fabPosition: "end" };
}

/** BottomSheet del Atelier de Temas (apiVersion 18 go.useTheme desde la propia pantalla). */
function themeAtelierSheet(ctx) {
  const active = ctx.activeTheme || null;
  return {
    type: "BottomSheet",
    key: "themeSheet",
    title: "Atelier de Temas",
    titleEn: "Theme Atelier",
    children: [
      { type: "Column", gap: 12, padding: 16, children: [
        { type: "Text", text: "Elige una paleta premium para todo Kino y el lector. «Atelier Obsidiana» ofrece oro champagne sobre obsidiana con bordes esculpidos.", textEn: "Pick a premium palette for all of Kino and the reader. Obsidian Atelier pairs champagne gold with sculpted obsidian surfaces.", style: "body", color: "muted" },
        { type: "Row", wrap: true, gap: 8, children: THEMES.map((t) => ({
          type: "Button",
          variant: active === t.id ? "primary" : "secondary",
          icon: active === t.id ? "check" : "magic",
          selected: active === t.id,
          labelText: t.name.es,
          labelTextEn: t.name.en,
          onPressed: { go: { useTheme: { theme: t.id } } },
          span: 6,
          fill: true,
        })) },
        { type: "TextButton", icon: "refresh", labelText: "Usar tema base de Kino", labelTextEn: "Reset to Kino default", onPressed: { go: { useTheme: { theme: null } } }, fill: true },
      ] },
    ],
  };
}

// ---------- vista: portada ----------

/** Las fuentes del panel de la cápsula, en dos por fila, con su tipo a la vista. */
function panelSources(src, en) {
  const rows = [];
  for (let i = 0; i < HOME_TABS.length; i += 2) {
    rows.push({ type: "Row", gap: 8, children: HOME_TABS.slice(i, i + 2).map((k) => ({
      type: "Button",
      variant: k === src ? "primary" : "secondary",
      icon: k === src ? "check" : (isNovel(k) ? "list" : "magic"),
      selected: k === src,
      labelText: SOURCES[k].name + (isNovel(k) ? (en ? " · novel" : " · novela") : isMixed(k) ? (en ? " · mix" : " · mixta") : ""),
      labelTextEn: SOURCES[k].name + (isNovel(k) ? " · novel" : isMixed(k) ? " · mix" : ""),
      onPressed: { event: "tabSrc", arg: k },
      flex: 1,
      fill: true,
    })) });
  }
  return rows;
}

/** Construye una tarjeta hero editorial para el carrusel de portada (PageView + heroCard). */
function buildHeroSlide(item, shelfTitle, firstRef, src, en, tv) {
  const nombre = SOURCES[src].name;
  const sub = (shelfTitle ? shelfTitle + " · " : "") + (isNovel(src) ? (en ? "Light Novel" : "Novela Ligera") : isMixed(src) ? (en ? "Comics & Novels" : "Cómics y Novelas") : "Manga · Manhwa");
  const hasHttps = typeof item.p === "string" && item.p.indexOf("https://") === 0;
  return {
    type: "heroCard",
    title: String(item.t || nombre).slice(0, 80),
    text: sub.slice(0, 120),
    image: hasHttps ? item.p : undefined,
    headers: hasHttps ? imgHeads(item.p) : undefined,
    canRequestFocus: tv ? true : undefined,
    buttons: [
      { type: "ElevatedButton", icon: "play", labelText: "Abrir obra", labelTextEn: "Open title", onPressed: { go: { screen: { args: { r: item.s, t: item.t } } } } },
      { type: "Button", variant: "secondary", icon: "list", labelText: "Catálogo " + nombre, labelTextEn: "Browse " + nombre, onPressed: { go: { screen: { route: "fuente", args: { s: src, ref: firstRef || defaultRefFor(src) } } } } },
    ],
  };
}

function viewMain(ctx) {
  const { state, lang, device } = ctx;
  const en = lang === "en";
  const tv = device === "tv";
  const src = state.hsrc || "zt";
  // ---- contenido desplazable: carrusel editorial + lecturas recientes + estantes nativos ----
  const kids = [];
  let shelves = state.hrows;
  let loading = false;
  if (!shelves) {
    shelves = cacheGet(cacheKey("home", src), TTL.rows) || [];
    loading = !state.done && !shelves.length;
  }

  // Escaparate Hero (PageView de hasta 4 obras destacadas con portada https)
  if (!loading && shelves.length) {
    const firstShelf = shelves[0];
    const firstRef = inferShelfRef(src, firstShelf, 0);
    const heroItems = [];
    const seenHero = new Set();
    for (const sh of shelves) {
      for (const it of sh.items || []) {
        if (!it || !it.s || !it.p || it.p.indexOf("https://") !== 0 || seenHero.has(it.s)) continue;
        seenHero.add(it.s);
        heroItems.push({ it, shTitle: sh.title || firstShelf.title || "", shRef: inferShelfRef(src, sh, 0) });
        if (heroItems.length >= 4) break;
      }
      if (heroItems.length >= 4) break;
    }
    if (heroItems.length >= 2) {
      kids.push({
        type: "PageView",
        viewportFraction: { compact: 0.94, medium: 0.88, expanded: 0.72 },
        padEnds: false,
        autoPlayMs: 6500,
        margin: { x: 8, y: 4 },
        children: heroItems.map((h) => buildHeroSlide(h.it, h.shTitle, h.shRef || firstRef, src, en, tv)),
      });
    } else if (heroItems.length === 1) {
      kids.push({
        type: "Column",
        padding: { x: 16, y: 4 },
        children: [buildHeroSlide(heroItems[0].it, heroItems[0].shTitle, heroItems[0].shRef || firstRef, src, en, tv)],
      });
    }
  }

  const seguir = (state.rows || []).find((r) => r.id === "seguir-screen");
  if (seguir && seguir.items && seguir.items.length) {
    kids.push({
      type: "titleRail",
      headers: imgHeads(seguir.items.find((x) => x.p && x.p.indexOf("http") === 0)?.p, false) || undefined,
      title: seguir.title || "Sigue leyendo",
      titleEn: seguir.titleEn || "Keep reading",
      items: seguir.items.map((x) => ({
        id: ("seg-" + String(x.r)).slice(0, 110).replace(/[^A-Za-z0-9._~-]/g, "_"),
        ref: String(x.m || x.r),
        title: x.t || "Seguir leyendo",
        kind: "movie",
        poster: x.p || undefined,
        badges: x.b ? [String(x.b).slice(0, 20)] : undefined,
        lang: "es",
        open: { screen: { args: { r: x.r, m: x.m, t: x.t, p: x.p } } },
      })).filter(Boolean),
      size: "medium",
    });
    // opción técnica: borrar el historial de lectura (respaldo en storage y elementos de kino.progress)
    kids.push({ type: "Row", mainAxisAlignment: "end", padding: { x: 16, y: 4 }, children: [
      { type: "TextButton", icon: "delete", labelText: "Borrar historial de lectura", labelTextEn: "Clear reading history", onPressed: { event: "borrarHistorial" } },
    ] });
  }

  if (loading) {
    kids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "Skeleton", shape: "card", height: 200 },
    ] });
  } else if (shelves.length) {
    shelves.forEach((row, idx) => {
      const primerP = (row.items || []).find((x) => x.p && x.p.indexOf("http") === 0);
      const rowRef = inferShelfRef(src, row, idx);
      kids.push({ type: "titleRail", headers: imgHeads(primerP && primerP.p), title: row.title || "", titleEn: row.titleEn, ref: rowRef, items: (row.items || []).map(expandOne).filter(Boolean), size: idx === 0 ? "medium" : "small" });
    });
  } else if (state.herr) {
    if (state.cf && ctx.device !== "tv") {
      const blocked = state.cfKind === "blocked";
      kids.push({ type: "Card", variant: "outlined", border: { width: 1, color: "warning" }, borderRadius: "large", margin: { x: 16, y: 8 }, padding: 16, children: [
        { type: "Column", gap: 12, children: [
          { type: "errorState", icon: "lock", title: blocked ? "La fuente está bloqueada" : "Desafío de Cloudflare", titleEn: blocked ? "The source is blocked" : "Cloudflare challenge",
            text: blocked
              ? SOURCES[src].name + " responde con una regla de Cloudflare (acceso denegado por IP o firma del navegador). Puedes intentar el pre-clearance, pero puede no bastar: prueba también otra red (Wi-Fi o datos móviles) o más tarde."
              : SOURCES[src].name + " está detrás de un desafío de Cloudflare. Se abrirá una ventana del sitio: complétalo una vez y las siguientes peticiones pasarán con la cookie que deja (pre-clearance).",
            textEn: blocked
              ? SOURCES[src].name + " answers with a Cloudflare rule (denied by IP or browser signature). Pre-clearance may not be enough: try another network (Wi-Fi or mobile data) or later."
              : SOURCES[src].name + " is behind a Cloudflare challenge. A window of the site will open: complete it once and the next requests pass with the cookie it leaves (pre-clearance)." },
          { type: "Button", variant: "primary", icon: "lock", labelText: blocked ? "Intentar pre-clearance" : "Resolver desafío de Cloudflare", labelTextEn: blocked ? "Try pre-clearance" : "Solve the Cloudflare challenge", onPressed: { event: "cfAbrir", arg: src }, fill: true },
          { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "tabSrc", arg: src } },
        ] },
      ] });
    } else {
      kids.push(errorBox(state.herr, "tabSrc", src));
    }
  } else if (state.error) {
    kids.push(errorBox(state.error, "tabSrc", src));
  } else {
    kids.push(empty("Sin datos de " + SOURCES[src].name + " por ahora", "No data from " + SOURCES[src].name + " yet"));
  }
  if (state.note) kids.push({ type: "Text", text: String(state.note).slice(0, 160), style: "body", color: "muted", padding: { x: 16, y: 4 } });

  // ---- cápsula editorial fijada arriba + panel desplegable (overlay con scrim) ----
  const capsula = {
    type: "Card",
    variant: "filled",
    background: "surfaceVariant",
    border: { width: 1, color: state.capsOpen ? "primary" : "surface" },
    borderRadius: "large",
    elevation: 6,
    margin: { x: 16, y: 4 },
    padding: { x: 12, y: 8 },
    children: [
      { type: "Row", gap: 8, crossAxisAlignment: "center", children: [
        { type: "CircleAvatar", icon: isNovel(src) ? "list" : "magic", radius: 16, backgroundColor: "primaryContainer", labelText: SOURCES[src].name },
        { type: "Column", flex: 1, gap: 4, children: [
          { type: "Text", text: SOURCES[src].name, style: "h4" },
          { type: "Text", text: isNovel(src) ? (en ? "Light Novels · Active source" : "Novelas Ligeras · Fuente activa") : isMixed(src) ? (en ? "Comics & Novels · Active source" : "Cómics y Novelas · Fuente activa") : (en ? "Manga & Manhwa · Active source" : "Manga y Manhwa · Fuente activa"), style: "caption", color: "muted" },
        ] },
        { type: "Button", variant: state.capsOpen ? "primary" : "secondary", icon: state.capsOpen ? "expand_less" : "expand_more",
          labelText: "Fuente: " + SOURCES[src].name, labelTextEn: "Source: " + SOURCES[src].name,
          onPressed: { event: "capsToggle" }, selected: Boolean(state.capsOpen) },
      ] },
    ],
  };
  const capStack = { type: "Stack", flex: 1, children: [
    { type: "SingleChildScrollView", onScroll: "scrMain", children: [{ type: "Column", crossAxisAlignment: "stretch", children: kids }] },
    themeAtelierSheet(ctx),
  ] };
  if (state.capsOpen) {
    capStack.children.push({
      type: "Column", positioned: { top: 0, left: 0, right: 0, bottom: 0 },
      background: "surface", opacity: 0.62, onTap: { event: "capsClose" },
    });
    capStack.children.push({
      type: "Column", positioned: { top: 0, left: 12, right: 12 },
      children: [{
        type: "Card",
        variant: "filled",
        background: "surfaceVariant",
        border: { width: 1, color: "primary" },
        borderRadius: "large",
        elevation: 16,
        padding: 16,
        animate: { duration: 220, curve: "decelerate" },
        children: [{
          type: "Column", gap: 8, children: [
            { type: "Row", mainAxisAlignment: "spaceBetween", crossAxisAlignment: "center", children: [
              { type: "Text", text: "Elegir fuente", textEn: "Pick a source", style: "h3" },
              { type: "Badge", text: Object.keys(SOURCES).length + " fuentes", textEn: Object.keys(SOURCES).length + " sources", color: "primary" },
            ] },
            ...panelSources(src, en),
            { type: "Text", text: "El panel se cierra solo a los 5 segundos o al tocar fuera.", textEn: "The panel closes on its own after 5 seconds or on a tap outside.", style: "caption", color: "muted" },
          ],
        }],
      }],
    });
  }
  const body = { type: "Column", crossAxisAlignment: "stretch", gap: 8, children: [capsula, capStack] };
  const opts = {
    close: true,
    navValue: "home",
    actions: [
      { type: "IconButton", icon: "magic", labelText: "Temas", labelTextEn: "Themes", onPressed: { ui: [{ open: "themeSheet" }] } },
      { type: "IconButton", icon: "search", labelText: "Buscar", labelTextEn: "Search", onPressed: { go: { screen: { route: "buscar" } } } },
    ],
  };
  if (!state.hideBar) { opts.bottomBar = true; if (!state.capsOpen) opts.fab = floatFab(); }
  const root = scaffold("Multi-verso Kin", "Multi-verse Kin", ctx, body, opts);
  root.layout = "fill";
  // temporizador de raíz: cada segundo revisa si al panel le toca cerrarse (5 s sin interacción)
  root.every = [{ ms: 1000, event: "capsTick" }];
  return root;
}

// ---------- fuente: catálogo paginado por categoría y género ----------

/** Carga una página real del catálogo de una categoría o género concreto usando browse(ref, cursor). */
async function loadFuenteCategory(src, ref, cursor, en) {
  const parsed = parseBrowseRef(ref);
  const targetSrc = (parsed && SOURCES[parsed.src]) ? parsed.src : src;
  const targetRef = (parsed && SOURCES[parsed.src]) ? ref : defaultRefFor(targetSrc);
  const meta = catalogEntryFor(targetRef);
  const pageNum = Math.max(1, Number(cursor) || 1);
  try {
    const ck = cacheKey("cat", targetRef + ":" + pageNum);
    const cached = cacheGet(ck, TTL.rows);
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      return {
        src: targetSrc,
        ref: targetRef,
        title: (meta && meta.fullTitle) || SOURCES[targetSrc].name,
        titleEn: (meta && meta.fullTitleEn) || SOURCES[targetSrc].name,
        items: cached.items,
        next: cached.next || null,
        err: null,
        cf: false,
        cfKind: null,
      };
    }
    const pageRes = await browse(targetRef, cursor || null);
    const items = ((pageRes && pageRes.items) || []).map(compactCard).filter(Boolean);
    const next = (pageRes && pageRes.next) || null;
    if (items.length) cacheSet(ck, { items, next });
    if (!items.length && pageNum === 1) {
      const cfInfo = await probeCf(targetSrc, en, []);
      return {
        src: targetSrc,
        ref: targetRef,
        title: (meta && meta.fullTitle) || SOURCES[targetSrc].name,
        titleEn: (meta && meta.fullTitleEn) || SOURCES[targetSrc].name,
        items: [],
        next: null,
        err: cfInfo.err,
        cf: cfInfo.cf,
        cfKind: cfInfo.cfKind,
      };
    }
    return {
      src: targetSrc,
      ref: targetRef,
      title: (meta && meta.fullTitle) || SOURCES[targetSrc].name,
      titleEn: (meta && meta.fullTitleEn) || SOURCES[targetSrc].name,
      items,
      next,
      err: null,
      cf: false,
      cfKind: null,
    };
  } catch (e) {
    const cfInfo = await probeCf(targetSrc, en, [], SOURCES[targetSrc].name + ": " + String((e && e.userMessage) || (e && e.message) || "la fuente no respondió").slice(0, 140));
    return {
      src: targetSrc,
      ref: targetRef,
      title: (meta && meta.fullTitle) || SOURCES[targetSrc].name,
      titleEn: (meta && meta.fullTitleEn) || SOURCES[targetSrc].name,
      items: [],
      next: null,
      err: cfInfo.err,
      cf: cfInfo.cf,
      cfKind: cfInfo.cfKind,
    };
  }
}

/** Compatibilidad y punto de entrada del catálogo completo por fuente/categoría. */
async function loadFuenteAll(src, en, ref) {
  return loadFuenteCategory(src, ref || defaultRefFor(src), null, en);
}

/** Vista «fuente»: catálogo paginado real de la categoría o género elegido de una fuente,
 *  con selector de categorías/géneros, scroll infinito (`onEndReached`), carga manual y botón Salir. */
function viewFuente(ctx) {
  const { state, lang } = ctx;
  const en = lang === "en";
  const args = (ctx.route && (ctx.route.args || ctx.route.params)) || null;
  const f = state.fuente || null;
  const rawRef = (f && f.ref) || (args && args.ref) || "";
  const refParsed = parseBrowseRef(rawRef);
  const src = (f && f.src && SOURCES[f.src]) ? f.src : (refParsed && SOURCES[refParsed.src]) ? refParsed.src : (args && args.s && SOURCES[args.s]) ? args.s : state.hsrc || "zt";
  const activeRef = (refParsed && refParsed.src === src) ? rawRef : defaultRefFor(src);
  const nombre = SOURCES[src] ? SOURCES[src].name : String(src);
  const meta = catalogEntryFor(activeRef);
  const catTitle = (f && f.title) || (meta && meta.fullTitle) || (nombre + " · Todo");
  const catTitleEn = (f && f.titleEn) || (meta && meta.fullTitleEn) || (nombre + " · All");
  const spec = SOURCE_CATALOG[src] || { cats: [], genres: [] };
  const catOpts = (spec.cats || []).map((c) => ({ value: c.ref, label: en ? c.labelEn : c.label }));
  const genOpts = (spec.genres || []).map((g) => ({ value: g.ref, label: en ? g.labelEn : g.label }));

  const salir = () => ({ type: "Button", variant: "secondary", icon: "arrow_back", labelText: "Salir (volver al Home)", labelTextEn: "Exit (back to Home)", onPressed: { event: "atras" }, fill: true, padding: { x: 16, y: 4 } });

  const headerKids = [
    {
      type: "Card", variant: "filled", background: "surfaceVariant", border: { width: 1, color: "primary" }, borderRadius: "large",
      margin: { x: 16, y: 8 }, padding: 12,
      children: [{
        type: "Column", gap: 8, children: [
          { type: "Row", mainAxisAlignment: "spaceBetween", crossAxisAlignment: "center", children: [
            { type: "Text", text: en ? catTitleEn : catTitle, textEn: catTitleEn, style: "h3", flex: 1 },
            { type: "Badge", text: isNovel(src) ? "NOVELA" : "MANGA", color: "primary" },
          ] },
          salir(),
        ],
      }],
    },
  ];
  if (catOpts.length) {
    headerKids.push({
      type: "Chips",
      key: "catChip",
      value: catOpts.some((o) => o.value === activeRef) ? activeRef : [],
      options: catOpts,
      onChanged: "catSel",
      padding: { x: 16, y: 4 },
    });
  }
  if (genOpts.length) {
    headerKids.push({
      type: "Chips",
      key: "genChip",
      value: genOpts.some((o) => o.value === activeRef) ? activeRef : [],
      options: genOpts,
      onChanged: "catSel",
      padding: { x: 16, y: 4 },
    });
  }

  // Respaldo de compatibilidad si llega state.fuente con shelves legadas
  if (f && !Array.isArray(f.items) && Array.isArray(f.shelves)) {
    const legacyKids = [...headerKids];
    if (!f.shelves.length) {
      legacyKids.push(empty("Sin datos de " + nombre + " por ahora", "No data from " + nombre + " yet"));
    } else {
      f.shelves.forEach((row, idx) => {
        const primerP = (row.items || []).find((x) => x.p && x.p.indexOf("http") === 0);
        legacyKids.push({ type: "titleRail", headers: imgHeads(primerP && primerP.p), title: row.title || "", titleEn: row.titleEn, ref: inferShelfRef(src, row, idx), items: (row.items || []).map(expandOne).filter(Boolean), size: idx === 0 ? "medium" : "small" });
      });
    }
    return scaffold(catTitle, catTitleEn, ctx, { type: "SingleChildScrollView", children: legacyKids }, { navValue: "home" });
  }

  const bodyKids = [...headerKids];
  if (!f) {
    bodyKids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "reintentar", arg: activeRef }, padding: { x: 16, y: 4 } },
    ] });
    return scaffold(catTitle, catTitleEn, ctx, { type: "SingleChildScrollView", children: bodyKids }, { navValue: "home" });
  }
  if (f.cf && ctx.device !== "tv") {
    bodyKids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "errorState", icon: "lock", title: f.cfKind === "blocked" ? "La fuente está bloqueada" : "Desafío de Cloudflare", titleEn: f.cfKind === "blocked" ? "The source is blocked" : "Cloudflare challenge",
        text: nombre + " está tras Cloudflare: resuélvelo desde el Home o prueba más tarde.", textEn: nombre + " is behind Cloudflare: solve it from the Home or try later." },
      { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "reintentar", arg: activeRef }, padding: { x: 16, y: 4 } },
    ] });
    return scaffold(catTitle, catTitleEn, ctx, { type: "SingleChildScrollView", children: bodyKids }, { navValue: "home" });
  }
  if (f.err) {
    bodyKids.push(errorBox(f.err, "reintentar", activeRef));
    return scaffold(catTitle, catTitleEn, ctx, { type: "SingleChildScrollView", children: bodyKids }, { navValue: "home" });
  }
  const items = (f.items || []).map(expandOne).filter(Boolean);
  if (!items.length) {
    bodyKids.push(empty("Sin títulos en esta categoría por ahora", "No titles in this category yet"));
    return scaffold(catTitle, catTitleEn, ctx, { type: "SingleChildScrollView", children: bodyKids }, { navValue: "home" });
  }

  const primerP = (f.items || []).find((x) => x.p && x.p.indexOf("http") === 0);
  bodyKids.push({
    type: "titleGrid",
    flex: 1,
    columns: deviceCols(ctx),
    headers: imgHeads(primerP && primerP.p),
    items,
    onEndReached: f.next ? { event: "catMas" } : undefined,
    loadingMore: Boolean(f.loadingMore),
    done: !f.next,
  });
  if (f.next) {
    bodyKids.push({
      type: "Button",
      variant: "secondary",
      icon: "expand_more",
      labelText: "Cargar más títulos",
      labelTextEn: "Load more titles",
      loading: Boolean(f.loadingMore),
      onPressed: { event: "catMas" },
      fill: true,
      padding: { x: 16, y: 8 },
    });
  }
  const root = scaffold(catTitle, catTitleEn, ctx, { type: "Column", crossAxisAlignment: "stretch", children: bodyKids }, { navValue: "home" });
  root.layout = "fill";
  return root;
}

// ---------- biblioteca: Me Gustas y etiquetas ----------

// Etiquetas de la Biblioteca (las cuatro que pide la pantalla de detalle).
export const BIB_TAGS = [
  { k: "leyendo", t: "Leyendo", te: "Reading" },
  { k: "porleer", t: "Por leer", te: "To read" },
  { k: "pendiente", t: "Pendiente", te: "On hold" },
  { k: "terminado", t: "Terminado", te: "Finished" },
];

function storageObj(key) {
  try { return JSON.parse(kino.storage.get(key) || "null") || {}; } catch { return {}; }
}
const favsAll = () => storageObj("favs");
const biblioAll = () => storageObj("biblio");

function viewBiblioteca(ctx) {
  const { state, lang } = ctx;
  const en = lang === "en";
  const kids = [];
  kids.push({ type: "Text", text: "Mis Me Gustas", textEn: "My likes", style: "h4", padding: { x: 16, y: 8 } });
  const favItems = Object.entries(state.favs || favsAll()).slice(-60).reverse()
    .map(([ref, m]) => ({ s: ref, t: m.t, p: m.p })).filter((x) => x.s);
  if (favItems.length) {
    kids.push({ type: "titleGrid", items: favItems.map(expandOne).filter(Boolean), columns: deviceCols(ctx) });
  } else {
    kids.push(empty("Sin Me Gustas todavía: ponles corazón desde el detalle del manga", "No likes yet: heart them from the manga detail"));
  }
  kids.push({ type: "Text", text: "Etiquetados", textEn: "Tagged", style: "h4", padding: { x: 16, y: 8 } });
  const tag = state.bibTag && state.bibTag !== "todas" ? state.bibTag : null;
  kids.push({ type: "Chips", key: "bibTag", value: tag || "todas", options: [{ value: "todas", label: en ? "All" : "Todas" }].concat(BIB_TAGS.map((t) => ({ value: t.k, label: t.t }))), onChanged: "bibTagF", padding: { x: 16, y: 8 } });
  const bibItems = Object.entries(state.biblio || biblioAll())
    .filter(([, m]) => !tag || m.tag === tag)
    .slice(-120).reverse()
    .map(([ref, m]) => ({ s: ref, t: m.t, p: m.p })).filter((x) => x.s);
  if (bibItems.length) {
    kids.push({ type: "titleGrid", items: bibItems.map(expandOne).filter(Boolean), columns: deviceCols(ctx) });
  } else {
    kids.push(empty(tag ? "Nada con esa etiqueta" : "Nada etiquetado todavía", tag ? "Nothing with that tag" : "Nothing tagged yet"));
  }
  return scaffold("Biblioteca", "Library", ctx, { type: "SingleChildScrollView", children: kids }, { navValue: "biblioteca", bottomBar: true });
}

// ---------- vista: búsqueda ----------

function viewBuscar(ctx) {
  const { state, lang } = ctx;
  const en = lang === "en";
  const q = state.q || "";
  const filtro = state.busqSrc || "";
  const kids = [
    { type: "TextField", key: "q", kind: "search", labelText: "Buscar manga o manhwa", labelTextEn: "Search manga or manhwa", onSubmitted: "q", value: q, trailingIcon: "search", trailingLabel: "Buscar", onTrailingTap: "q", autofocus: !q },
    { type: "Chips", key: "busqSrc", value: filtro || "todas", options: [{ value: "todas", label: en ? "All sources" : "Todas" }].concat(Object.keys(SOURCES).map((k) => ({ value: k, label: SOURCES[k].name }))), onChanged: "busqSrc", padding: { x: 16, y: 8 } },
  ];
  if (state.busy && !state.results) {
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 16, children: [1, 2, 3, 4, 5, 6].map(() => ({ type: "Skeleton", shape: "card", width: 120, height: 160 })) });
  }
  if (state.results) {
    let n = 0;
    for (const g of state.results) {
      if (!g.items.length) continue;
      n += g.items.length;
      kids.push({ type: "Text", text: SOURCES[g.src].name, style: "h4", color: "primary", padding: { x: 16, y: 8 } });
      kids.push({ type: "titleGrid", items: g.items.map(expandOne).filter(Boolean), columns: deviceCols(ctx) });
    }
    if (!n) kids.push(empty('Sin resultados para "' + q.slice(0, 40) + '"', 'No results for "' + q.slice(0, 40) + '"'));
  }
  return scaffold("Buscar", "Search", ctx, { type: "SingleChildScrollView", children: kids }, { navValue: "home", bottomBar: true });
}

/** La ficha de esta obra EN SU sitio web (para «Abrir en el navegador»). */
function siteUrlOf(src, slug) {
  const kind = SOURCES[src] && SOURCES[src].kind;
  const e = encodeURIComponent(String(slug || ""));
  if (kind === "skynovels") return "https://www.skynovels.net/novelas/" + e;
  if (kind === "matchanovels") return "https://matchanovels.com/novela/" + e;
  if (kind === "astral") return "https://astralnovelstranslations.wordpress.com/category/" + e + "/";
  if (kind === "madara") return SOURCES[src].host + "/novela/" + e + "/";
  if (kind === "devilnovels") return "https://devilnovels.com/" + e; // las novelas viven en la raíz del dominio
  if (kind === "zonatmoorg") return SOURCES[src].host + "/library/" + String(slug || "").split(".").map(encodeURIComponent).join("/") + "/";
  if (kind === "olympus") {
    const raw = String(slug || "");
    const pref = raw.startsWith("n.") ? "novela-" : "comic-";
    return SOURCES[src].host + "/series/" + pref + encodeURIComponent(raw.replace(/^[cn]\./, ""));
  }
  if (kind === "leercapitulo") {
    const d = lc.decodeLcSlug(slug);
    return SOURCES[src].host + "/manga/" + encodeURIComponent(d.shortId) + "/" + encodeURIComponent(d.tail) + "/";
  }
  if (kind === "ikigai") return SOURCES[src].host + "/series/" + e + "/";
  if (kind === "lectorfenix") return SOURCES[src].host + "/comics/" + e;
  if (kind === "mhscans") return SOURCES[src].host + "/comics/" + e;
  if (kind === "manhwaweb") return SOURCES[src].host + "/manhwa/" + e;
  return SOURCES[src].host + "/manga/" + e + "/";
}

function deviceCols(ctx) {
  const c = ctx.size && ctx.size.widthClass;
  if (ctx.device === "tv") return 6;
  if (c === "compact") return 3;
  if (c === "medium") return 4;
  return 6;
}

// ---------- vista: detalle ----------

const DESC_CORTA = 240;
const DESC_LARGA = 4000;

/** Descripción con «Ver más»/«Ver menos» cuando se corta. */
function descNode(overview, state, en) {
  if (!overview) return null;
  const txt = String(overview);
  const abierta = Boolean(state.descOpen);
  if (txt.length <= DESC_CORTA) return { type: "Text", text: txt, style: "body", padding: { x: 16, y: 8 } };
  const visto = abierta ? txt.slice(0, DESC_LARGA) + (txt.length > DESC_LARGA ? "…" : "") : txt.slice(0, DESC_CORTA).replace(/\s+\S*$/, "") + "…";
  return {
    type: "Column", padding: { x: 16, y: 8 }, gap: 4,
    children: [
      { type: "Text", text: visto, style: "body" },
      { type: "TextButton", labelText: abierta ? (en ? "See less" : "Ver menos") : (en ? "See more" : "Ver más"), labelTextEn: abierta ? "See less" : "See more", onPressed: { event: "descToggle" } },
    ],
  };
}

/** Orden de la lista de capítulos por su número (1, 1.2, 2, 10…), estable; lo que no parsea
 *  conserva su orden original. desc = invertir (recientes arriba). */
function ordenarCaps(list, orden) {
  const conIdx = (list || []).map((c, i) => ({ c, i, n: Number(c.n) }));
  conIdx.sort((a, b) => {
    const an = Number.isFinite(a.n), bn = Number.isFinite(b.n);
    if (an && bn && a.n !== b.n) return a.n - b.n;
    if (an !== bn) return an ? -1 : 1;
    return a.i - b.i;
  });
  const asc = conIdx.map((x) => x.c);
  return orden === "desc" ? asc.slice().reverse() : asc;
}

function viewDetalle(ctx) {
  const { state, device, lang } = ctx;
  const d = state.detail;
  const en = lang === "en";
  if (state.busyDetail && !d) {
    return scaffold("Cargando", "Loading", ctx, { type: "Column", padding: 16, gap: 12, children: [
      { type: "Row", gap: 12, children: [{ type: "Skeleton", shape: "card", width: 120, height: 160 }, { type: "Column", gap: 8, flex: 1, children: [{ type: "Skeleton", shape: "line", height: 24 }, { type: "Skeleton", shape: "line", height: 16 }, { type: "Skeleton", shape: "line", height: 16 }] }] },
    ] }, {});
  }
  if (!d) return scaffold("Detalle", "Detail", ctx, errorBox(state.error || "Faltan datos"));

  const srcName = SOURCES[d.src] ? SOURCES[d.src].name : "";
  const posterCard = {
    type: "Card",
    flush: true,
    borderRadius: "medium",
    elevation: 8,
    width: 120,
    children: [
      { type: "Image", url: d.poster, headers: imgHeads(d.poster), aspect: "2:3", fit: "cover", width: 120, alt: d.title, altEn: d.title, fallback: { type: "Column", width: 120, height: 160, background: "surfaceVariant", borderRadius: "medium" } },
    ],
  };

  const header = {
    type: "Column", gap: 12, padding: 16,
    children: [
      { type: "Row", mainAxisAlignment: "spaceBetween", crossAxisAlignment: "center", children: [
        { type: "Badge", text: srcName || "Fuente", color: "primary" },
        d.status ? { type: "Badge", text: String(d.status).slice(0, 24), color: "surface" } : null,
      ].filter(Boolean) },
      { type: "Row", crossAxisAlignment: "start", gap: 16, children: [
        posterCard,
        { type: "Column", flex: 1, gap: 8, children: [
          { type: "Text", text: d.title, style: "h2", canRequestFocus: device === "tv" ? true : undefined },
          d.demography ? { type: "Text", text: String(d.demography), style: "caption", color: "primary" } : null,
          d.score ? { type: "Text", text: "★ " + d.score + (d.total ? "  ·  " + d.total + " caps" : ""), style: "body", color: "muted" } : (d.total ? { type: "Text", text: d.total + " caps", style: "body", color: "muted" } : null),
          d.genres && d.genres.length ? { type: "Chips", key: "gens", value: d.genres[0], options: d.genres.slice(0, 4).map((g) => ({ value: g, label: g })) } : null,
        ].filter(Boolean) },
      ] },
    ],
  };

  const prog = state.prog || null;
  // orden de la lista: preferencia del usuario (persistente) o cronológico ascendente
  const orden = state.capsOrder || (kino.storage.get("capsOrden") === "desc" ? "desc" : "asc");
  const cronologica = ordenarCaps(d.chapters, "asc");
  const actions = [];
  if (prog && prog.cr) {
    actions.push({ type: "ElevatedButton", variant: "primary", icon: "play", labelText: "Seguir: Cap. " + prog.n, labelTextEn: "Continue: Ch. " + prog.n, onPressed: { event: "cap", arg: prog.cr }, span: 12, fill: true });
  }
  if (d.chapters.length) {
    // primero y último son CRONOLÓGICOS: con la lista en desc no se intercambian
    const first = cronologica[0];
    const last = cronologica[cronologica.length - 1];
    actions.push({ type: prog && prog.cr ? "Button" : "ElevatedButton", variant: prog && prog.cr ? "secondary" : "primary", labelText: "Primero (" + first.n + ")", labelTextEn: "First (" + first.n + ")", onPressed: { event: "cap", arg: first.r }, span: 6, fill: true });
    actions.push({ type: "Button", variant: "secondary", labelText: "Último (" + last.n + ")", labelTextEn: "Last (" + last.n + ")", onPressed: { event: "cap", arg: last.r }, span: 6, fill: true });
  }
  const siteUrl = siteUrlOf(d.src, d.slug);
  const favOn = state.fav != null ? Boolean(state.fav) : Boolean(favsAll()[state.detailRef]);
  const tagCur = state.bibTagCur !== undefined ? state.bibTagCur : ((biblioAll()[state.detailRef] || {}).tag || null);
  const bibOpen = Boolean(state.bibOpen) || Boolean(tagCur);
  const shown = (state.chShow || 60);
  const ocultar = Boolean(kino.config.get("ocultarPago") === true || kino.config.get("ocultarPago") === "true");
  const conPago = d.chapters.filter((c) => c.pago);
  // la lista respeta el orden elegido (se aplica al momento, sobre lo ya cargado)
  const ordenada = ordenarCaps(ocultar ? d.chapters.filter((c) => !c.pago) : d.chapters, orden);
  const visibles = ordenada.slice(0, shown);
  const richTiles = visibles.length <= 90;
  const chList = visibles.map((c, i) => ({
    type: "ListTile",
    key: "ch" + i,
    dense: true,
    borderRadius: "medium",
    background: "surfaceVariant",
    border: { width: 1, color: "surface" },
    margin: { x: 16, y: 4 },
    leading: richTiles ? { type: "CircleAvatar", text: String(c.n).slice(0, 3), radius: 16, backgroundColor: "primaryContainer", labelText: "Cap. " + c.n } : undefined,
    title: "Cap. " + c.n,
    titleEn: "Ch. " + c.n,
    subtitle: c.t && c.t !== "Capítulo " + c.n ? String(c.t).slice(0, 48) : undefined,
    trailing: c.pago ? { type: "Icon", name: "lock", color: "warning" } : (richTiles ? { type: "Icon", name: "play", color: "primary" } : undefined),
    onTap: { event: "cap", arg: c.r },
  }));

  const ov = descNode(d.overview, state, en);
  const kids = [
    { type: "Card", key: "tarjeta", variant: "filled", background: "surfaceVariant", border: { width: 1, color: "primary" }, borderRadius: "large", elevation: 12, margin: { x: 16, y: 8 }, children: [header] },
    ...(actions.length ? [{ type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: actions }] : []),
    { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 4 }, children: [
      { type: "Button", variant: favOn ? "primary" : "secondary", selected: favOn, icon: "heart", labelText: favOn ? "Te gusta" : "Me Gusta", labelTextEn: favOn ? "Liked" : "Like", onPressed: { event: "fav" }, span: 6, fill: true },
      { type: "Button", variant: tagCur ? "primary" : "secondary", selected: Boolean(tagCur), icon: "bookmark", labelText: "Agregar a Biblioteca", labelTextEn: "Add to Library", onPressed: { event: "bibOpen" }, span: 6, fill: true },
    ] },
    bibOpen ? { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 4 }, children: BIB_TAGS.map((t) => ({
      type: "Button", variant: t.k === tagCur ? "primary" : "secondary", icon: t.k === tagCur ? "check" : undefined, labelText: t.t, labelTextEn: t.te, onPressed: { event: "biblio", arg: t.k }, span: 3, fill: true,
    })).concat(tagCur ? [{ type: "TextButton", icon: "close", labelText: "Quitar etiqueta", labelTextEn: "Remove tag", onPressed: { event: "biblio", arg: "quitar" }, span: 12, fill: true }] : []) } : null,
    { type: "Button", variant: "secondary", icon: "language", labelText: "Abrir en el navegador", labelTextEn: "Open in browser", onPressed: { go: { url: { href: siteUrl, title: String(d.title).slice(0, 60) } } }, fill: true, padding: { x: 16, y: 4 } },
    ov ? { type: "Card", variant: "outlined", border: { width: 1, color: "surface" }, background: "surfaceVariant", borderRadius: "large", margin: { x: 16, y: 8 }, children: [ov] } : null,
    ocultar && conPago.length ? { type: "Text", text: conPago.length + " capítulo(s) de pago oculto(s) (ajustable en Ajustes).", textEn: conPago.length + " paid chapter(s) hidden (toggle in Settings).", style: "body", color: "muted", padding: { x: 16, y: 4 } } : null,
    !ocultar && conPago.length ? { type: "Text", text: conPago.length + " capítulo(s) con candado requieren cuenta premium de la fuente.", textEn: conPago.length + " locked chapter(s) need a premium account on the source.", style: "body", color: "muted", padding: { x: 16, y: 4 } } : null,
    // filtro de orden de capítulos: se aplica al instante y queda guardado para las próximas
    d.chapters.length > 1 ? { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 4 }, children: [
      { type: "Button", variant: orden === "asc" ? "primary" : "secondary", icon: "expand_less", labelText: "Antiguos primero", labelTextEn: "Oldest first", onPressed: { event: "capsOrder", arg: "asc" }, span: 6, fill: true },
      { type: "Button", variant: orden === "desc" ? "primary" : "secondary", icon: "expand_more", labelText: "Recientes primero", labelTextEn: "Newest first", onPressed: { event: "capsOrder", arg: "desc" }, span: 6, fill: true },
    ] } : null,
    // búsqueda de capítulos (dv: el AJAX del sitio busca en TODA la obra, RCA 2026-11)
    d.src === "dv" ? { type: "Column", padding: { x: 16, y: 4 }, children: [
      { type: "TextField", key: "capq", kind: "search", labelText: "Buscar capítulo por número o título", labelTextEn: "Search chapter by number or title", value: d.capsQ || "", onSubmitted: "capq", onTrailingTap: "capq", trailingIcon: "search", trailingLabel: "Buscar" },
    ] } : null,
    d.chapters.length ? { type: "Column", children: chList } : empty(d.capsQ ? "Sin resultados para «" + d.capsQ + "»" : "Sin capítulos listados", d.capsQ ? "No results for \"" + d.capsQ + "\"" : "No chapters listed"),
    d.chapters.length > shown ? { type: "TextButton", labelText: "Ver más capítulos (" + (d.chapters.length - shown) + " más)", labelTextEn: "More chapters", onPressed: { event: "chMas" }, padding: 16 } : null,
    d.chapters.length && d.next ? { type: "TextButton", labelText: "Cargar más de la fuente" + (d.total ? " (" + d.chapters.length + " de " + d.total + ")" : ""), labelTextEn: "Load more from source" + (d.total ? " (" + d.chapters.length + " of " + d.total + ")" : ""), onPressed: { event: "caps" }, padding: { x: 16, y: 4 } } : null,
  ].filter(Boolean);
  return scaffold(String(d.title).slice(0, 30), String(d.title).slice(0, 30), ctx, { type: "SingleChildScrollView", children: kids }, { share: device !== "tv" ? { label: en ? "Share" : "Compartir" } : undefined, navValue: "home", bottomBar: true });
}

// ---------- vista: lector ----------

/** Panel desplegable (BottomSheet) con los ajustes del lector Studio para novela o manga dentro de Kino. */
function readerConfigSheet(c, rp, en) {
  const isNov = Boolean(c.text && c.text.length);
  const children = [];
  if (isNov) {
    children.push(
      { type: "Text", text: "Superficie del papel", textEn: "Paper surface", style: "caption", color: "primary" },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.novelSurface === "surface" ? "primary" : "secondary", labelText: "Obsidiana", labelTextEn: "Obsidian", onPressed: { event: "rpref", arg: "novelSurface:surface" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelSurface === "surfaceVariant" ? "primary" : "secondary", labelText: "Ahumado", labelTextEn: "Smoked", onPressed: { event: "rpref", arg: "novelSurface:surfaceVariant" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelSurface === "primaryContainer" ? "primary" : "secondary", labelText: "Tinte suave", labelTextEn: "Tinted", onPressed: { event: "rpref", arg: "novelSurface:primaryContainer" }, flex: 1, fill: true },
      ] },
      { type: "Text", text: "Tamaño tipográfico", textEn: "Text scale", style: "caption", color: "primary" },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.novelSize === "p" ? "primary" : "secondary", labelText: "Compacto", labelTextEn: "Compact", onPressed: { event: "rpref", arg: "novelSize:p" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelSize === "h5" ? "primary" : "secondary", labelText: "Cómodo", labelTextEn: "Comfy", onPressed: { event: "rpref", arg: "novelSize:h5" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelSize === "h4" ? "primary" : "secondary", labelText: "Grande", labelTextEn: "Large", onPressed: { event: "rpref", arg: "novelSize:h4" }, flex: 1, fill: true },
      ] },
      { type: "Text", text: "Ancho de columna y espaciado", textEn: "Column width & spacing", style: "caption", color: "primary" },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.novelWidth === 32 ? "primary" : "secondary", labelText: "Estrecho", labelTextEn: "Narrow", onPressed: { event: "rpref", arg: "novelWidth:32" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelWidth === 24 ? "primary" : "secondary", labelText: "Editorial", labelTextEn: "Editorial", onPressed: { event: "rpref", arg: "novelWidth:24" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelWidth === 16 ? "primary" : "secondary", labelText: "Completo", labelTextEn: "Full", onPressed: { event: "rpref", arg: "novelWidth:16" }, flex: 1, fill: true },
      ] },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.novelAlign === "start" ? "primary" : "secondary", labelText: "Izquierda", labelTextEn: "Left", onPressed: { event: "rpref", arg: "novelAlign:start" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelAlign === "justify" ? "primary" : "secondary", labelText: "Justificado", labelTextEn: "Justify", onPressed: { event: "rpref", arg: "novelAlign:justify" }, flex: 1, fill: true },
      ] },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.novelGap === 4 ? "primary" : "secondary", labelText: "Párrafo denso", labelTextEn: "Tight", onPressed: { event: "rpref", arg: "novelGap:4" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelGap === 8 ? "primary" : "secondary", labelText: "Balanceado", labelTextEn: "Balanced", onPressed: { event: "rpref", arg: "novelGap:8" }, flex: 1, fill: true },
        { type: "Button", variant: rp.novelGap === 12 ? "primary" : "secondary", labelText: "Aireado", labelTextEn: "Airy", onPressed: { event: "rpref", arg: "novelGap:12" }, flex: 1, fill: true },
      ] }
    );
  } else {
    children.push(
      { type: "Text", text: "Modo de lectura", textEn: "Reading mode", style: "caption", color: "primary" },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.mangaMode === "auto" ? "primary" : "secondary", labelText: "Auto", labelTextEn: "Auto", onPressed: { event: "rpref", arg: "mangaMode:auto" }, flex: 1, fill: true },
        { type: "Button", variant: rp.mangaMode === "pages" ? "primary" : "secondary", labelText: "Paginado", labelTextEn: "Paged", onPressed: { event: "rpref", arg: "mangaMode:pages" }, flex: 1, fill: true },
        { type: "Button", variant: rp.mangaMode === "strip" ? "primary" : "secondary", labelText: "Cascada", labelTextEn: "Strip", onPressed: { event: "rpref", arg: "mangaMode:strip" }, flex: 1, fill: true },
      ] },
      { type: "Text", text: "Dirección en Paginado", textEn: "Paged direction", style: "caption", color: "primary" },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.mangaDir === "auto" ? "primary" : "secondary", labelText: "Auto", labelTextEn: "Auto", onPressed: { event: "rpref", arg: "mangaDir:auto" }, flex: 1, fill: true },
        { type: "Button", variant: rp.mangaDir === "rtl" ? "primary" : "secondary", labelText: "Manga (Der→Izq)", labelTextEn: "Manga (RTL)", onPressed: { event: "rpref", arg: "mangaDir:rtl" }, flex: 1, fill: true },
        { type: "Button", variant: rp.mangaDir === "ltr" ? "primary" : "secondary", labelText: "Cómic (Izq→Der)", labelTextEn: "Comic (LTR)", onPressed: { event: "rpref", arg: "mangaDir:ltr" }, flex: 1, fill: true },
      ] },
      { type: "Text", text: "Encuadre de láminas", textEn: "Page framing", style: "caption", color: "primary" },
      { type: "Row", gap: 8, children: [
        { type: "Button", variant: rp.mangaFrame === "edge" ? "primary" : "secondary", labelText: "Sin bordes", labelTextEn: "Edge to edge", onPressed: { event: "rpref", arg: "mangaFrame:edge" }, flex: 1, fill: true },
        { type: "Button", variant: rp.mangaFrame === "framed" ? "primary" : "secondary", labelText: "Enmarcado", labelTextEn: "Framed", onPressed: { event: "rpref", arg: "mangaFrame:framed" }, flex: 1, fill: true },
      ] }
    );
  }
  return {
    type: "BottomSheet",
    key: "readerCfg",
    title: isNov ? "Estudio Editorial" : "Estudio de Lectura",
    titleEn: isNov ? "Editorial Studio" : "Reading Studio",
    children: [{ type: "Column", gap: 12, padding: 16, children }],
  };
}

function viewLeer(ctx) {
  const { state } = ctx;
  const c = state.chapter;
  if (state.busyChapter && !c) return scaffold("Capítulo", "Chapter", ctx, { type: "Column", padding: 16, children: [{ type: "Skeleton", shape: "card", width: 400, height: 320 }] });
  if (!c) return scaffold("Capítulo", "Chapter", ctx, errorBox(state.error || "Faltan datos"));
  const enL = (ctx.lang === "en");
  const rp = state.rprefs || readRPrefs();
  const isNov = Boolean(c.text && c.text.length);
  const curIdx = isNov ? 0 : Math.min(Math.max(0, state.pagIdx != null ? state.pagIdx : ((c.resumePage || 1) - 1)), Math.max(0, (c.pages || []).length - 1));
  const curFrac = !isNov && c.pages && c.pages.length ? Math.max(0.02, Math.min(1, (curIdx + 1) / c.pages.length)) : undefined;

  const nav = [
    c.prev ? { type: "Button", variant: "secondary", icon: "arrow_back", labelText: "Anterior", labelTextEn: "Previous", onPressed: { event: "nav", arg: c.prev }, flex: 1, fill: true } : { type: "SizedBox", width: 16, flex: 1 },
    { type: "TextButton", icon: "tune", labelText: isNov ? "Cap. " + c.number + " · Ajustes" : "Cap. " + c.number + " · " + (curIdx + 1) + "/" + (c.total || 1), labelTextEn: isNov ? "Ch. " + c.number + " · Style" : "Ch. " + c.number + " · " + (curIdx + 1) + "/" + (c.total || 1), onPressed: { ui: [{ open: "readerCfg" }] }, flex: 2, fill: true },
    c.next ? { type: "Button", variant: "primary", icon: "arrow_forward", labelText: "Siguiente", labelTextEn: "Next", onPressed: { event: "nav", arg: c.next }, flex: 1, fill: true } : { type: "SizedBox", width: 16, flex: 1 },
  ];

  const footerBar = {
    type: "Card",
    variant: "filled",
    background: "surfaceVariant",
    border: { width: 1, color: "surface" },
    padding: { x: 12, y: 8 },
    children: [
      { type: "Column", gap: 4, children: [
        curFrac !== undefined ? { type: "LinearProgressIndicator", value: curFrac } : null,
        { type: "Row", gap: 8, crossAxisAlignment: "center", children: nav },
      ].filter(Boolean) },
    ],
  };

  const kids = [];
  if (c.text && c.text.length) {
    // Modo novela: ListView (el nodo perezoso de la lista; solo se construye lo visible),
    // cabecera editorial, limpieza de Markdown, ilustraciones y progreso por scroll vía «scr».
    const rawList = c.text.slice(0, 440);
    const words = rawList.reduce((acc, p) => acc + String(p || "").trim().split(/\s+/).filter(Boolean).length, 0);
    const readMin = Math.max(1, Math.round(words / 210));
    const bloques = [
      {
        type: "Card",
        variant: "filled",
        background: "surfaceVariant",
        border: { width: 1, color: "primary" },
        borderRadius: "large",
        margin: { x: 16, y: 12 },
        padding: 16,
        children: [{
          type: "Column", gap: 8, children: [
            c.mTitle ? { type: "Text", text: String(c.mTitle).toUpperCase(), style: "caption", color: "primary" } : null,
            { type: "Text", text: c.title || ("Capítulo " + c.number), style: "h2" },
            { type: "Text", text: (enL ? "Chapter " : "Capítulo ") + c.number + "  ·  ~" + readMin + (enL ? " min read" : " min de lectura"), style: "caption", color: "muted" },
          ].filter(Boolean),
        }],
      },
    ];
    if (c.imgs && c.imgs.length) {
      for (const u of c.imgs.slice(0, 20)) bloques.push({ type: "Image", url: u, headers: imgHeads(u), aspect: "2:3", fit: "width", alt: "Ilustración", altEn: "Illustration", padding: { x: 16, y: 8 } });
    }
    for (const rawPar of rawList) {
      const parsed = parseNovelParagraph(rawPar);
      if (!parsed) continue;
      if (parsed.kind === "break") {
        bloques.push({ type: "Text", text: "·   ·   ·", style: "h4", color: "primary", textAlign: "center", padding: { x: rp.novelWidth, y: 12 } });
      } else if (parsed.kind === "heading") {
        bloques.push({ type: "Text", text: parsed.text, style: "h4", bold: true, color: "primary", padding: { x: rp.novelWidth, y: 12 } });
      } else {
        bloques.push({ type: "Text", text: parsed.text, style: rp.novelSize, textAlign: rp.novelAlign, padding: { x: rp.novelWidth, y: rp.novelGap } });
      }
    }
    bloques.push({
      type: "Card",
      variant: "outlined",
      border: { width: 1, color: "primary" },
      borderRadius: "large",
      margin: 16,
      padding: 16,
      children: [{
        type: "Column", gap: 8, children: [
          { type: "Text", text: (enL ? "End of Chapter " : "Fin del capítulo ") + c.number, style: "h4", textAlign: "center" },
          c.next ? { type: "ElevatedButton", variant: "primary", icon: "arrow_forward", labelText: "Siguiente capítulo", labelTextEn: "Next chapter", onPressed: { event: "nav", arg: c.next }, fill: true } : null,
        ].filter(Boolean),
      }],
    });
    kids.push({
      type: "Column", flex: 1, background: rp.novelSurface,
      children: [{ type: "ListView", key: "novela-" + (c.tk || 0), items: bloques, flex: 1 }],
    });
    kids.push(footerBar);
  } else if (c.direction === "rtl" && c.pages.length >= 2 && c.pages.length <= (pagesDisponible() ? 250 : 8) && rp.mangaMode !== "strip" || (rp.mangaMode === "pages" && c.pages.length >= 2 && c.pages.length <= (pagesDisponible() ? 250 : 8))) {
    // modo páginas: con la página guardada del capítulo se retoma donde se quedó (initialPage)
    const rev = rp.mangaDir === "auto" ? c.direction === "rtl" : rp.mangaDir === "rtl";
    const padX = rp.mangaFrame === "framed" ? 12 : 0;
    kids.push({
      type: "pages",
      key: "manga-pages-" + (c.tk || 0),
      flex: 1,
      reverse: rev,
      progress: "bar",
      onPageChanged: "pag",
      initialPage: c.resumePage > 1 ? Math.max(0, Math.min(c.resumePage, c.pages.length) - 1) : 0,
      children: c.pages.map((u, i) => ({
        type: "SingleChildScrollView", key: "pg" + (c.tk || 0) + "-" + i, zoom: true, onScroll: "scr", children: [
          { type: "Image", url: u, headers: imgHeads(u), aspect: "2:3", fit: "width", padding: { x: padX, y: padX }, alt: "Página " + (i + 1), altEn: "Page " + (i + 1) },
        ],
      })),
    });
    kids.push(footerBar);
  } else {
    // tira vertical (webtoon): clave por apertura = siempre página 1 al cambiar de capítulo;
    // costura continua (padding y: 0) para lectura sin cortes negros entre viñetas
    const padX = rp.mangaFrame === "framed" ? 12 : 0;
    if (c.resumePage > 1 && c.total) {
      kids.push({ type: "Text", text: "Estabas por la página " + c.resumePage + " de " + c.total, textEn: "You were around page " + c.resumePage + " of " + c.total, style: "caption", color: "primary", padding: { x: 16, y: 4 } });
    }
    kids.push({
      type: "SingleChildScrollView", key: "tira-" + (c.tk || 0), flex: 1, zoom: true, onScroll: "scr",
      children: [{ type: "Column", gap: padX, children: c.pages.map((u, i) => ({ type: "Image", url: u, headers: imgHeads(u), aspect: "600:2400", fit: "width", alt: "Página " + (i + 1), altEn: "Page " + (i + 1), padding: { x: padX, y: 0 } })) }],
    });
    kids.push(footerBar);
  }
  kids.push(readerConfigSheet(c, rp, enL));
  // Inmersión: en el lector no hay barra de navegación; el regreso es el botón de atrás de la AppBar,
  // junto a «Ajustes de lectura» (BottomSheet) y salto rápido entre capítulos.
  const barActions = [
    { type: "IconButton", icon: "tune", labelText: "Estilo de lectura", labelTextEn: "Reader style", onPressed: { ui: [{ open: "readerCfg" }] } },
  ];
  if (c.prev) barActions.push({ type: "IconButton", icon: "arrow_back", labelText: "Capítulo anterior", labelTextEn: "Previous chapter", onPressed: { event: "nav", arg: c.prev } });
  if (c.next) barActions.push({ type: "IconButton", icon: "arrow_forward", labelText: "Siguiente capítulo", labelTextEn: "Next chapter", onPressed: { event: "nav", arg: c.next } });
  const titleText = (c.mTitle ? String(c.mTitle).slice(0, 20) + " · " : "") + "Cap. " + c.number;
  const root = scaffold(titleText, "Ch. " + c.number, ctx, { type: "Column", crossAxisAlignment: "stretch", children: kids }, { actions: barActions });
  root.layout = "fill"; // el ListView del texto necesita pantalla completa para desplazarse él solo
  return root;
}

// ---------- vista: ajustes ----------

/** Tarjeta de pre-clearance: una fila por fuente con muro conocido (estado real de la jarra). */
function cfCard(en) {
  const kids = [];
  for (const k of ["zo", "dv", "sk"]) {
    const base = FUENTES_URL[k];
    if (!base || !SOURCES[k]) continue;
    const st = cfStatus(base);
    let estado = en ? "no session saved" : "sin sesión guardada";
    if (st && st.cookie) estado = (en ? "cookie " : "cookie ") + st.cookie.names.join(", ") + (en ? " saved, " : " guardada, hace ") + st.cookie.ageH + " h";
    if (st && st.kind) estado += (en ? " · the source answers a " : " · la fuente responde ") + (st.kind === "blocked" ? (en ? "block rule" : "regla de bloqueo") : (en ? "challenge" : "desafío"));
    kids.push({ type: "Row", gap: 4, padding: { x: 16, y: 4 }, children: [
      { type: "Text", text: SOURCES[k].name + ": " + estado, textEn: SOURCES[k].name + ": " + estado, style: "body", expand: true },
      { type: "TextButton", labelText: "Resolver", labelTextEn: "Solve", onPressed: { event: "cfAbrir", arg: k } },
      ...(st && st.cookie ? [{ type: "TextButton", labelText: "Borrar", labelTextEn: "Clear", onPressed: { event: "cfBorrar", arg: k } }] : []),
    ] });
  }
  return kids;
}

function viewAjustes(ctx) {
  const en = ctx.lang === "en";
  const active = ctx.activeTheme || null;
  const kids = [
    { type: "Text", text: "Cuentas y ajustes del plugin. También están en Ajustes ▸ Plugins ▸ Multi-verso Kin.", textEn: "Accounts and plugin settings. Also in Settings ▸ Plugins ▸ Multi-verso Kin.", style: "body", padding: 16 },
    { type: "settings", keys: ["cuentas", "zt_user", "zt_pass", "log_zt", "zt_token", "win_zt", "ms_user", "ms_pass", "log_ms", "ms_cookie", "win_ms", "ocultarPago", "salir"], onSaved: "saved" },
    { type: "Text", text: "Pre-clearance de Cloudflare", textEn: "Cloudflare pre-clearance", style: "h4", padding: { x: 16, y: 8 } },
    ...cfCard(en),
    { type: "Text", text: "«Resolver» abre el sitio en una ventana del plugin: completa el desafío una vez y Kino guarda su cookie de sesión (cf_clearance) para esa fuente; las siguientes peticiones la llevan solas mientras la cookie valga. Si el sitio bloquea por regla de IP o firma del navegador, la cookie no basta: prueba otra red (Wi-Fi o datos móviles) o más tarde.", textEn: "«Solve» opens the site in a plugin window: complete the challenge once and Kino keeps its session cookie (cf_clearance) for that source; the next requests carry it automatically while it stays valid. If the site blocks by an IP or browser-signature rule, the cookie is not enough: try another network or later.", style: "body", color: "muted", padding: { x: 16, y: 8 } },
    { type: "Text", text: "Temas de la app (8)", textEn: "App themes (8)", style: "h4", padding: { x: 16, y: 8 } },
    { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: THEMES.map((t) => ({
      type: "Button", variant: active === t.id ? "primary" : "secondary", icon: active === t.id ? "check" : "magic", selected: active === t.id,
      labelText: t.name.es, labelTextEn: t.name.en, onPressed: { go: { useTheme: { theme: t.id } } }, span: 6, fill: true,
    })) },
    { type: "TextButton", icon: "refresh", labelText: "Quitar tema personalizado", labelTextEn: "Reset custom theme", onPressed: { go: { useTheme: { theme: null } } }, padding: { x: 16, y: 4 } },
    { type: "Text", text: "Un tema se aplica a TODA la app, también a estas páginas, mientras lo tengas puesto; también puedes cambiarlo desde el icono de varita en Inicio o en Ajustes ▸ Apariencia.", textEn: "A theme applies to the WHOLE app, these pages included, while it is on; switch it from the wand icon on Home or Settings ▸ Appearance.", style: "body", color: "muted", padding: 16 },
  ];
  return scaffold("Ajustes", "Settings", ctx, { type: "SingleChildScrollView", children: kids }, { navValue: "home", bottomBar: true });
}

// ---------- screen(ctx) ----------

export async function screen(ctx) {
  const route = (ctx.route && ctx.route.name) || "main";
  switch (route) {
    case "buscar": return viewBuscar(ctx);
    case "biblioteca": return viewBiblioteca(ctx);
    case "detalle": return viewDetalle(ctx);
    case "leer": return viewLeer(ctx);
    case "ajustes": return viewAjustes(ctx);
    case "fuente": return viewFuente(ctx);
    case "main":
    default: return viewMain(ctx);
  }
}

// ---------- screenEvent(ctx) ----------

export async function screenEvent(ctx) {
  const { name, arg, value, state, lang } = ctx;
  const en = lang === "en";
  switch (name) {
    case "open":
      return handleOpen(ctx);

    case "atras":
      if (!ctx.route || !ctx.route.name || ctx.route.name === "main") return { close: true };
      return { route: { pop: true } };

    case "reintentar": {
      if (ctx.route && ctx.route.name === "fuente") {
        const cur = state && state.fuente;
        const rArg = String(arg || (cur && cur.ref) || "");
        const p = parseBrowseRef(rArg);
        const s = (cur && cur.src) || (p && p.src) || (state && state.hsrc) || "zt";
        const f = await loadFuenteCategory(s, rArg || defaultRefFor(s), null, en);
        return { state: { fuente: f } };
      }
      return handleOpen(ctx);
    }

    case "nada":
      return null;

    case "navBar": {
      const key = String(value || "");
      const here = (ctx.route && ctx.route.name) || "main";
      if (key === "home") {
        if (here === "main") return { state: { hideBar: false, lastPos: 0 } }; // ya estás en Inicio
        return { route: { pop: true } }; // volver hacia Inicio, paso a paso
      }
      if (key === "biblioteca") return here === "biblioteca" ? null : { route: { push: "biblioteca" } };
      if (key === "ajustes") return here === "ajustes" ? null : { route: { push: "ajustes" } };
      return null;
    }

    case "tabSrc": {
      // Pestaña del Home: cambia de fuente y trae sus secciones nativas (caché primero).
      const src = String(arg || value || "zt");
      if (!SOURCES[src]) return null;
      const cached = cacheGet(cacheKey("home", src), TTL.rows);
      if (cached && cached.length && cached[0].ref) return { state: { hsrc: src, hrows: cached, herr: null, cf: false, capsOpen: false } };
      const sh = await loadHomeShelves(src, en);
      return { state: { hsrc: src, hrows: sh.shelves, herr: sh.err, cf: Boolean(sh.cf), cfKind: sh.cfKind || null, error: null, done: true, capsOpen: false } };
    }

    case "catSel": {
      const targetRef = String(value || arg || "");
      const parsed = parseBrowseRef(targetRef);
      if (!parsed || !SOURCES[parsed.src]) return null;
      const f = await loadFuenteCategory(parsed.src, targetRef, null, en);
      return { state: { fuente: f } };
    }

    case "catMas": {
      const cur = state && state.fuente;
      if (!cur || !cur.next || cur.loadingMore) return null;
      const more = await loadFuenteCategory(cur.src, cur.ref, cur.next, en);
      if (more.err && !more.items.length) {
        return { toast: more.err, state: { fuente: { ...cur, loadingMore: false, next: null } } };
      }
      const seen = new Set((cur.items || []).map((x) => x.s));
      const merged = (cur.items || []).slice();
      for (const it of more.items || []) {
        if (!seen.has(it.s)) {
          seen.add(it.s);
          merged.push(it);
        }
      }
      return {
        state: {
          fuente: {
            ...cur,
            items: merged,
            next: more.next || null,
            loadingMore: false,
          },
        },
      };
    }

    case "cfAbrir": {
      // PRE-CLEARANCE: la persona resuelve el desafío UNA VEZ en la ventana del sitio (Turnstile)
      // y Kino entrega cf_clearance; fetchText la manda después en cada petición a ese host, así
      // que las siguientes llamadas pasan sin volver a retar mientras la cookie siga válida.
      // El detalle llega con un ref compuesto («zo|m|slug»): se extrae la fuente.
      const argL = String(arg || "");
      const fsrc = argL.indexOf("|") >= 0 ? argL.split("|")[0] : String(arg || (state && state.hsrc) || "");
      const base = FUENTES_URL[fsrc];
      if (!base || !SOURCES[fsrc]) return null;
      const host = base.replace(/^https?:\/\//, "");
      const vb = kino.visualBrowser;
      const disponible = Boolean(vb && typeof vb.open === "function" && vb.available !== false);
      if (ctx.device === "tv" || !disponible) {
        return { toast: en ? "The visual browser needs Kino 0.9.81 or newer on this device" : "El navegador visual necesita Kino 0.9.81 o más nuevo en este dispositivo" };
      }
      let r = null;
      try {
        r = await kino.visualBrowser.open({
          url: base + "/",
          title: "Cloudflare · " + SOURCES[fsrc].name,
          userAgent: UA,
          doneWhen: { cookies: ["cf_clearance"] },
          collect: { cookies: ["cf_clearance", "__cf_bm"], html: false, finalUrl: false },
        });
      } catch (e) {
        const code = String((e && e.message) || e);
        if (code.indexOf("busy") >= 0) return { toast: en ? "A window is already open" : "Ya hay una ventana abierta" };
        return { toast: (en ? "Could not open the window: " : "No se pudo abrir la ventana: ") + code.slice(0, 60) };
      }
      if (r && r.status === "done" && r.cookies && r.cookies.cf_clearance) {
        try { cfSaveCookies(host, r.cookies); } catch { /* sigue */ }
        // VERIFICACIÓN con una petición real (la cookie entra sola por la jarra): el resultado
        // decide el mensaje y nunca se promete algo que no funcionó.
        let kind = null;
        try {
          const ctrl = await fetchText(base + "/", { timeoutMs: 12000 });
          kind = cfClassify(ctrl.status, ctrl.text);
        } catch { /* sin red: la cookie se queda y la recarga lo contará */ }
        if (kind === null) {
          try { cfClearChallenge(host); } catch { /* sigue */ }
          try {
            const sh = await loadHomeShelves(fsrc, en);
            return {
              toast: en ? "Pre-clearance active: the source answers again" : "Pre-clearance activa: la fuente ya responde",
              state: { hsrc: fsrc, hrows: sh.shelves, herr: sh.err, cf: Boolean(sh.cf), cfKind: sh.cfKind || null, done: true },
            };
          } catch { /* la recarga puede fallar en red: la cookie queda guardada igual */ }
          return { toast: en ? "Pre-clearance active" : "Pre-clearance activa" };
        }
        if (kind === "blocked") {
          return { toast: en ? "The site still blocks plugin requests (IP or browser-signature rule): try another network or later" : "El sitio sigue bloqueando las peticiones (regla por IP o firma del navegador): prueba otra red (Wi-Fi o datos móviles) o más tarde", state: Object.assign({}, state, { cfts: Date.now() }) };
        }
        return { toast: en ? "The site challenged again: try once more" : "El sitio volvió a retar: inténtalo otra vez", state: Object.assign({}, state, { cfts: Date.now() }) };
      }
      if (r && r.status === "done") {
        return { toast: en ? "The site handed no session cookie (cf_clearance): it probably blocks without a solvable challenge" : "La web no entregó la cookie de sesión (cf_clearance): probablemente bloquea sin desafío soluble", state: Object.assign({}, state, { cfts: Date.now() }) };
      }
      return { toast: en ? "The challenge was not completed" : "El desafío no se completó" };
    }

    case "cfBorrar": {
      // borra la pre-clearance guardada de una fuente (botón de la tarjeta de Ajustes)
      const fsrc = String(arg || "");
      const base = FUENTES_URL[fsrc];
      if (!base) return null;
      cfForget(base);
      return { toast: en ? "Pre-clearance cleared" : "Pre-clearance borrada", state: Object.assign({}, state, { cfts: Date.now() }) };
    }

    case "capsToggle": {
      const abrir = !(state && state.capsOpen);
      return { state: { capsOpen: abrir, capsAt: abrir ? Date.now() : 0 } };
    }

    case "capsClose": {
      return state && state.capsOpen ? { state: { capsOpen: false, capsAt: 0 } } : null;
    }

    case "capsTick": {
      // temporizador de 1 s: si el panel lleva ≥5 s abierto sin interacción, se minimiza solo
      if (state && state.capsOpen && Date.now() - (state.capsAt || 0) >= 5000) {
        return { state: { capsOpen: false, capsAt: 0 } };
      }
      return null;
    }

    case "borrarHistorial": {
      // técnico: borra el respaldo local y los elementos de progreso que este plugin escribió
      try { kino.storage.set(PROG_KEY, "{}"); } catch { /* sigue */ }
      let n = 0;
      try {
        if (typeof kino.progress === "object" && kino.progress && typeof kino.progress.list === "function") {
          const lista = await kino.progress.list({ limit: 100 });
          for (const e of Array.isArray(lista) ? lista : []) {
            if (!e || !e.resume) continue;
            let r = null;
            try { r = JSON.parse(e.resume); } catch { r = null; }
            if (r && (r.cr || r.mr)) {
              try { await kino.progress.clear(e.id); n++; } catch { /* sigue */ }
            }
          }
        }
      } catch { /* sin permiso: el respaldo ya se borró */ }
      return { state: { rows: [], done: true }, toast: en ? "Reading history cleared (" + n + ")" : "Historial de lectura borrado (" + n + ")" };
    }

    case "bibTagF": {
      return { state: { bibTag: String(arg || value || "todas") } };
    }

    case "fav": {
      if (!(state && state.detail) || !state.detailRef) return null;
      const d = state.detail;
      const favs = favsAll();
      const ya = Boolean(favs[state.detailRef]);
      if (ya) delete favs[state.detailRef];
      else favs[state.detailRef] = { s: d.src, t: String(d.title).slice(0, 180), p: d.poster || undefined, at: Date.now() };
      try { kino.storage.set("favs", JSON.stringify(favs)); } catch { /* lleno: sigue */ }
      return { state: { favs, fav: !ya, note: null }, toast: ya ? (en ? "Removed from your likes" : "Quitado de Mis Me Gustas") : (en ? "Added to your likes" : "Añadido a Mis Me Gustas") };
    }

    case "bibOpen": {
      return { state: { bibOpen: !(state && state.bibOpen) } };
    }

    case "biblio": {
      if (!(state && state.detail) || !state.detailRef) return null;
      const tag = String(arg || value || "");
      const d = state.detail;
      const biblio = biblioAll();
      if (tag === "quitar") {
        delete biblio[state.detailRef];
        try { kino.storage.set("biblio", JSON.stringify(biblio)); } catch { /* lleno */ }
        return { state: { biblio, bibTagCur: null }, toast: en ? "Tag removed" : "Etiqueta quitada" };
      }
      const meta = BIB_TAGS.find((t) => t.k === tag);
      if (!meta) return null;
      biblio[state.detailRef] = { tag, s: d.src, t: String(d.title).slice(0, 180), p: d.poster || undefined, at: Date.now() };
      try { kino.storage.set("biblio", JSON.stringify(biblio)); } catch { /* lleno */ }
      return { state: { biblio, bibTagCur: tag, bibOpen: false }, toast: en ? "Tagged: " + meta.te : "Etiquetado: " + meta.t };
    }

    case "scrMain": {
      const pos = Math.max(0, Math.min(1, Number(value) || 0));
      const last = typeof state.lastPos === "number" ? state.lastPos : pos;
      let hideBar = state.hideBar;
      if (pos > last + 0.015) hideBar = true;
      else if (pos < last - 0.015) hideBar = false;
      return { state: { lastPos: pos, hideBar } };
    }

    case "busqSrc": {
      // Filtro de búsqueda: «todas» o una fuente concreta. Con texto en el campo, repite la búsqueda al momento.
      const key = String(value || "todas");
      const f = key === "todas" ? "" : key;
      const qq = String(state.q || "").trim();
      if (!qq) return { state: { busqSrc: f, results: null } };
      const hecho = await runSearch(qq, f);
      return { state: { busqSrc: f, q: qq, results: hecho, busy: false } };
    }

    case "q": {
      const q = String(value || "").trim();
      if (!q) return { state: { q: "", results: null } };
      const hecho = await runSearch(q, state.busqSrc || "");
      return { state: { q, results: hecho, busy: false } };
    }

    case "capq": {
      // búsqueda de capítulos en DevilNovels (el AJAX busca en TODA la obra, no solo lo cargado)
      const d = state && state.detail;
      if (!d) return null;
      const q = String(value || "").trim();
      try {
        const c = q
          ? await nv.novelChapters(d.src, d.slug, { page: 1, postsPerPage: 50, search: q })
          : await nv.novelChapters(d.src, d.slug, { page: 1, postsPerPage: 50, order: "asc" });
        const more = c.items.map((x) => ({ r: chapterRef(d.src, d.slug, x.slug), n: x.number, t: x.title, pago: Boolean(x.pago) }));
        return { state: { detail: { ...d, capsQ: q, chapters: more, next: c.next, total: c.total } } };
      } catch (e) {
        return { toast: en ? "Could not search chapters." : "No se pudo buscar capítulos." };
      }
    }

    case "caps": {
      const d = state && state.detail;
      if (!d || !d.next) return null;
      try {
        // novelas: lotes por novels.js (DevilNovels trae páginas REST de verdad; las API de una
        // respuesta cortan su caché) — manga: el cursor propio de su adaptador
        const c = isNovel(d.src)
          ? await nv.novelChapters(d.src, d.slug, { page: Number(d.next), postsPerPage: 50, order: "asc", search: d.capsQ || undefined })
          : await adapter(d.src).chapters(d.src, d.slug, { page: Number(d.next), postsPerPage: 50, order: "asc" });
        const more = c.items.map((x) => ({ r: chapterRef(d.src, d.slug, x.slug), n: x.number, t: x.title, pago: Boolean(x.pago) }));
        return { state: { detail: { ...d, chapters: d.chapters.concat(more).slice(0, 4000), next: c.next } } };
      } catch (e) {
        return { toast: en ? "Could not load more chapters." : "No se pudieron cargar más capítulos." };
      }
    }

    case "descToggle": {
      return { state: { descOpen: !state.descOpen } };
    }

    case "capsOrder": {
      // se aplica AL INSTANTE (solo cambia el estado) y queda guardado para los próximos detalles
      const o = arg === "desc" ? "desc" : "asc";
      try { kino.storage.set("capsOrden", o); } catch { /* optativa */ }
      return { state: { capsOrder: o } };
    }

    case "chMas": {
      const shown = (state && state.chShow) || 60;
      return { state: { chShow: shown + 60 } };
    }

    case "cap": {
      const ref = String(arg || "");
      try {
        const chapter = await loadChapter(ref, { t: state && state.detail ? state.detail.title : undefined, p: state && state.detail ? state.detail.poster : undefined });
        chapter.tk = ++navSeq;
        // Retomar: si el capítulo es exactamente el guardado y se quedó a media lectura,
        // el lector arranca en esa página (modo páginas: initialPage; tira: nota visible).
        const prev = storageProgress()[chapter.mr];
        if (prev && prev.cr === ref && (prev.page || 1) > 1) {
          chapter.resumePage = Math.min(prev.page, chapter.total || prev.page);
        }
        scrSave = { k: "", at: 0, page: 0, frac: 0 };
        return { route: { push: "leer", params: { r: ref } }, state: { chapter, imgPage: null, img: null, imgError: null, busyChapter: false } };
      } catch (e) {
        return { toast: errText(e) };
      }
    }

    case "nav": {
      const ref = String(arg || "");
      const c = state && state.chapter;
      try {
        const chapter = await loadChapter(ref, { t: c ? c.mTitle : undefined, p: c ? c.mPoster : undefined });
        chapter.tk = ++navSeq; // clave nueva: el capítulo empieza en la página 1, sin offset viejo
        return { state: { chapter, imgPage: null, img: null, imgError: null, pagIdx: 0 } };
      } catch (e) {
        return { toast: en ? "Could not open that chapter." : "No se pudo abrir ese capítulo." };
      }
    }

    case "pag": {
      const c = state && state.chapter;
      if (!c || !c.mr) return null;
      const idx = Number(value) || 0;
      const total = c.ppages || c.total || 1;
      const frac = total ? (idx + 0.5) / total : 0;
      saveProgress(c.mr, c.ref, { number: c.number, total, mTitle: c.mTitle, mPoster: c.mPoster }, idx + 1, frac);
      scrSave = { k: c.ref + "#" + (c.tk || 0), at: Date.now(), page: idx + 1, frac };
      return { state: { pagIdx: idx } };
    }

    case "scr": {
      const c = state && state.chapter;
      if (!c || !c.mr) return null;
      const pos = Math.max(0, Math.min(1, Number(value) || 0));
      const base = state.pagIdx || 0;
      const frac = c.direction === "rtl" && c.pages.length > 1 ? (base + pos) / c.total : pos;
      const page = Math.max(1, Math.round(frac * (c.total || 1)));
      // guardar CADA evento de scroll escribiría storage entero a cada píxel: basta al cambiar
      // de página, cada 2% de avance o cada 4 s (la regla del punto más leído evita regresiones)
      const k = c.ref + "#" + (c.tk || 0);
      const now = Date.now();
      const s0 = scrSave.k === k ? scrSave : { k, at: 0, page: 0, frac: 0 };
      if (page !== s0.page || Math.abs(frac - s0.frac) > 0.02 || now - s0.at > 4000) {
        saveProgress(c.mr, c.ref, { number: c.number, total: c.total, mTitle: c.mTitle, mPoster: c.mPoster }, page, Math.min(1, frac));
        scrSave = { k, at: now, page, frac: Math.min(1, frac) };
      }
      return null;
    }

    case "share": {
      if (ctx.device === "tv") return { toast: en ? "Sharing lives on the phone." : "Compartir vive en el teléfono." };
      if (!(state && state.detail)) return null;
      return { share: { key: "tarjeta" } };
    }

    case "saved": {
      return { toast: en ? "Settings saved" : "Ajustes guardados" };
    }

    case "rpref": {
      const [key, raw] = String(arg || "").split(":");
      if (!key || !(key in DEFAULT_RPREFS)) return null;
      const val = (key === "novelWidth" || key === "novelGap") ? Number(raw) : raw;
      const next = saveRPrefs({ [key]: val });
      return { state: { rprefs: next } };
    }

    default:
      return null;
  }
}

// ---------- apertura ----------

/** La descarga de capítulos (2.2) y los archivos locales (2.3) se retiraron: borra restos viejos y libera cuota. */
function purgeDl() {
  try {
    const ks = kino.storage.keys() || [];
    for (const k of ks) {
      if (k === "descargas" || k === "dlbatch" || k === "offline" || k.indexOf("dl:") === 0 || k.indexOf("dlMeta:") === 0) {
        try { kino.storage.remove(k); } catch { /* sigue */ }
      }
    }
  } catch { /* sin keys(): nada que purgar */ }
}

/** Búsqueda con caché: en todas las fuentes o solo en la elegida (filtro de la vista Buscar). */
async function runSearch(q, soloSrc) {
  const key = "srch:" + (soloSrc || "*") + ":" + q.toLowerCase();
  const cached = cacheGet(cacheKey(key, 0), TTL.search);
  if (cached) return cached;
  const srcs = soloSrc && SOURCES[soloSrc] ? [soloSrc] : Object.keys(SOURCES);
  const settled = await Promise.allSettled(srcs.map((x) => adapter(x).search(x, q)));
  const seen = [];
  const groups = [];
  for (let i = 0; i < srcs.length; i++) {
    const items = settled[i].status === "fulfilled" && settled[i].value ? settled[i].value.items || [] : [];
    const fresh = [];
    for (const it of items.slice(0, soloSrc ? 60 : 24)) {
      const kk = String(it.title).toLowerCase().replace(/\s+/g, " ");
      if (seen.indexOf(kk) >= 0) continue;
      seen.push(kk);
      fresh.push(compactCard(it));
    }
    if (fresh.length) groups.push({ src: srcs[i], items: fresh });
    if (seen.length >= 90) break;
  }
  cacheSet(cacheKey(key, 0), groups);
  return groups;
}

async function handleOpen(ctx) {
  const { route } = ctx;
  const args = (route && (route.args || route.params)) || null;
  // la pantalla dedicada de categoría/género de una fuente: carga el catálogo paginado real
  const argRef = args && args.ref ? String(args.ref) : "";
  const refParsed = parseBrowseRef(argRef);
  const srcFromArgs = (args && args.s && SOURCES[args.s]) ? args.s : (refParsed && SOURCES[refParsed.src]) ? refParsed.src : null;
  if (srcFromArgs) {
    const f = await loadFuenteCategory(srcFromArgs, argRef || defaultRefFor(srcFromArgs), null, ctx.lang === "en");
    return { state: { fuente: f, herr: null, error: null, note: null } };
  }
  if (args && args.r && args.m) {
    // Un enlace profundo con capítulo («Seguir leyendo») abre el DETALLE del manga: de ahí sale
    // el lector, así que regresar desde el lector siempre cae al detalle, nunca al Home.
    try {
      const detail = await loadDetail(args.m);
      const prog = await readProgress(args.m);
      return { route: { push: "detalle", params: { r: args.m } }, state: { detail, detailRef: args.m, prog, error: null, fav: Boolean(favsAll()[args.m]), bibTagCur: (biblioAll()[args.m] || {}).tag || null } };
    } catch (e) {
      return { route: { push: "buscar" }, state: { error: errText(e) } };
    }
  }
  if (args && args.r) {
    try {
      const detail = await loadDetail(args.r);
      const prog = await readProgress(args.r);
      return { route: { push: "detalle", params: { r: args.r } }, state: { detail, detailRef: args.r, prog, error: null, fav: Boolean(favsAll()[args.r]), bibTagCur: (biblioAll()[args.r] || {}).tag || null } };
    } catch (e) {
      return { route: { push: "buscar" }, state: { error: errText(e) } };
    }
  }
  purgeDl();
  const tab = (ctx.state && ctx.state.hsrc) || "zt";
  const enO = (ctx.lang === "en");
  const [seguir, shelves] = await Promise.allSettled([progressEntries(), loadHomeShelves(tab, enO)]);
  const out = seguir.status === "fulfilled" && seguir.value && seguir.value.length ? seguir.value : [];
  const sh = shelves.status === "fulfilled" ? shelves.value : { shelves: [], err: null };
  return {
    state: {
      rows: out,
      done: true,
      error: null,
      hsrc: tab,
      hrows: sh.shelves,
      herr: sh.err,
      cf: Boolean(sh.cf),
      cfKind: sh.cfKind || null,
    },
  };
}
