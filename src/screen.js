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

import { SOURCES, parseRef, mangaRef, chapterRef, cacheKey, cacheGet, cacheSet, TTL } from "./env.js";
import * as zt from "./zonatmo.js";
import * as ms from "./manhwa.js";
import { THEMES } from "./themes.js";
import * as dl from "./downloads.js";

const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : ms);
const hasProgress = () => typeof kino.progress === "object" && kino.progress && typeof kino.progress.set === "function";
const hasFiles = () => typeof kino.files === "object" && kino.files && typeof kino.files.pick === "function";
const hasConvert = () => typeof kino.crypto === "object" && kino.crypto && typeof kino.crypto.convert === "function";
const BATCHES = [5, 10, 20, 30];

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
  const data = { cr, n: info.number || "", page: page || 1, total: info.total || 0, ts: Date.now() };
  saveStorageProgress(mr, data);
  if (!hasProgress()) return;
  try {
    kino.progress.set({
      id: progId(mr),
      fraction: Math.max(0, Math.min(1, frac)),
      title: info.mTitle || undefined,
      poster: info.mPoster || undefined,
      label: "Cap. " + (info.number || "?"),
      resume: JSON.stringify({ mr, cr, n: data.n, page: data.page }),
    });
  } catch { /* sin permiso: el respaldo sigue */ }
}

async function readProgress(mr) {
  if (hasProgress()) {
    try {
      const entry = await kino.progress.get(mr);
      if (entry && entry.resume) {
        const r = JSON.parse(entry.resume);
        if (r && r.cr) return { cr: r.cr, n: r.n || "" };
      }
      if (entry && entry.done) return null;
    } catch { /* sin permiso */ }
  }
  const all = storageProgress();
  const d = all[mr];
  return d && d.cr ? { cr: d.cr, n: d.n || "" } : null;
}

// ---------- filas del Home, con caché instantánea ----------

function rowSpecs() {
  return [
    { id: "zt-new", src: "zt", title: "ZonaTMO · Actualizados", titleEn: "ZonaTMO · Updated", params: { page: 1, order: "new", postsPerPage: 12 }, pop: "zt:new" },
    { id: "zt-pop", src: "zt", title: "ZonaTMO · Lo más visto", titleEn: "ZonaTMO · Most read", params: { tops: true, page: 1, postsPerPage: 12 }, pop: "zt:pop" },
    { id: "ms-new", src: "ms", title: "ManhwaSS · Últimas actualizaciones", titleEn: "ManhwaSS · Latest", params: { latest: true }, pop: "ms:latest" },
    { id: "ms-emi", src: "ms", title: "ManhwaSS · En emisión", titleEn: "ManhwaSS · Ongoing", params: { page: 1, estado: "on-going" }, pop: "ms:on-going" },
    { id: "zt-top", src: "zt", title: "ZonaTMO · Mejor valorados", titleEn: "ZonaTMO · Top rated", params: { page: 1, order: "score", postsPerPage: 12 }, pop: "zt:score" },
    { id: "ms-end", src: "ms", title: "ManhwaSS · Completados", titleEn: "ManhwaSS · Completed", params: { page: 1, estado: "end" }, pop: "ms:end" },
  ];
}

/** Las filas que haya en caché, en el orden fijo (lectura síncrona: pinta al instante). */
function rowsFromCache() {
  const rows = [];
  for (const spec of rowSpecs()) {
    const items = cacheGet(cacheKey("rows", spec.id), TTL.rows);
    if (items && items.length) rows.push({ id: spec.id, title: spec.title, titleEn: spec.titleEn, items });
  }
  return rows;
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
async function fetchRows() {
  const settled = await Promise.allSettled(rowSpecs().map(fetchOneRow));
  const rows = [];
  for (const r of settled) if (r.status === "fulfilled" && r.value.items.length) rows.push(r.value);
  return rows;
}

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
  let d, chapters = [], next = null;
  if (SOURCES[p.src].kind === "zonatmo") {
    // detalle y capítulos no dependen entre sí: en paralelo
    const [dRes, cRes] = await Promise.allSettled([a.detail(p.src, p.a), a.chapters(p.src, p.a, { page: 1, postsPerPage: 50, order: "asc" })]);
    if (dRes.status === "rejected") throw dRes.reason;
    d = dRes.value;
    if (cRes.status === "fulfilled") { chapters = cRes.value.items; next = cRes.value.next; }
  } else {
    d = await a.detail(p.src, p.a);
    chapters = d.chapters || [];
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
    total: d.totalChapters,
    chapters: chapters.slice(0, 250).map((c) => ({ r: chapterRef(p.src, p.a, c.slug), n: c.number, t: c.title })),
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
      { key: "ajustes", icon: "settings", label: "Ajustes", labelEn: "Settings" },
      { key: "descargas", icon: "download", label: "Descargas", labelEn: "Downloads" },
    ],
    value: o.navValue || "ajustes",
    onChanged: "navBar",
  };
  return s;
}

function empty(text, en) {
  return { type: "emptyState", icon: "magic", title: text, titleEn: en || text };
}

function errorBox(msg, retryEvent) {
  return { type: "Column", gap: 12, padding: 16, children: [
    { type: "errorState", icon: "error", title: "Algo falló", titleEn: "Something failed", text: String(msg).slice(0, 300) },
    { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: retryEvent || "reintentar" } },
  ] };
}

