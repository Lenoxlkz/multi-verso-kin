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
import * as nv from "./novels.js";
import { THEMES } from "./themes.js";

// El adaptador de novelas expone la misma interfaz (search/home/detail/chapter) que los de manga.
const nvAd = { search: nv.novelSearch, list: null, latest: null, detail: nv.novelDetail, chapter: nv.novelChapter };
const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : SOURCES[src].kind === "zonatmoorg" ? zoA : SOURCES[src].kind === "manhwa" ? ms : nvAd);
const isNovel = (src) => NOVEL_SOURCES.indexOf(src) >= 0;
const hasProgress = () => typeof kino.progress === "object" && kino.progress && typeof kino.progress.set === "function";


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

/** Secciones del Home SOLO para las fuentes de manga, tal y como las muestra cada sitio:
 *  ZonaTMO: actualizados / lo más visto / mejor valorados; ManhwaSS: últimas / en emisión / completados. */
function tabSpecs(src) {
  if (src === "zt" || src === "zo") return [
    { id: src + "-new", src, title: SOURCES[src].name + " · Actualizados", titleEn: SOURCES[src].name + " · Updated", params: { page: 1, order: "new", postsPerPage: 12 } },
    { id: src + "-pop", src, title: SOURCES[src].name + " · Lo más visto", titleEn: SOURCES[src].name + " · Most read", params: { tops: true, page: 1, postsPerPage: 12 } },
    { id: src + "-top", src, title: SOURCES[src].name + " · Mejor valorados", titleEn: SOURCES[src].name + " · Top rated", params: { page: 1, order: "score", postsPerPage: 12 } },
  ];
  if (src === "ms" || src === "mh") return [
    { id: src + "-new", src, title: SOURCES[src].name + " · Últimas actualizaciones", titleEn: SOURCES[src].name + " · Latest", params: { latest: true } },
    { id: src + "-emi", src, title: SOURCES[src].name + " · En emisión", titleEn: SOURCES[src].name + " · Ongoing", params: { page: 1, estado: "on-going" } },
    { id: src + "-end", src, title: SOURCES[src].name + " · Completados", titleEn: SOURCES[src].name + " · Completed", params: { page: 1, estado: "end" } },
  ];
  return [];
}

