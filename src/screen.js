// screen.js — la pantalla propia de Multi-verso Kin (apiVersion 14).
// Rutas: main (portada), buscar, detalle, leer (lector), offline (sin conexión), ajustes.
// Reglas que sigue este archivo:
//  - Una sola barra compacta: Scaffold + AppBar con mergeWithKinoBar: true y dense: true en TODAS las rutas.
//  - El leading es una salida real: { close: true } en la portada y un regreso (route.pop) en las demás.
//  - screen() es una vista pura (sin red); todo dato se carga en screenEvent y llega como patch de state.
//  - El detalle y el lector se apilan con route.push desde la respuesta del evento, para que Atrás vuelva a la portada.
//  - El progreso se guarda con kino.progress (apiVersion 22, feature-detect) y con kino.storage de respaldo.
//  - Lectura sin conexión: imágenes del aparato con kino.files, una página a la vez como data: (límite de Kino).

import { SOURCES, parseRef, mangaRef, chapterRef } from "./env.js";
import * as zt from "./zonatmo.js";
import * as ms from "./manhwa.js";
import { THEMES } from "./themes.js";

const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : ms);
const hasProgress = () => typeof kino.progress === "object" && kino.progress && typeof kino.progress.set === "function";
const hasFiles = () => typeof kino.files === "object" && kino.files && typeof kino.files.pick === "function";
const hasConvert = () => typeof kino.crypto === "object" && kino.crypto && typeof kino.crypto.convert === "function";

// ---------- utilidades de estado compacto ----------

/** Un Item de Kino mínimo para las tarjetas de la pantalla. */
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

// ---------- progreso ----------

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
  } catch { /* almacenamiento lleno: se pierde el respaldo, no la lectura */ }
}

/** El id de progreso: el patrón de kino.progress no admite «|», así que «zt|m|slug» va como «zt-m-slug». */
function progId(mr) {
  return String(mr).split("|").join("-").replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 120);
}

/** Guarda cuánto lleva leído. `page` es 1-based; `frac` 0..1 dentro del capítulo. */
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
  } catch { /* sin permiso o fuera de apiVersion: el respaldo en storage sigue */ }
}

/** Dónde se quedó la persona en un manga: kino.progress primero, storage de respaldo. */
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

// ---------- carga de datos ----------

async function loadDetail(ref) {
  const p = parseRef(ref);
  if (!p || p.kind !== "m") throw kino.error("invalid_request", "referencia de manga desconocida");
  const a = adapter(p.src);
  const d = await a.detail(p.src, p.a);
  let chapters = d.chapters || [];
  let next = null;
  if (SOURCES[p.src].kind === "zonatmo") {
    const c = await a.chapters(p.src, p.a, { page: 1, postsPerPage: 50, order: "asc" });
    chapters = c.items;
    next = c.next;
  }
  return {
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
}

async function loadChapter(ref, args) {
  const p = parseRef(ref);
  if (!p || p.kind !== "c") throw kino.error("invalid_request", "referencia de capítulo desconocida");
  const a = adapter(p.src);
  const c = await a.chapter(p.src, p.a, p.b);
  return {
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
    mTitle: args && args.t ? args.t : undefined,
    mPoster: args && args.p ? args.p : undefined,
  };
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

// ---------- respuestas de eventos ----------

async function handleOpen(ctx) {
  const { route } = ctx;
  const args = (route && (route.args || route.params)) || null;
  // Un toque en una tarjeta del Home de Kino aterriza en la ruta main CON args.
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
      return { route: { push: "detalle", params: { r: args.r } }, state: { detail, detailRef: args.r, prog, error: null } };
    } catch (e) {
      return { route: { push: "buscar" }, state: { error: errText(e) } };
    }
  }
  // Portada: cargar las filas de las dos fuentes primarias en paralelo.
  const rows = [];
  const settled = await Promise.allSettled([homeRowsZt(), homeRowsMs(), progressEntries()]);
  for (const s of settled) if (s.status === "fulfilled" && s.value) rows.push(...s.value);
  return { state: { rows, done: true, error: null } };
}