/** La barra flotante inferior: Ajustes y Descargas juntas. */
function floatBar() {
  return {
    type: "Card", margin: { x: 12, y: 8 },
    children: [{ type: "Row", gap: 8, padding: { x: 8, y: 4 }, children: [
      { type: "Button", variant: "secondary", icon: "settings", labelText: "Ajustes", labelTextEn: "Settings", onPressed: { go: { screen: { route: "ajustes" } } }, fill: true, span: 6 },
      { type: "Button", variant: "secondary", icon: "download", labelText: "Descargas", labelTextEn: "Downloads", onPressed: { go: { screen: { route: "descargas" } } }, fill: true, span: 6 },
    ] }],
  };
}

/** El botón flotante de búsqueda, independiente, a la derecha. */
function floatFab() {
  return { type: "FloatingActionButton", icon: "search", labelText: "Buscar en las 4 fuentes", labelTextEn: "Search all 4 sources", onPressed: { go: { screen: { route: "buscar" } } }, fabPosition: "end" };
}

// ---------- vista: portada ----------

function viewMain(ctx) {
  const { state } = ctx;
  const kids = [];
  let rows = state.rows;
  let loading = false;
  if (!rows || !rows.length) {
    rows = rowsFromCache();
    loading = !state.done && !rows.length;
  }
  if (loading) {
    kids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "Skeleton", shape: "card", height: 200 },
    ] });
  } else {
    for (const row of rows) {
      const isProgress = row.items && row.items.length && row.items[0].s === undefined;
      kids.push({
        type: "titleRail",
        title: row.title || "",
        titleEn: row.titleEn,
        items: (row.items || []).map((x) => (isProgress ? {
          id: ("seg-" + String(x.r)).slice(0, 110).replace(/[^A-Za-z0-9._~-]/g, "_"),
          ref: String(x.m || x.r),
          title: x.t || "Seguir leyendo",
          kind: "movie",
          poster: x.p || undefined,
          badges: x.b ? [String(x.b).slice(0, 20)] : undefined,
          lang: "es",
          open: { screen: { args: { r: x.r, m: x.m, t: x.t, p: x.p } } },
        } : expandOne(x))).filter(Boolean),
        size: "small",
      });
    }
    if (!rows.length) kids.push(empty("Sin filas por ahora", "No rows yet"));
  }
  if (state.note) kids.push({ type: "Text", text: String(state.note).slice(0, 160), style: "body", color: "muted", padding: { x: 16 } });
  const opts = { close: true };
  if (!state.hideBar) { opts.bottomBar = floatBar(); opts.fab = floatFab(); }
  return scaffold("Multi-verso Kin", "Multi-verse Kin", ctx, { type: "SingleChildScrollView", onScroll: "scrMain", children: kids }, opts);
}

// ---------- vista: búsqueda ----------