/** Estantes del Home para UNA fuente (manga: sus filas nativas; novela: las secciones de su sitio). */
async function loadHomeShelves(src, en) {
  try {
    const ck = cacheKey("home", src);
    const cached = cacheGet(ck, TTL.rows);
    if (cached && cached.length) return cached;
    let shelves;
    if (isNovel(src)) {
      const raw = await nv.novelHome(src);
      shelves = (raw || []).map((r) => ({ id: r.id, title: r.title, titleEn: r.titleEn, items: (r.items || []).map(compactCard).filter(Boolean) }));
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
  if (spec.params.tops) res = await a.tops(spec.src, { page: spec.params.page, postsPerPage: spec.params.postsPerPage });
  else if (spec.params.latest) res = await a.latest(spec.src);
  else res = await a.list(spec.src, spec.params);
  const items = res.items.slice(0, 12).map(compactCard);
  if (items.length) cacheSet(cacheKey("rows", spec.id), items);
  return { id: spec.id, title: spec.title, titleEn: spec.titleEn, ref: spec.pop, items };
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
  if (SOURCES[p.src].kind === "zonatmo" || SOURCES[p.src].kind === "zonatmoorg") {
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
  if (isNovel(p.src)) {
    // Novela: el capítulo es TEXTO (párrafos), no imágenes. El progreso se guarda al entrar.
    const c = await nv.novelChapter(p.src, p.a, p.b);
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
  const a = adapter(p.src);
  const c = await a.chapter(p.src, p.a, p.b);
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
  const actions = [];
  if (o.share) actions.push({ type: "IconButton", icon: "share", labelText: "Compartir", labelTextEn: "Share", onPressed: "share" });
  return { type: "AppBar", mergeWithKinoBar: true, dense: true, title, titleEn, leading, actions };
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
      { key: "ajustes", icon: "settings", label: "Ajustes", labelEn: "Settings" },
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
  if (cf) kids.splice(1, 0, { type: "Button", variant: "primary", icon: "security", labelText: "Resolver desafío de Cloudflare", labelTextEn: "Solve the Cloudflare challenge", onPressed: { event: "cfAbrir", arg: ref } });
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

// ---------- vista: portada ----------

/** Las fuentes del panel de la cápsula, en dos por fila, con su tipo a la vista. */
function panelSources(src, en) {
  const rows = [];
  for (let i = 0; i < HOME_TABS.length; i += 2) {
    rows.push({ type: "Row", gap: 8, children: HOME_TABS.slice(i, i + 2).map((k) => ({
      type: "Button", variant: "secondary", icon: k === src ? "check" : undefined, selected: k === src,
      labelText: SOURCES[k].name + (isNovel(k) ? (en ? " · novel" : " · novela") : ""),
      labelTextEn: SOURCES[k].name + (isNovel(k) ? " · novel" : ""),
      onPressed: { event: "tabSrc", arg: k }, flex: 1, fill: true,
    })) });
  }
  return rows;
}

function viewMain(ctx) {
  const { state, lang } = ctx;
  const en = lang === "en";
  const src = state.hsrc || "zt";
  // ---- contenido desplazable: lecturas recientes + estantes nativos de la fuente elegida ----
  const kids = [];
  const seguir = (state.rows || []).find((r) => r.id === "seguir-screen");
  if (seguir && seguir.items && seguir.items.length) {
    kids.push({ type: "SizedBox", height: 12 });
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
      size: "small",
    });
    // opción técnica: borrar el historial de lectura (respaldo en storage y elementos de kino.progress)
    kids.push({ type: "Row", mainAxisAlignment: "end", children: [
      { type: "TextButton", icon: "delete", labelText: "Borrar historial de lectura", labelTextEn: "Clear reading history", onPressed: { event: "borrarHistorial" }, padding: { x: 16, y: 0 } },
    ] });
    kids.push({ type: "SizedBox", height: 4 });
  }
  let shelves = state.hrows;
  let loading = false;
  if (!shelves) {
    shelves = cacheGet(cacheKey("home", src), TTL.rows) || [];
    loading = !state.done && !shelves.length;
  }
  if (loading) {
    kids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "Skeleton", shape: "card", height: 200 },
    ] });
  } else if (shelves.length) {
    for (const row of shelves) {
      const primerP = (row.items || []).find((x) => x.p && x.p.indexOf("http") === 0);
      kids.push({ type: "titleRail", headers: imgHeads(primerP && primerP.p), title: row.title || "", titleEn: row.titleEn, items: (row.items || []).map(expandOne).filter(Boolean), size: "small" });
    }
  } else if (state.herr) {
    if (state.cf && ctx.device !== "tv") {
      const blocked = state.cfKind === "blocked";
      kids.push({ type: "Column", gap: 12, padding: 16, children: [
        { type: "errorState", icon: "security", title: blocked ? "La fuente está bloqueada" : "Desafío de Cloudflare", titleEn: blocked ? "The source is blocked" : "Cloudflare challenge",
          text: blocked
            ? SOURCES[src].name + " responde con una regla de Cloudflare (acceso denegado por IP o firma del navegador). Puedes intentar el pre-clearance, pero puede no bastar: prueba también otra red (Wi-Fi o datos móviles) o más tarde."
            : SOURCES[src].name + " está detrás de un desafío de Cloudflare. Se abrirá una ventana del sitio: complétalo una vez y las siguientes peticiones pasarán con la cookie que deja (pre-clearance).",
          textEn: blocked
            ? SOURCES[src].name + " answers with a Cloudflare rule (denied by IP or browser signature). Pre-clearance may not be enough: try another network (Wi-Fi or mobile data) or later."
            : SOURCES[src].name + " is behind a Cloudflare challenge. A window of the site will open: complete it once and the next requests pass with the cookie it leaves (pre-clearance)." },
        { type: "Button", variant: "primary", icon: "security", labelText: blocked ? "Intentar pre-clearance" : "Resolver desafío de Cloudflare", labelTextEn: blocked ? "Try pre-clearance" : "Solve the Cloudflare challenge", onPressed: { event: "cfAbrir", arg: src }, fill: true },
        { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "tabSrc", arg: src } },
      ] });
    } else {
      kids.push(errorBox(state.herr, "tabSrc", src));
    }
  } else if (state.error) {
    kids.push(errorBox(state.error, "tabSrc", src));
  } else {
    kids.push(empty("Sin datos de " + SOURCES[src].name + " por ahora", "No data from " + SOURCES[src].name + " yet"));
  }
  // «Ver más» de la fuente (RCA 2026-11, #2): abre la pantalla dedicada con TODO el contenido
  kids.push({ type: "TextButton", icon: "menu_book", labelText: "Ver más de " + SOURCES[src].name, labelTextEn: "More from " + SOURCES[src].name, onPressed: { go: { screen: { route: "fuente", args: { s: src } } } }, padding: { x: 16, y: 6 } });
  if (state.note) kids.push({ type: "Text", text: String(state.note).slice(0, 160), style: "body", color: "muted", padding: { x: 16 } });
  // ---- cápsula fijada arriba + panel desplegable (overlay con scrim) ----
  const capsula = { type: "Row", padding: { x: 16, y: 8 }, children: [
    { type: "Button", variant: "secondary", icon: state.capsOpen ? "expand_less" : "expand_more",
      labelText: "Fuente: " + SOURCES[src].name, labelTextEn: "Source: " + SOURCES[src].name,
      onPressed: { event: "capsToggle" }, selected: Boolean(state.capsOpen), fill: true },
  ] };
  const capStack = { type: "Stack", children: [
    { type: "SingleChildScrollView", onScroll: "scrMain", children: [{ type: "Column", crossAxisAlignment: "stretch", children: kids }] },
  ] };
  if (state.capsOpen) {
    capStack.children.push({
      type: "Column", positioned: { top: 0, left: 0, right: 0, bottom: 0 },
      background: "surface", opacity: 0.62, onTap: { event: "capsClose" },
    });
    capStack.children.push({
      type: "Column", positioned: { top: 0, left: 10, right: 10 }, background: "surfaceVariant", borderRadius: "large",
      padding: 12, gap: 8, elevation: 4,
      children: [
        { type: "Text", text: "Elegir fuente", textEn: "Pick a source", style: "h4" },
        ...panelSources(src, en),
        { type: "Text", text: "El panel se cierra solo a los 5 segundos o al tocar fuera.", textEn: "The panel closes on its own after 5 seconds or on a tap outside.", style: "body", color: "muted" },
      ],
    });
  }
  const body = { type: "Column", crossAxisAlignment: "stretch", children: [capsula, { type: "SizedBox", height: 16 }, capStack] };
  const opts = { close: true, navValue: "home" };
  if (!state.hideBar) { opts.bottomBar = true; if (!state.capsOpen) opts.fab = floatFab(); }
  const root = scaffold("Multi-verso Kin", "Multi-verse Kin", ctx, body, opts);
  // temporizador de raíz: cada segundo revisa si al panel le toca cerrarse (5 s sin interacción)
  root.every = [{ ms: 1000, event: "capsTick" }];
  return root;
}