async function homeRowsZt() {
  try {
    const rec = await zt.list("zt", { page: 1, order: "new", postsPerPage: 12 });
    const pop = await zt.tops("zt", { page: 1, postsPerPage: 12 });
    const out = [];
    if (rec.items.length) out.push({ id: "zt-new", title: "ZonaTMO · Actualizados", titleEn: "ZonaTMO · Updated", items: rec.items.slice(0, 12).map(compactCard) });
    if (pop.items.length) out.push({ id: "zt-pop", title: "ZonaTMO · Lo más visto", titleEn: "ZonaTMO · Most read", items: pop.items.slice(0, 12).map(compactCard) });
    return out;
  } catch { return []; }
}

async function homeRowsMs() {
  try {
    const rec = await ms.latest("ms");
    const emi = await ms.list("ms", { page: 1, estado: "on-going" });
    const out = [];
    if (rec.items.length) out.push({ id: "ms-new", title: "ManhwaSS · Últimas actualizaciones", titleEn: "ManhwaSS · Latest", items: rec.items.slice(0, 12).map(compactCard) });
    if (emi.items.length) out.push({ id: "ms-emi", title: "ManhwaSS · En emisión", titleEn: "ManhwaSS · Ongoing", items: emi.items.slice(0, 12).map(compactCard) });
    return out;
  } catch { return []; }
}

/** «Seguir leyendo» dentro de la pantalla (kino.progress o el respaldo en storage). */
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
  return out.length ? [{ id: "seguir-screen", title: "Seguir leyendo", titleEn: "Keep reading", items: out.map((x) => ({ r: x.r, m: x.m, t: x.t, p: x.p, b: x.b })) }] : [];
}

// ---------- vista: piezas comunes ----------

function appBar(title, titleEn, ctx, opts) {
  const o = opts || {};
  const leading = o.close
    ? { type: "IconButton", icon: "close", labelText: "Cerrar", labelTextEn: "Close", onPressed: { close: true } }
    : { type: "IconButton", icon: "arrow_back", labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "atras" } };
  const actions = [];
  if (o.share) actions.push({ type: "IconButton", icon: "share", labelText: "Compartir", labelTextEn: "Share", onPressed: "share" });
  if (o.search) actions.push({ type: "IconButton", icon: "search", labelText: "Buscar", labelTextEn: "Search", onPressed: { go: { screen: { route: "buscar" } } } });
  return { type: "AppBar", mergeWithKinoBar: true, dense: true, title, titleEn, leading, actions };
}

function scaffold(title, titleEn, ctx, body, opts) {
  const o = opts || {};
  return { type: "Scaffold", appBar: appBar(title, titleEn, ctx, o), onBack: o.onBack, body };
}

function empty(text, en) {
  return { type: "emptyState", icon: "magic", title: text, titleEn: en || text };
}

function errorBox(msg) {
  return { type: "Column", gap: 12, padding: 16, children: [
    { type: "errorState", icon: "error", title: "Algo falló", titleEn: "Something failed", text: String(msg).slice(0, 300) },
    { type: "TextButton", labelText: "Reintentar", labelTextEn: "Retry", onPressed: { event: "reintentar" } },
  ] };
}

// ---------- vista: portada ----------