function viewBuscar(ctx) {
  const { state } = ctx;
  const q = state.q || "";
  const kids = [
    { type: "TextField", key: "q", kind: "search", labelText: "Buscar manga o manhwa", labelTextEn: "Search manga or manhwa", onSubmitted: "q", value: q, trailingIcon: "search", trailingLabel: "Buscar", onTrailingTap: "q", autofocus: !q },
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
  return scaffold("Buscar", "Search", ctx, { type: "SingleChildScrollView", children: kids }, {});
}

function deviceCols(ctx) {
  const c = ctx.size && ctx.size.widthClass;
  if (ctx.device === "tv") return 6;
  if (c === "compact") return 3;
  if (c === "medium") return 4;
  return 6;
}

// ---------- vista: detalle ----------

function dlBadgeOf(cr) {
  if (dl.isDownloaded(cr)) return "ok";
  if (dl.isQueued(cr)) return "cola";
  return null;
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
      { type: "Image", url: d.poster, aspect: "2:3", fit: "cover", width: 120, alt: d.title, altEn: d.title, fallback: { type: "box", color: "surfaceVariant", width: 120, height: 160 } },
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
  const actions = [];
  if (prog && prog.cr) {
    actions.push({ type: "Button", variant: "primary", icon: "play", labelText: "Seguir: Cap. " + prog.n, labelTextEn: "Continue: Ch. " + prog.n, onPressed: { event: "cap", arg: prog.cr }, span: 12, fill: true });
  }
  if (d.chapters.length) {
    const first = d.chapters[0];
    const last = d.chapters[d.chapters.length - 1];
    actions.push({ type: "Button", variant: "secondary", labelText: "Primero (" + first.n + ")", labelTextEn: "First (" + first.n + ")", onPressed: { event: "cap", arg: first.r }, span: 6, fill: true });
    actions.push({ type: "Button", variant: "secondary", labelText: "Último (" + last.n + ")", labelTextEn: "Last (" + last.n + ")", onPressed: { event: "cap", arg: last.r }, span: 6, fill: true });
  }
  const batch = state.dlBatch || 10;
  const batchRow = d.chapters.length ? { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 4 }, children: [
    { type: "Chips", key: "dlb", value: String(batch), options: BATCHES.map((b) => ({ value: String(b), label: String(b) })), onChanged: "dlBatch", span: 12 },
    { type: "Button", variant: "primary", icon: "download", labelText: "Descargar lote de " + batch, labelTextEn: "Download batch of " + batch, onPressed: { event: "dlLote" }, fill: true, span: 12 },
  ] } : null;
  const shown = (state.chShow || 60);
  const visibles = d.chapters.slice(0, shown);
  const chList = visibles.map((c, i) => {
    const badge = dlBadgeOf(c.r);
    return {
      type: "Row", key: "ch" + i, gap: 4, padding: { x: 12, y: 4 },
      children: [
        { type: "Text", text: "Cap. " + c.n + (c.t && c.t !== "Capítulo " + c.n ? " · " + String(c.t).slice(0, 28) : ""), textEn: "Ch. " + c.n, style: "body", flex: 1, onTap: { event: "cap", arg: c.r } },
        badge === "cola" ? { type: "IconButton", icon: "schedule", labelText: "En la cola", labelTextEn: "Queued", onPressed: { event: "nada" } }
          : { type: "IconButton", icon: badge === "ok" ? "check" : "download", labelText: badge === "ok" ? (en ? "Downloaded · tap to re-download" : "Descargado · toca para repetir") : (en ? "Download this chapter" : "Descargar este capítulo"), labelTextEn: badge === "ok" ? "Downloaded · tap to re-download" : "Download this chapter", onPressed: { event: "dlCap", arg: c.r } },
        { type: "IconButton", icon: "play", labelText: "Leer", labelTextEn: "Read", onPressed: { event: "cap", arg: c.r } },
      ],
    };
  });
  const kids = [
    { type: "Card", key: "tarjeta", children: [header] },
    ...(actions.length ? [{ type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: actions }] : []),
    ...(batchRow ? [batchRow] : []),
    d.overview ? { type: "Text", text: String(d.overview).slice(0, 800), style: "body", padding: { x: 16, y: 8 } } : null,
    d.chapters.length ? { type: "Column", children: chList } : empty("Sin capítulos listados", "No chapters listed"),
    d.chapters.length > shown ? { type: "TextButton", labelText: "Ver más capítulos (" + (d.chapters.length - shown) + " más)", labelTextEn: "More chapters", onPressed: { event: "chMas" }, padding: 16 } : null,
    d.chapters.length && d.next ? { type: "TextButton", labelText: "Cargar más de la fuente", labelTextEn: "Load more from source", onPressed: { event: "caps" }, padding: { x: 16, y: 4 } } : null,
  ].filter(Boolean);
  return scaffold(String(d.title).slice(0, 30), String(d.title).slice(0, 30), ctx, { type: "SingleChildScrollView", children: kids }, { share: device !== "tv" ? { label: en ? "Share" : "Compartir" } : undefined });
}

// ---------- vista: lector ----------