// ---------- fuente: la pantalla dedicada del «Ver más» ----------

/** Contenido COMPLETO de una fuente para su pantalla dedicada: las mismas filas que el Home
 *  pero con muchos más títulos por fila (60). Caché propia y sonda CF igual que el Home. */
async function loadFuenteAll(src, en) {
  try {
    const ck = cacheKey("fuente", src);
    const cached = cacheGet(ck, TTL.rows);
    if (cached && cached.length) return { shelves: cached, err: null, cf: false, cfKind: null };
    let shelves = [];
    if (isNovel(src)) {
      const raw = await nv.novelHome(src, { full: true });
      shelves = (raw || []).map((r) => ({ id: r.id, title: r.title, titleEn: r.titleEn, items: (r.items || []).map(compactCard).filter(Boolean) }));
    } else {
      const specs = tabSpecs(src).map((sp) => ({ ...sp, params: { ...(sp.params || {}), postsPerPage: 60 } }));
      const settled = await Promise.allSettled(specs.map(fetchOneRow));
      for (const p of settled) if (p.status === "fulfilled" && p.value && p.value.items.length) shelves.push(p.value);
    }
    if (shelves.length) cacheSet(ck, shelves);
    if (!shelves.length) return probeCf(src, en, shelves);
    return { shelves, err: null, cf: false, cfKind: null };
  } catch (e) {
    // los adaptadores lanzan con HTTP 403/503: la sonda decide si fue un desafío de Cloudflare
    return probeCf(src, en, [], SOURCES[src].name + ": " + String((e && e.userMessage) || (e && e.message) || "la fuente no respondió").slice(0, 140));
  }
}