function viewMain(ctx) {
  const { state } = ctx;
  const kids = [];
  kids.push({
    type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 },
    children: [
      { type: "Button", variant: "primary", icon: "search", labelText: "Buscar en las 4 fuentes", labelTextEn: "Search all 4 sources", onPressed: { go: { screen: { route: "buscar" } } }, span: 6, fill: true },
      { type: "Button", variant: "secondary", icon: "download", labelText: "Sin conexión", labelTextEn: "Offline", onPressed: { go: { screen: { route: "offline" } } }, span: 3, fill: true },
      { type: "Button", variant: "secondary", icon: "settings", labelText: "Ajustes", labelTextEn: "Settings", onPressed: { go: { screen: { route: "ajustes" } } }, span: 3, fill: true },
    ],
  });
  if (state.error) kids.push({ type: "Text", text: String(state.error), color: "error", padding: { x: 16 } });
  if (!state.done && !state.rows) {
    kids.push({ type: "Column", gap: 12, padding: 16, children: [
      { type: "Skeleton", shape: "card", height: 200 },
      { type: "Skeleton", shape: "card", height: 200 },
    ] });
    return scaffold("Multi-verso Kin", "Multi-verse Kin", ctx, { type: "SingleChildScrollView", children: kids }, { close: true });
  }
  for (const row of state.rows || []) {
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
  if (!(state.rows || []).length) kids.push(empty("Sin filas por ahora", "No rows yet"));
  return scaffold("Multi-verso Kin", "Multi-verse Kin", ctx, { type: "SingleChildScrollView", children: kids }, { close: true });
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
      kids.push({ type: "Text", text: SOURCES[g.src].name, style: "h4", padding: { x: 16, y: 8 } });
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

function viewDetalle(ctx) {
  const { state, device, lang } = ctx;
  const d = state.detail;
  if (state.busyDetail && !d) return scaffold("Cargando", "Loading", ctx, { type: "Column", padding: 16, children: [{ type: "Skeleton", shape: "card", width: 400, height: 200 }] });
  if (!d) return scaffold("Detalle", "Detail", ctx, errorBox(state.error || "Faltan datos"));
  const en = lang === "en";
  const header = {
    type: "Row", crossAxisAlignment: "start", gap: 16, padding: 16,
    children: [
      { type: "Image", url: d.poster, aspect: "2:3", fit: "cover", width: 120, alt: d.title, altEn: d.title, fallback: { type: "box", color: "surfaceVariant", width: 120, height: 200 } },
      { type: "Column", flex: 1, gap: 8, children: [
        { type: "Text", text: d.title, style: "h3" },
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
  const chList = d.chapters.map((c, i) => ({
    type: "ListTile", key: "ch" + i,
    title: "Capítulo " + c.n + (c.t && c.t !== "Capítulo " + c.n ? " · " + String(c.t).slice(0, 40) : ""),
    titleEn: "Chapter " + c.n,
    trailing: { type: "Icon", name: "arrow_forward" },
    onTap: { event: "cap", arg: c.r },
  }));
  const kids = [
    { type: "Card", key: "tarjeta", children: [header] },
    ...(actions.length ? [{ type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: actions }] : []),
    d.overview ? { type: "Text", text: String(d.overview).slice(0, 800), style: "body", padding: { x: 16, y: 8 } } : null,
    d.chapters.length ? { type: "Column", children: chList } : empty("Sin capítulos listados", "No chapters listed"),
    d.chapters.length && d.next ? { type: "TextButton", labelText: "Más capítulos", labelTextEn: "More chapters", onPressed: { event: "caps" }, padding: 16 } : null,
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
  if (c.offline) {
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
  } else if (c.direction === "rtl" && c.pages.length >= 2 && c.pages.length <= 8) { // pages: 2..8 hijos (regla del nodo)
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

// ---------- vista: sin conexión ----------

function offlineLibrary() {
  try {
    const raw = kino.storage.get("offline");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function viewOffline(ctx) {
  const { state } = ctx;
  const kids = [];
  if (!hasFiles()) {
    kids.push({ type: "errorState", icon: "warning", title: "Tu Kino no tiene archivos", titleEn: "Your Kino has no files", text: "La lectura sin conexión necesita Kino 0.9.82 o más nuevo." });
    return scaffold("Sin conexión", "Offline", ctx, { type: "SingleChildScrollView", children: kids });
  }
  kids.push({ type: "Text", text: "Elige una carpeta de imágenes (un capítulo por carpeta) o imágenes sueltas. Quedan en este aparato.", textEn: "Pick a folder of images (one chapter per folder) or loose images. They stay on this device.", style: "body", padding: 16 });
  kids.push({ type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: [
    { type: "Button", variant: "primary", icon: "upload", labelText: "Elegir carpeta", labelTextEn: "Pick folder", onPressed: { event: "pickFolder" }, span: 6, fill: true },
    { type: "Button", variant: "secondary", icon: "add", labelText: "Imágenes sueltas", labelTextEn: "Loose images", onPressed: { event: "pickImgs" }, span: 6, fill: true },
  ] });
  const lib = state.lib || offlineLibrary();
  if (!lib.length) kids.push(empty("Todavía no guardaste nada", "Nothing saved yet"));
  lib.forEach((it, i) => {
    kids.push({
      type: "ListTile", key: "of" + i,
      title: String(it.name || "Carpeta").slice(0, 60),
      subtitle: (it.count ? it.count + " imágenes" : "imágenes") + (it.kind === "files" ? " · sueltas" : " · carpeta"),
      subtitleEn: (it.count ? it.count + " images" : "images") + (it.kind === "files" ? " · loose" : " · folder"),
      trailing: { type: "Icon", name: "arrow_forward" },
      onTap: { event: "abrirOff", arg: it.id },
    });
  });
  if (state.note) kids.push({ type: "Text", text: String(state.note).slice(0, 200), style: "body", color: "muted", padding: 16 });
  return scaffold("Leer sin conexión", "Read offline", ctx, { type: "SingleChildScrollView", children: kids });
}

// ---------- vista: ajustes ----------

function viewAjustes(ctx) {
  const kids = [
    { type: "Text", text: "Cuentas y ajustes del plugin. También están en Ajustes ▸ Plugins ▸ Multi-verso Kin.", textEn: "Accounts and plugin settings. Also in Settings ▸ Plugins ▸ Multi-verso Kin.", style: "body", padding: 16 },
    { type: "settings", keys: ["cuentas", "zt_user", "zt_pass", "log_zt", "zt_token", "win_zt", "ms_user", "ms_pass", "log_ms", "ms_cookie", "win_ms", "salir"], onSaved: "saved" },
    { type: "Text", text: "Temas de la app", textEn: "App themes", style: "h4", padding: { x: 16, y: 8 } },
    { type: "Row", wrap: true, gap: 8, padding: { x: 16, y: 8 }, children: THEMES.map((t) => ({
      type: "Button", variant: "secondary", labelText: t.name.es, labelTextEn: t.name.en, onPressed: { go: { useTheme: { theme: t.id } } }, span: 6, fill: true,
    })) },
    { type: "Text", text: "Un tema cambia el look de toda la app mientras lo tengas puesto; se quita en Ajustes ▸ Apariencia.", textEn: "A theme changes the whole app look while it is on; remove it in Settings ▸ Appearance.", style: "body", color: "muted", padding: 16 },
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
    case "offline": return viewOffline(ctx);
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
      return { route: { pop: true } };

    case "reintentar":
      return handleOpen(ctx);

    case "q": {
      const q = String(value || "").trim();
      if (!q) return { state: { q: "", results: null } };
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

    case "cap": {
      const ref = String(arg || "");
      try {
        const chapter = await loadChapter(ref, { t: state && state.detail ? state.detail.title : undefined, p: state && state.detail ? state.detail.poster : undefined });
        return { route: { push: "leer", params: { r: ref } }, state: { chapter, imgPage: null, img: null, imgError: null } };
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

    // ----- sin conexión -----
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
          offline: true,
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
        const first = await readOfflinePage(chapter, 1, en);
        return {
          route: { push: "leer", params: { r: chapter.ref } },
          state: { chapter, ...first },
        };
      } catch (e) {
        return { toast: errText(e) };
      }
    }

    case "pagOff": {
      const c = state && state.chapter;
      if (!c || !c.offline) return null;
      const cur = Number(state.imgPage) || 1;
      const next = Math.max(1, Math.min(c.total || 1, cur + (Number(arg) || 0)));
      const patch = await readOfflinePage(c, next, en);
      return { state: patch };
    }

    default:
      return null;
  }
}

/** Lee una página del aparato y la convierte en data: para el lector sin conexión. */
async function readOfflinePage(chapter, page, en) {
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