function viewLeer(ctx) {
  const { state } = ctx;
  const c = state.chapter;
  if (state.busyChapter && !c) return scaffold("Capítulo", "Chapter", ctx, { type: "Column", padding: 16, children: [{ type: "Skeleton", shape: "card", width: 400, height: 300 }] });
  if (!c) return scaffold("Capítulo", "Chapter", ctx, errorBox(state.error || "Faltan datos"));
  const nav = [
    c.prev ? { type: "Button", variant: "secondary", icon: "arrow_back", labelText: "Anterior", labelTextEn: "Previous", onPressed: { event: "nav", arg: c.prev }, span: 4, fill: true } : { type: "SizedBox", width: 16 },
    { type: "Text", text: "Cap. " + c.number + "  ·  " + c.total + " pág.", textEn: "Ch. " + c.number + "  ·  " + c.total + " p.", style: "body", color: "muted", padding: 8 },
    c.next ? { type: "Button", variant: "secondary", icon: "arrow_forward", labelText: "Siguiente", labelTextEn: "Next", onPressed: { event: "nav", arg: c.next }, span: 4, fill: true } : { type: "SizedBox", width: 16 },
  ];
  const kids = [];
  if (c.offline === "dl") {
    // Capítulo descargado: la página se lee DIRECTO de kino.storage aquí en la vista (síncrono),
    // sin pasar por el state: así caben páginas de hasta ~150 KB (límite de Kino para data:).
    const pg = Math.max(1, Math.min(c.total || 1, state.imgPage || 1));
    const raw = dl.readDlPage(c, pg);
    let pageNode;
    if (!raw) pageNode = { type: "errorState", icon: "warning", title: "Página " + pg, titleEn: "Page " + pg, text: "No se encontró la página." };
    else if (raw.b64.length > 190000) pageNode = { type: "errorState", icon: "warning", title: "Página " + pg, titleEn: "Page " + pg, text: "Esta página pesa más de 150 KB: es el límite de Kino para imágenes sin conexión." };
    else pageNode = { type: "Image", url: "data:" + raw.mime + ";base64," + raw.b64, aspect: "600:2400", fit: "contain", alt: "Página " + pg, altEn: "Page " + pg };
    kids.push({
      type: "Column", children: [
        { type: "Column", flex: 1, children: [pageNode] },
        { type: "Row", wrap: true, gap: 8, padding: 12, children: [
          { type: "Button", variant: "secondary", labelText: "◀ Página", labelTextEn: "◀ Page", onPressed: { event: "pagOff", arg: "-1" }, span: 3, fill: true },
          { type: "Button", variant: "secondary", labelText: "Página ▶", labelTextEn: "Page ▶", onPressed: { event: "pagOff", arg: "1" }, span: 3, fill: true },
          { type: "Text", text: pg + " / " + c.total, style: "body", color: "muted", padding: 8 },
        ] },
        { type: "Row", wrap: true, gap: 8, padding: 12, children: nav },
      ],
    });
  } else if (c.offline === "files") {
    kids.push({
      type: "Column", children: [
        { type: "Column", flex: 1, children: [
          state.img
            ? { type: "Image", url: state.img.url, aspect: state.img.aspect, fit: "contain", alt: "Página " + state.imgPage, altEn: "Page " + state.imgPage }
            : (state.imgError
              ? { type: "errorState", icon: "warning", title: "Página " + (state.imgPage || 1), titleEn: "Page " + (state.imgPage || 1), text: String(state.imgError).slice(0, 200) }
              : { type: "emptyState", icon: "visibility", title: "Página " + (state.imgPage || 1), titleEn: "Page " + (state.imgPage || 1), text: "Abriendo…" }),
        ] },
        { type: "Row", wrap: true, gap: 8, padding: 12, children: [
          { type: "Button", variant: "secondary", labelText: "◀ Página", labelTextEn: "◀ Page", onPressed: { event: "pagOff", arg: "-1" }, span: 3, fill: true },
          { type: "Button", variant: "secondary", labelText: "Página ▶", labelTextEn: "Page ▶", onPressed: { event: "pagOff", arg: "1" }, span: 3, fill: true },
          { type: "Text", text: (state.imgPage || 1) + " / " + c.total, style: "body", color: "muted", padding: 8 },
        ] },
        { type: "Row", wrap: true, gap: 8, padding: 12, children: nav },
      ],
    });
  } else if (c.direction === "rtl" && c.pages.length >= 2 && c.pages.length <= 8) {
    kids.push({
      type: "pages",
      key: "manga-pages",
      reverse: true,
      progress: "bar",
      onPageChanged: "pag",
      children: c.pages.map((u, i) => ({
        type: "SingleChildScrollView", key: "pg" + i, zoom: true, onScroll: "scr", children: [
          { type: "Image", url: u, aspect: "2:3", fit: "width", alt: "Página " + (i + 1), altEn: "Page " + (i + 1) },
        ],
      })),
    });
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 12, children: nav });
  } else {
    kids.push({
      type: "SingleChildScrollView", key: "tira", zoom: true, onScroll: "scr",
      children: [{ type: "Column", children: c.pages.map((u, i) => ({ type: "Image", url: u, aspect: "600:2400", fit: "width", alt: "Página " + (i + 1), altEn: "Page " + (i + 1), padding: { y: 4 } })) }],
    });
    kids.push({ type: "Row", wrap: true, gap: 8, padding: 12, children: nav });
  }
  return scaffold(String(c.mTitle || c.title || "Lector").slice(0, 30), "Reader", ctx, { type: "Column", children: kids }, {});
}