/** Vista «fuente»: TODO el contenido de la fuente elegida (el destino del «Ver más» del Home),
 *  con un botón de Salir claro arriba y al final (la barra también da Atrás). */
function viewFuente(ctx) {
  const { state, lang } = ctx;
  const en = lang === "en";
  const args = (ctx.route && (ctx.route.args || ctx.route.params)) || null;
  const src = (state.fuente && state.fuente.src) || (args && args.s) || state.hsrc || "zt";
  const nombre = SOURCES[src] ? SOURCES[src].name : String(src);
  const f = state.fuente || null;
  const salir = () => ({ type: "Button", variant: "secondary", icon: "arrow_back", labelText: "Salir (volver al Home)", labelTextEn: "Exit (back to Home)", onPressed: { event: "atras" }, fill: true, padding: { x: 16, y: 6 } });
  const kids = [salir()];
  if (!f) {
    kids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "reintentar" }, padding: { x: 16, y: 4 } },
    ] });
  } else if (f.cf && ctx.device !== "tv") {
    kids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "errorState", icon: "security", title: f.cfKind === "blocked" ? "La fuente está bloqueada" : "Desafío de Cloudflare", titleEn: f.cfKind === "blocked" ? "The source is blocked" : "Cloudflare challenge",
        text: nombre + " está tras Cloudflare: resuélvelo desde el Home o prueba más tarde.", textEn: nombre + " is behind Cloudflare: solve it from the Home or try later." },
      { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "reintentar" }, padding: { x: 16, y: 4 } },
    ] });
  } else if (f.err) {
    kids.push(errorBox(f.err, "reintentar"));
  } else if (!(f.shelves || []).length) {
    kids.push(empty("Sin datos de " + nombre + " por ahora", "No data from " + nombre + " yet"));
  } else {
    for (const row of f.shelves) {
      const primerP = (row.items || []).find((x) => x.p && x.p.indexOf("http") === 0);
      kids.push({ type: "titleRail", headers: imgHeads(primerP && primerP.p), title: row.title || "", titleEn: row.titleEn, items: (row.items || []).map(expandOne).filter(Boolean), size: "small" });
    }
    kids.push({ type: "TextButton", icon: "arrow_back", labelText: "Salir (volver al Home)", labelTextEn: "Exit (back to Home)", onPressed: { event: "atras" }, padding: { x: 16, y: 8 } });
  }
  return scaffold(nombre + " · Todo", nombre + " · Everything", ctx, { type: "SingleChildScrollView", children: kids }, { navValue: "home" });
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
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 16, children: [1, 2, 3, 4, 5, 6].map(() => ({ type: "Skeleton", shape: "card", width: 120, height: 180 })) });
  }
  if (state.results) {
    let n = 0;
    for (const g of state.results) {
      if (!g.items.length) continue;
      n += g.items.length;
      kids.push({ type: "Text", text: SOURCES[g.src].name, style: "h4", color: "accent", padding: { x: 16, y: 8 } });
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
      { type: "Row", gap: 12, children: [{ type: "Skeleton", shape: "card", width: 120, height: 180 }, { type: "Column", gap: 8, flex: 1, children: [{ type: "Skeleton", shape: "line", height: 24 }, { type: "Skeleton", shape: "line", height: 16 }, { type: "Skeleton", shape: "line", height: 16 }] }] },
    ] }, {});
  }
  if (!d) return scaffold("Detalle", "Detail", ctx, errorBox(state.error || "Faltan datos"));
  const header = {
    type: "Row", crossAxisAlignment: "start", gap: 16, padding: 16,
    children: [
      { type: "Image", url: d.poster, headers: imgHeads(d.poster), aspect: "2:3", fit: "cover", width: 120, alt: d.title, altEn: d.title, fallback: { type: "Column", width: 120, height: 160, background: "surfaceVariant", borderRadius: "medium" } },
      { type: "Column", flex: 1, gap: 8, children: [
        { type: "Text", text: d.title, style: "h3" },
        { type: "Text", text: SOURCES[d.src] ? SOURCES[d.src].name : "", style: "body", color: "primary" },
        d.status ? { type: "Text", text: d.status + (d.demography ? " · " + d.demography : ""), style: "body", color: "muted" } : null,
        d.score ? { type: "Text", text: "★ " + d.score + (d.total ? "  ·  " + d.total + " caps" : ""), style: "body", color: "muted" } : (d.total ? { type: "Text", text: d.total + " caps", style: "body", color: "muted" } : null),
        d.genres && d.genres.length ? { type: "Chips", key: "gens", value: d.genres[0], options: d.genres.slice(0, 4).map((g) => ({ value: g, label: g })) } : null,
      ].filter(Boolean) },
    ],
  };
  const prog = state.prog || null;
  // orden de la lista: preferencia del usuario (persistente) o cronológico ascendente
  const orden = state.capsOrder || (kino.storage.get("capsOrden") === "desc" ? "desc" : "asc");
  const cronologica = ordenarCaps(d.chapters, "asc");
  const actions = [];
  if (prog && prog.cr) {
    actions.push({ type: "Button", variant: "primary", icon: "play", labelText: "Seguir: Cap. " + prog.n, labelTextEn: "Continue: Ch. " + prog.n, onPressed: { event: "cap", arg: prog.cr }, span: 12, fill: true });
  }
  if (d.chapters.length) {
    // primero y último son CRONOLÓGICOS: con la lista en desc no se intercambian
    const first = cronologica[0];
    const last = cronologica[cronologica.length - 1];
    actions.push({ type: "Button", variant: "secondary", labelText: "Primero (" + first.n + ")", labelTextEn: "First (" + first.n + ")", onPressed: { event: "cap", arg: first.r }, span: 6, fill: true });
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
  const chList = visibles.map((c, i) => {
    return {
      type: "Row", key: "ch" + i, gap: 4, padding: { x: 12, y: 4 },
      children: [
        { type: "Text", text: "Cap. " + c.n + (c.t && c.t !== "Capítulo " + c.n ? " · " + String(c.t).slice(0, 28) : ""), textEn: "Ch. " + c.n, style: "body", flex: 1, onTap: { event: "cap", arg: c.r } },
        c.pago ? { type: "IconButton", icon: "lock", labelText: en ? "Paid chapter" : "Capítulo de pago", labelTextEn: "Paid chapter", onPressed: { event: "nada" } } : null,
        { type: "IconButton", icon: "play", labelText: "Leer", labelTextEn: "Read", onPressed: { event: "cap", arg: c.r } },
      ].filter(Boolean),
    };
  });
  const kids = [
    { type: "Card", key: "tarjeta", children: [header] },
    ...(actions.length ? [{ type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: actions }] : []),
    { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 4 }, children: [
      { type: "Button", variant: "secondary", icon: "heart", labelText: favOn ? "Te gusta" : "Me Gusta", labelTextEn: favOn ? "Liked" : "Like", onPressed: { event: "fav" }, span: 6, fill: true },
      { type: "Button", variant: "secondary", icon: "bookmark", labelText: "Agregar a Biblioteca", labelTextEn: "Add to Library", onPressed: { event: "bibOpen" }, span: 6, fill: true },
    ] },
    bibOpen ? { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 4 }, children: BIB_TAGS.map((t) => ({
      type: "Button", variant: t.k === tagCur ? "primary" : "secondary", icon: t.k === tagCur ? "check" : undefined, labelText: t.t, labelTextEn: t.te, onPressed: { event: "biblio", arg: t.k }, span: 3, fill: true,
    })).concat(tagCur ? [{ type: "TextButton", icon: "close", labelText: "Quitar etiqueta", labelTextEn: "Remove tag", onPressed: { event: "biblio", arg: "quitar" }, span: 12, fill: true }] : []) } : null,
    { type: "Button", variant: "secondary", icon: "language", labelText: "Abrir en el navegador", labelTextEn: "Open in browser", onPressed: { go: { url: { href: siteUrl, title: String(d.title).slice(0, 60) } } }, fill: true, padding: { x: 16, y: 4 } },
    descNode(d.overview, state, en),
    ocultar && conPago.length ? { type: "Text", text: conPago.length + " capítulo(s) de pago oculto(s) (ajustable en Ajustes).", textEn: conPago.length + " paid chapter(s) hidden (toggle in Settings).", style: "body", color: "muted", padding: { x: 16, y: 4 } } : null,
    !ocultar && conPago.length ? { type: "Text", text: conPago.length + " capítulo(s) con candado requieren cuenta premium de la fuente.", textEn: conPago.length + " locked chapter(s) need a premium account on the source.", style: "body", color: "muted", padding: { x: 16, y: 4 } } : null,
    // filtro de orden de capítulos: se aplica al instante y queda guardado para las próximas
    d.chapters.length > 1 ? { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 2 }, children: [
      { type: "Button", variant: orden === "asc" ? "primary" : "secondary", icon: "arrow_upward", labelText: "Antiguos primero", labelTextEn: "Oldest first", onPressed: { event: "capsOrder", arg: "asc" }, span: 6, fill: true },
      { type: "Button", variant: orden === "desc" ? "primary" : "secondary", icon: "arrow_downward", labelText: "Recientes primero", labelTextEn: "Newest first", onPressed: { event: "capsOrder", arg: "desc" }, span: 6, fill: true },
    ] } : null,
    // búsqueda de capítulos (dv: el AJAX del sitio busca en TODA la obra, RCA 2026-11)
    d.src === "dv" ? { type: "TextField", key: "capq", kind: "search", labelText: "Buscar capítulo por número o título", labelTextEn: "Search chapter by number or title", value: d.capsQ || "", onSubmitted: "capq", onTrailingTap: "capq", trailingIcon: "search", trailingLabel: "Buscar" } : null,
    d.chapters.length ? { type: "Column", children: chList } : empty(d.capsQ ? "Sin resultados para «" + d.capsQ + "»" : "Sin capítulos listados", d.capsQ ? "No results for \"" + d.capsQ + "\"" : "No chapters listed"),
    d.chapters.length > shown ? { type: "TextButton", labelText: "Ver más capítulos (" + (d.chapters.length - shown) + " más)", labelTextEn: "More chapters", onPressed: { event: "chMas" }, padding: 16 } : null,
    d.chapters.length && d.next ? { type: "TextButton", labelText: "Cargar más de la fuente" + (d.total ? " (" + d.chapters.length + " de " + d.total + ")" : ""), labelTextEn: "Load more from source" + (d.total ? " (" + d.chapters.length + " of " + d.total + ")" : ""), onPressed: { event: "caps" }, padding: { x: 16, y: 4 } } : null,
  ].filter(Boolean);
  return scaffold(String(d.title).slice(0, 30), String(d.title).slice(0, 30), ctx, { type: "SingleChildScrollView", children: kids }, { share: device !== "tv" ? { label: en ? "Share" : "Compartir" } : undefined, navValue: "home", bottomBar: true });
}