// ---------- vista: descargas ----------

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function viewDescargas(ctx) {
  const { state, lang } = ctx;
  const en = lang === "en";
  const s = state.dl || dl.dlState();
  const kids = [];
  kids.push({
    type: "Column", padding: 16, gap: 8, children: [
      { type: "Text", text: "Descargas para leer sin conexión", textEn: "Downloads for offline reading", style: "h4" },
      { type: "Text", text: "Deja esta pantalla abierta mientras descarga: un capítulo por turno, unos segundos cada uno.", textEn: "Keep this screen open while it downloads: one chapter per turn, a few seconds each.", style: "body", color: "muted" },
      { type: "LinearProgressIndicator", value: Math.min(1, s.bytes / dl.DL_QUOTA), labelText: mb(s.bytes) + " de " + mb(dl.DL_QUOTA) + " MB · " + Object.keys(s.lista).length + " capítulos", labelTextEn: mb(s.bytes) + " of " + mb(dl.DL_QUOTA) + " MB · " + Object.keys(s.lista).length + " chapters" },
    ],
  });
  const pendientes = (s.cola || []).filter((e) => e.estado !== "error");
  const errores = (s.cola || []).filter((e) => e.estado === "error");
  if (pendientes.length || errores.length) {
    kids.push({ type: "Text", text: "En cola", textEn: "Queued", style: "h4", padding: { x: 16, y: 4 } });
    kids.push({ type: "Column", children: pendientes.slice(0, 30).map((e, i) => ({
      type: "Row", key: "q" + i, gap: 8, padding: { x: 12, y: 4 },
      children: [
        { type: "Text", text: (e.mTitle ? e.mTitle.slice(0, 22) + " · " : "") + "Cap. " + (e.number || "?") + (e.estado === "bajando" ? " (bajando…)" : ""), textEn: (e.mTitle ? e.mTitle.slice(0, 22) + " · " : "") + "Ch. " + (e.number || "?") + (e.estado === "bajando" ? " (down…)" : ""), style: "body", flex: 1 },
        { type: "IconButton", icon: "close", labelText: "Quitar de la cola", labelTextEn: "Remove from queue", onPressed: { event: "dlQuitarCola", arg: e.cr } },
      ],
    })) });
    if (errores.length) {
      kids.push({ type: "Text", text: "Con problemas", textEn: "Failed", style: "h4", color: "error", padding: { x: 16, y: 4 } });
      kids.push({ type: "Column", children: errores.slice(0, 10).map((e, i) => ({
        type: "Row", key: "e" + i, gap: 8, padding: { x: 12, y: 4 },
        children: [
          { type: "Text", text: "Cap. " + (e.number || "?") + " · " + String(e.err || "error").slice(0, 40), textEn: "Ch. " + (e.number || "?") + " · " + String(e.err || "error").slice(0, 40), style: "body", color: "error", flex: 1 },
          { type: "IconButton", icon: "refresh", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "dlReintentar", arg: e.cr } },
        ],
      })) });
    }
    kids.push({ type: "TextButton", labelText: "Vaciar la cola", labelTextEn: "Clear queue", onPressed: { event: "dlVaciar" }, padding: { x: 16, y: 4 } });
  }
  const lista = Object.entries(s.lista || {}).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  kids.push({ type: "Text", text: "Descargados (" + lista.length + ")", textEn: "Downloaded (" + lista.length + ")", style: "h4", padding: { x: 16, y: 8 } });
  if (!lista.length) kids.push(empty("Todavía no descargaste nada", "Nothing downloaded yet"));
  kids.push({ type: "Column", children: lista.slice(0, 40).map(([cr, e], i) => ({
    type: "Row", key: "d" + i, gap: 4, padding: { x: 12, y: 4 },
    children: [
      { type: "Text", text: (e.mTitle ? e.mTitle.slice(0, 20) + " · " : "") + "Cap. " + (e.number || "?") + " · " + e.pages + " pág.", textEn: (e.mTitle ? e.mTitle.slice(0, 20) + " · " : "") + "Ch. " + (e.number || "?") + " · " + e.pages + " p.", style: "body", flex: 1, onTap: { event: "dlAbrir", arg: cr } },
      { type: "IconButton", icon: "play", labelText: "Leer", labelTextEn: "Read", onPressed: { event: "dlAbrir", arg: cr } },
      { type: "IconButton", icon: "delete", labelText: "Borrar", labelTextEn: "Delete", onPressed: { event: "dlBorrar", arg: cr } },
    ],
  })) });
  const batch = state.dlBatch || 10;
  kids.push({ type: "Text", text: "Tamaño de lote para «Descargar lote» en los títulos", textEn: "Batch size for \"Download batch\" on titles", style: "body", padding: { x: 16, y: 8 } });
  kids.push({ type: "Chips", key: "dlb2", value: String(batch), options: BATCHES.map((b) => ({ value: String(b), label: String(b) })), onChanged: "dlBatch" });
  kids.push({ type: "Text", text: "Archivos del aparato", textEn: "Files on this device", style: "h4", padding: { x: 16, y: 8 } });
  if (!hasFiles()) {
    kids.push({ type: "Text", text: "Tu Kino no trae la función de archivos (0.9.82+).", textEn: "Your Kino has no files feature (0.9.82+).", style: "body", color: "muted", padding: { x: 16 } });
  } else {
    kids.push({ type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: [
      { type: "Button", variant: "secondary", icon: "upload", labelText: "Elegir carpeta", labelTextEn: "Pick folder", onPressed: { event: "pickFolder" }, span: 6, fill: true },
      { type: "Button", variant: "secondary", icon: "add", labelText: "Imágenes sueltas", labelTextEn: "Loose images", onPressed: { event: "pickImgs" }, span: 6, fill: true },
    ] });
    const lib = state.lib || offlineLibrary();
    lib.forEach((it, i) => {
      kids.push({
        type: "Row", key: "of" + i, gap: 4, padding: { x: 12, y: 4 },
        children: [
          { type: "Text", text: String(it.name || "Carpeta").slice(0, 40) + " (" + (it.count || 0) + ")", style: "body", flex: 1, onTap: { event: "abrirOff", arg: it.id } },
          { type: "IconButton", icon: "play", labelText: "Leer", labelTextEn: "Read", onPressed: { event: "abrirOff", arg: it.id } },
          { type: "IconButton", icon: "delete", labelText: "Borrar", labelTextEn: "Delete", onPressed: { event: "borrarOff", arg: it.id } },
        ],
      });
    });
  }
  return { type: "Scaffold", appBar: appBar("Descargas", "Downloads", ctx, {}), every: [{ ms: 1300, event: "tickDescarga" }], body: { type: "SingleChildScrollView", children: kids } };
}

// ---------- vista: ajustes ----------

function viewAjustes(ctx) {
  const kids = [
    { type: "Text", text: "Cuentas y ajustes del plugin. También están en Ajustes ▸ Plugins ▸ Multi-verso Kin.", textEn: "Accounts and plugin settings. Also in Settings ▸ Plugins ▸ Multi-verso Kin.", style: "body", padding: 16 },
    { type: "settings", keys: ["cuentas", "zt_user", "zt_pass", "log_zt", "zt_token", "win_zt", "ms_user", "ms_pass", "log_ms", "ms_cookie", "win_ms", "salir"], onSaved: "saved" },
    { type: "Text", text: "Temas de la app (8)", textEn: "App themes (8)", style: "h4", padding: { x: 16, y: 8 } },
    { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: THEMES.map((t) => ({
      type: "Button", variant: "secondary", labelText: t.name.es, labelTextEn: t.name.en, onPressed: { go: { useTheme: { theme: t.id } } }, span: 6, fill: true,
    })) },
    { type: "Text", text: "Un tema cambia el look de toda la app mientras lo tengas puesto; se quita en Ajustes ▸ Apariencia. El violeta de Multi-verso ya tiñe sus páginas por defecto.", textEn: "A theme changes the whole app look while it is on; remove it in Settings ▸ Appearance.", style: "body", color: "muted", padding: 16 },
  ];
  return scaffold("Ajustes", "Settings", ctx, { type: "SingleChildScrollView", children: kids });
}