// ---------- vista: lector ----------

function viewLeer(ctx) {
  const { state } = ctx;
  const c = state.chapter;
  if (state.busyChapter && !c) return scaffold("Capítulo", "Chapter", ctx, { type: "Column", padding: 16, children: [{ type: "Skeleton", shape: "card", width: 400, height: 300 }] });
  if (!c) return scaffold("Capítulo", "Chapter", ctx, errorBox(state.error || "Faltan datos"));
  const enL = (ctx.lang === "en");
  const nav = [
    c.prev ? { type: "Button", variant: "secondary", icon: "arrow_back", labelText: "Anterior", labelTextEn: "Previous", onPressed: { event: "nav", arg: c.prev }, span: 4, fill: true } : { type: "SizedBox", width: 16 },
    { type: "Text", text: c.text ? "Cap. " + c.number + "  ·  novela" : "Cap. " + c.number + "  ·  " + c.total + " pág.", textEn: c.text ? "Ch. " + c.number + "  ·  novel" : "Ch. " + c.number + "  ·  " + c.total + " p.", style: "body", color: "muted", padding: 8 },
    c.next ? { type: "Button", variant: "secondary", icon: "arrow_forward", labelText: "Siguiente", labelTextEn: "Next", onPressed: { event: "nav", arg: c.next }, span: 4, fill: true } : { type: "SizedBox", width: 16 },
  ];
  const kids = [];
  if (c.text && c.text.length) {
    // Modo novela: ListView (el nodo perezoso de la lista; solo se construye lo visible),
    // ilustraciones y título al inicio, progreso por fracción de scroll vía «scr».
    const bloques = [];
    if (c.imgs && c.imgs.length) {
      for (const u of c.imgs) bloques.push({ type: "Image", url: u, headers: imgHeads(u), aspect: "2:3", fit: "width", alt: "Ilustración", altEn: "Illustration", padding: { y: 4 } });
    }
    bloques.push({ type: "Text", text: c.title || ("Capítulo " + c.number), style: "h4", padding: { x: 16, y: 8 } });
    for (const par of c.text.slice(0, 600)) bloques.push({ type: "Text", text: par, style: "body", padding: { x: 16, y: 4 } });
    kids.push({ type: "ListView", key: "novela-" + (c.tk || 0), items: bloques, flex: 1 });
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 12, children: nav });
  } else if (c.direction === "rtl" && c.pages.length >= 2 && c.pages.length <= (pagesDisponible() ? 250 : 8)) {
    // modo páginas: con la página guardada del capítulo se retoma donde se quedó (initialPage)
    kids.push({
      type: "pages",
      key: "manga-pages-" + (c.tk || 0),
      reverse: true,
      progress: "bar",
      onPageChanged: "pag",
      initialPage: c.resumePage > 1 ? Math.max(0, Math.min(c.resumePage, c.pages.length) - 1) : 0,
      children: c.pages.map((u, i) => ({
        type: "SingleChildScrollView", key: "pg" + (c.tk || 0) + "-" + i, zoom: true, onScroll: "scr", children: [
          { type: "Image", url: u, headers: imgHeads(u), aspect: "2:3", fit: "width", alt: "Página " + (i + 1), altEn: "Page " + (i + 1) },
        ],
      })),
    });
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 12, children: nav });
  } else {
    // tira vertical (webtoon): clave por apertura = siempre página 1 al cambiar de capítulo;
    // el ListView del contrato no acepta posición inicial, así que retomar se marca con nota
    if (c.resumePage > 1 && c.total) {
      kids.push({ type: "Text", text: "Estabas por la página " + c.resumePage + " de " + c.total, textEn: "You were around page " + c.resumePage + " of " + c.total, style: "caption", color: "muted", padding: { x: 16, y: 4 } });
    }
    kids.push({
      type: "SingleChildScrollView", key: "tira-" + (c.tk || 0), zoom: true, onScroll: "scr",
      children: [{ type: "Column", children: c.pages.map((u, i) => ({ type: "Image", url: u, headers: imgHeads(u), aspect: "600:2400", fit: "width", alt: "Página " + (i + 1), altEn: "Page " + (i + 1), padding: { y: 4 } })) }],
    });
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 12, children: nav });
  }
  // Inmersión: en el lector no hay barra de navegación; el regreso es el botón de atrás de la AppBar.
  const root = scaffold(String(c.mTitle || c.title || "Lector").slice(0, 30), "Reader", ctx, { type: "Column", crossAxisAlignment: "stretch", children: kids }, {});
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
  const kids = [
    { type: "Text", text: "Cuentas y ajustes del plugin. También están en Ajustes ▸ Plugins ▸ Multi-verso Kin.", textEn: "Accounts and plugin settings. Also in Settings ▸ Plugins ▸ Multi-verso Kin.", style: "body", padding: 16 },
    { type: "settings", keys: ["cuentas", "zt_user", "zt_pass", "log_zt", "zt_token", "win_zt", "ms_user", "ms_pass", "log_ms", "ms_cookie", "win_ms", "ocultarPago", "salir"], onSaved: "saved" },
    { type: "Text", text: "Pre-clearance de Cloudflare", textEn: "Cloudflare pre-clearance", style: "h4", padding: { x: 16, y: 8 } },
    ...cfCard(en),
    { type: "Text", text: "«Resolver» abre el sitio en una ventana del plugin: completa el desafío una vez y Kino guarda su cookie de sesión (cf_clearance) para esa fuente; las siguientes peticiones la llevan solas mientras la cookie valga. Si el sitio bloquea por regla de IP o firma del navegador, la cookie no basta: prueba otra red (Wi-Fi o datos móviles) o más tarde.", textEn: "«Solve» opens the site in a plugin window: complete the challenge once and Kino keeps its session cookie (cf_clearance) for that source; the next requests carry it automatically while it stays valid. If the site blocks by an IP or browser-signature rule, the cookie is not enough: try another network or later.", style: "body", color: "muted", padding: { x: 16, y: 8 } },
    { type: "Text", text: "Temas de la app (8)", textEn: "App themes (8)", style: "h4", padding: { x: 16, y: 8 } },
    { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: THEMES.map((t) => ({
      type: "Button", variant: "secondary", labelText: t.name.es, labelTextEn: t.name.en, onPressed: { go: { useTheme: { theme: t.id } } }, span: 6, fill: true,
    })) },
    { type: "Text", text: "Un tema se aplica a TODA la app, también a estas páginas, mientras lo tengas puesto; se quita en Ajustes ▸ Apariencia. El violeta de Multi-verso es el tema «Manhwa Violeta».", textEn: "A theme applies to the WHOLE app, these pages included, while it is on; remove it in Settings ▸ Appearance.", style: "body", color: "muted", padding: 16 },
  ];
  return scaffold("Ajustes", "Settings", ctx, { type: "SingleChildScrollView", children: kids }, { navValue: "ajustes", bottomBar: true });
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

    case "reintentar":
      return handleOpen(ctx);

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
      if (cached && cached.length) return { state: { hsrc: src, hrows: cached, herr: null, cf: false, capsOpen: false } };
      const sh = await loadHomeShelves(src, en);
      return { state: { hsrc: src, hrows: sh.shelves, herr: sh.err, cf: Boolean(sh.cf), cfKind: sh.cfKind || null, error: null, done: true, capsOpen: false } };
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
  // la pantalla dedicada de una fuente («Ver más» del Home): carga TODO el contenido de esa fuente
  if (args && args.s && SOURCES[args.s]) {
    const f = await loadFuenteAll(args.s, ctx.lang === "en");
    return { state: { fuente: { src: args.s, shelves: f.shelves, err: f.err, cf: f.cf, cfKind: f.cfKind }, herr: null, error: null, note: null } };
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