// ---------- screen(ctx) ----------

export async function screen(ctx) {
  const route = (ctx.route && ctx.route.name) || "main";
  switch (route) {
    case "buscar": return viewBuscar(ctx);
    case "detalle": return viewDetalle(ctx);
    case "leer": return viewLeer(ctx);
    case "descargas": return viewDescargas(ctx);
    case "ajustes": return viewAjustes(ctx);
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
      if (key === "descargas") return { go: { screen: { route: "descargas" } } };
      if (key === "ajustes") return { go: { screen: { route: "ajustes" } } };
      return null;
    }

    case "scrMain": {
      const pos = Math.max(0, Math.min(1, Number(value) || 0));
      const last = typeof state.lastPos === "number" ? state.lastPos : pos;
      let hideBar = state.hideBar;
      if (pos > last + 0.015) hideBar = true;
      else if (pos < last - 0.015) hideBar = false;
      return { state: { lastPos: pos, hideBar } };
    }

    case "q": {
      const q = String(value || "").trim();
      if (!q) return { state: { q: "", results: null } };
      const cached = cacheGet(cacheKey("srch", q.toLowerCase()), TTL.search);
      if (cached) return { state: { q, results: cached, busy: false } };
      const srcs = Object.keys(SOURCES);
      const settled = await Promise.allSettled(srcs.map((s) => adapter(s).search(s, q)));
      const seen = [];
      const groups = [];
      for (let i = 0; i < srcs.length; i++) {
        const items = settled[i].status === "fulfilled" && settled[i].value ? settled[i].value.items || [] : [];
        const fresh = [];
        for (const it of items.slice(0, 24)) {
          const key = String(it.title).toLowerCase().replace(/\s+/g, " ");
          if (seen.indexOf(key) >= 0) continue;
          seen.push(key);
          fresh.push(compactCard(it));
        }
        if (fresh.length) groups.push({ src: srcs[i], items: fresh });
        if (seen.length >= 90) break;
      }
      cacheSet(cacheKey("srch", q.toLowerCase()), groups);
      return { state: { q, results: groups, busy: false } };
    }

    case "caps": {
      const d = state && state.detail;
      if (!d || !d.next) return null;
      try {
        const c = await adapter(d.src).chapters(d.src, d.slug, { page: Number(d.next), postsPerPage: 50, order: "asc" });
        const more = c.items.map((x) => ({ r: chapterRef(d.src, d.slug, x.slug), n: x.number, t: x.title }));
        return { state: { detail: { ...d, chapters: d.chapters.concat(more).slice(0, 500), next: c.next } } };
      } catch (e) {
        return { toast: en ? "Could not load more chapters." : "No se pudieron cargar más capítulos." };
      }
    }

    case "chMas": {
      const shown = (state && state.chShow) || 60;
      return { state: { chShow: shown + 60 } };
    }

    case "cap": {
      const ref = String(arg || "");
      try {
        const chapter = await loadChapter(ref, { t: state && state.detail ? state.detail.title : undefined, p: state && state.detail ? state.detail.poster : undefined });
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
        return { state: { chapter, imgPage: null, img: null, imgError: null, pagIdx: 0 } };
      } catch (e) {
        return { toast: en ? "Could not open that chapter." : "No se pudo abrir ese capítulo." };
      }
    }

    case "pag": {
      const c = state && state.chapter;
      if (!c || !c.mr) return null;
      const idx = Number(value) || 0;
      const frac = c.total ? (idx + 0.5) / c.total : 0;
      saveProgress(c.mr, c.ref, { number: c.number, total: c.total, mTitle: c.mTitle, mPoster: c.mPoster }, idx + 1, frac);
      return { state: { pagIdx: idx } };
    }

    case "scr": {
      const c = state && state.chapter;
      if (!c || !c.mr) return null;
      const pos = Math.max(0, Math.min(1, Number(value) || 0));
      const base = state.pagIdx || 0;
      const frac = c.direction === "rtl" && c.pages.length > 1 ? (base + pos) / c.total : pos;
      const page = Math.max(1, Math.round(frac * (c.total || 1)));
      saveProgress(c.mr, c.ref, { number: c.number, total: c.total, mTitle: c.mTitle, mPoster: c.mPoster }, page, Math.min(1, frac));
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

    // ----- descargas -----
    case "dlBatch": {
      const b = Number(value) || 10;
      try { kino.storage.set("dlbatch", String(BATCHES.indexOf(b) >= 0 ? b : 10)); } catch { /* sigue igual */ }
      return { state: { dlBatch: b } };
    }

    case "dlCap": {
      const ref = String(arg || "");
      const d = state && state.detail;
      const p = parseRef(ref);
      const meta = d && p
        ? { src: p.src, slug: p.a, number: (d.chapters.find((c) => c.r === ref) || {}).n || "", mTitle: d.title, mPoster: d.poster }
        : null;
      if (!meta) return { toast: en ? "Open the title first." : "Abre antes el título." };
      if (dl.isDownloaded(ref)) dl.removeDl(ref);
      const ok = dl.enqueue(ref, meta);
      if (!ok) return { toast: en ? "Already queued or downloaded." : "Ya estaba en la cola o descargado." };
      return {
        toast: en ? "Chapter queued: watch it in Downloads." : "Capítulo en cola: míralo en Descargas.",
        state: { dl: dl.dlState() },
      };
    }

    case "dlLote": {
      const d = state && state.detail;
      if (!d || !d.chapters || !d.chapters.length) return { toast: en ? "No chapters to download." : "No hay capítulos para descargar." };
      const batch = state.dlBatch || Number(kino.storage.get("dlbatch")) || 10;
      const refs = [];
      for (const c of d.chapters) {
        if (!dl.isDownloaded(c.r) && !dl.isQueued(c.r)) refs.push(c.r);
        if (refs.length >= batch) break;
      }
      if (!refs.length) return { toast: en ? "Everything is already downloaded or queued." : "Todo ya está descargado o en cola." };
      const metaOf = (cr) => {
        const p = parseRef(cr);
        const c = d.chapters.find((x) => x.r === cr) || {};
        return { src: p.src, slug: p.a, number: c.n || "", mTitle: d.title, mPoster: d.poster };
      };
      const n = dl.enqueueMany(refs, metaOf);
      const desde = (d.chapters.find((x) => x.r === refs[0]) || {}).n || "?";
      return {
        route: { push: "descargas" },
        state: { dl: dl.dlState(), dlBatch: batch, note: en ? n + " chapters queued (from Ch. " + desde + ")." : n + " capítulos en cola (desde el Cap. " + desde + ")." },
      };
    }

    case "dlQuitarCola": {
      dl.removeFromQueue(String(arg));
      return { state: { dl: dl.dlState() } };
    }

    case "dlVaciar": {
      dl.clearQueue();
      return { state: { dl: dl.dlState() }, toast: en ? "Queue cleared." : "Cola vaciada." };
    }

    case "dlReintentar": {
      const cr = String(arg || "");
      dl.removeFromQueue(cr);
      const p = parseRef(cr);
      const d = state && state.detail;
      dl.enqueue(cr, { src: p ? p.src : "", slug: p ? p.a : "", number: "", mTitle: d ? d.title : "", mPoster: d ? d.poster : "" });
      return { state: { dl: dl.dlState() } };
    }

    case "dlBorrar": {
      dl.removeDl(String(arg));
      return { state: { dl: dl.dlState() }, toast: en ? "Deleted." : "Borrado." };
    }

    case "dlAbrir": {
      const cr = String(arg || "");
      const chapter = dl.readDlMeta(cr);
      if (!chapter) return { toast: en ? "That download is gone." : "Esa descarga ya no está." };
      return {
        route: { push: "leer", params: { r: "dl:" + cr } },
        state: { chapter, imgPage: 1, img: null, imgError: null },
      };
    }

    case "tickDescarga": {
      const s = dl.dlState();
      const pendiente = (s.cola || []).some((e) => e.estado === "pendiente");
      if (!pendiente) return null;
      const res = await dl.processQueue(15000);
      const patch = { dl: dl.dlState() };
      if (res.done) return { state: patch };
      if (res.failed) return { state: patch, toast: en ? "Failed: " + String((res.failed.err) || "").slice(0, 80) : "Falló: " + String((res.failed.err) || "").slice(0, 80) };
      return { state: patch };
    }

    // ----- archivos del aparato -----
    case "pickImgs": {
      if (!hasFiles()) return { toast: en ? "Needs Kino 0.9.82+" : "Necesita Kino 0.9.82+" };
      try {
        const files = await kino.files.pick({ kinds: ["image"], multiple: true });
        if (!files || !files.length) return null;
        const lib = offlineLibrary();
        lib.push({ id: "f:" + files.map((f) => f.id).join(",").slice(0, 3800), name: (files[0] && files[0].name ? String(files[0].name).replace(/\.[a-z0-9]+$/i, "") : "Selección") + " (+" + files.length + ")", kind: "files", count: files.length, ids: files.map((f) => f.id) });
        const cut = lib.slice(-40);
        kino.storage.set("offline", JSON.stringify(cut));
        return { state: { lib: cut, note: en ? "Added " + files.length + " images." : "Agregué " + files.length + " imágenes." } };
      } catch (e) {
        return { toast: errText(e) };
      }
    }

    case "pickFolder": {
      if (!hasFiles()) return { toast: en ? "Needs Kino 0.9.82+" : "Necesita Kino 0.9.82+" };
      try {
        const folder = await kino.files.pickFolder();
        if (!folder) return null;
        const listing = await kino.files.list({ folder: folder.id });
        const images = (listing || []).filter((f) => f && f.name && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
        if (!images.length) return { toast: en ? "That folder has no images." : "Esa carpeta no tiene imágenes." };
        const lib = offlineLibrary();
        lib.push({ id: folder.id, name: folder.name || "Carpeta", kind: "folder", count: images.length });
        const cut = lib.slice(-40);
        kino.storage.set("offline", JSON.stringify(cut));
        return { state: { lib: cut, note: en ? "Added " + images.length + " images." : "Agregué " + images.length + " imágenes." } };
      } catch (e) {
        return { toast: errText(e) };
      }
    }

    case "abrirOff": {
      const lib = offlineLibrary();
      const entry = lib.find((x) => x.id === arg);
      if (!entry) return { toast: en ? "That item is gone: pick it again." : "Ese elemento ya no está: elígelo otra vez." };
      try {
        let files;
        if (entry.kind === "folder") {
          const listing = await kino.files.list({ folder: entry.id });
          files = (listing || []).filter((f) => f && f.name && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
        } else {
          files = [];
          for (const id of entry.ids || []) {
            try { files.push(await kino.files.info(id)); } catch { /* se fue: se salta */ }
          }
        }
        files.sort((a, b) => String(a.name).localeCompare(String(b.name), "es", { numeric: true }));
        if (!files.length) return { toast: en ? "No readable images." : "No hay imágenes legibles." };
        const chapter = {
          offline: "files",
          ref: "off:" + entry.id,
          mr: null,
          pages: [],
          fileIds: files.map((f) => f.id),
          total: files.length,
          number: String(entry.name).slice(0, 40),
          title: String(entry.name).slice(0, 60),
          direction: "ltr",
          prev: null,
          next: null,
          mTitle: String(entry.name).slice(0, 60),
        };
        const first = await devicePage(chapter, 1, en);
        return {
          route: { push: "leer", params: { r: chapter.ref } },
          state: { chapter, ...first },
        };
      } catch (e) {
        return { toast: errText(e) };
      }
    }

    case "borrarOff": {
      const lib = offlineLibrary();
      const entry = lib.find((x) => x.id === arg);
      if (entry && entry.kind === "files") {
        for (const id of entry.ids || []) {
          try { await kino.files.forget(id); } catch { /* ya se fue */ }
        }
      }
      const rest = lib.filter((x) => x.id !== arg);
      kino.storage.set("offline", JSON.stringify(rest));
      return { state: { lib: rest } };
    }

    case "pagOff": {
      const c = state && state.chapter;
      if (!c || !c.offline) return null;
      const cur = Number(state.imgPage) || 1;
      const next = Math.max(1, Math.min(c.total || 1, cur + (Number(arg) || 0)));
      if (c.offline === "dl") return { state: { imgPage: next, img: null, imgError: null } }; // la vista lee storage
      const patch = await devicePage(c, next, en);
      return { state: patch };
    }

    default:
      return null;
  }
}

// ---------- apertura ----------

async function handleOpen(ctx) {
  const { route } = ctx;
  const args = (route && (route.args || route.params)) || null;
  if (args && args.r && args.m) {
    try {
      const chapter = await loadChapter(args.r, { t: args.t, p: args.p });
      return { route: { push: "leer", params: { r: args.r } }, state: { chapter, imgPage: null, img: null, imgError: null } };
    } catch (e) {
      return { route: { push: "buscar" }, state: { error: errText(e) } };
    }
  }
  if (args && args.r) {
    try {
      const detail = await loadDetail(args.r);
      const prog = await readProgress(args.r);
      const dlBatch = Number(kino.storage.get("dlbatch")) || 10;
      return { route: { push: "detalle", params: { r: args.r } }, state: { detail, detailRef: args.r, prog, dlBatch, dl: dl.dlState(), error: null } };
    } catch (e) {
      return { route: { push: "buscar" }, state: { error: errText(e) } };
    }
  }
  const [rows, seguir] = await Promise.allSettled([fetchRows(), progressEntries()]);
  const out = [];
  if (seguir.status === "fulfilled" && seguir.value && seguir.value.length) out.push(seguir.value[0]);
  if (rows.status === "fulfilled") out.push(...rows.value);
  const dlBatch = Number(kino.storage.get("dlbatch")) || 10;
  return { state: { rows: out, done: true, dlBatch, dl: dl.dlState(), error: null } };
}

// ---------- lectura sin conexión ----------

function offlineLibrary() {
  try {
    const raw = kino.storage.get("offline");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Prepara una página de un archivo del aparato como data: para el árbol. */
async function devicePage(chapter, page, en) {
  const id = chapter.fileIds[page - 1];
  if (!id) return { imgPage: page, img: null, imgError: en ? "No such page." : "No existe esa página." };
  try {
    const bytes = await kino.files.read(id);
    if (!bytes || !bytes.length) return { imgPage: page, img: null, imgError: en ? "Empty page." : "Página vacía." };
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    if (!hasConvert()) return { imgPage: page, img: null, imgError: en ? "This Kino cannot show offline images." : "Este Kino no puede mostrar imágenes sin conexión." };
    const b64 = kino.crypto.convert(hex, "hex", "base64");
    if (b64.length > 58000) {
      return { imgPage: page, img: null, imgError: en ? "This page is too big for offline reading (Kino limit)." : "Esta página pesa demasiado para la lectura sin conexión (límite de Kino)." };
    }
    const mime = /^WebP/.test(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])) ? "image/webp"
      : bytes[0] === 0x89 ? "image/png"
      : bytes[0] === 0xff ? "image/jpeg"
      : bytes[0] === 0x47 ? "image/gif"
      : "image/webp";
    return { imgPage: page, img: { url: "data:" + mime + ";base64," + b64, aspect: "600:2400" }, imgError: null };
  } catch (e) {
    return { imgPage: page, img: null, imgError: errText(e) };
  }
}
