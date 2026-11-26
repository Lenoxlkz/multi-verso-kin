// catalog.js — search, home, browse, section y categories de Multi-verso Kin.
// Multi-fuente: la búsqueda alcanza las nueve fuentes (las gemelas incluidas) y quita repetidos por título;
// browse() soporta paginación real por categoría y género en TODAS las fuentes (manga y novelas).

import { SOURCES, HOME_SOURCES, NOVEL_SOURCES, mangaRef } from "./env.js";
import * as zt from "./zonatmo.js";
import * as zoA from "./zonatmoorg.js";
import * as ms from "./manhwa.js";
import * as nv from "./novels.js";

const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : SOURCES[src].kind === "zonatmoorg" ? zoA : ms);
const esNovela = (src) => NOVEL_SOURCES.indexOf(src) >= 0;

/** Catálogo oficial de categorías y géneros por fuente (compartido entre browse, categories y screen). */
const ZT_GENRE_LIST = [
  ["2", "Acción", "Action"], ["3", "Aventura", "Adventure"], ["4", "Comedia", "Comedy"],
  ["15", "Drama", "Drama"], ["5", "Fantasía", "Fantasy"], ["16", "Romance", "Romance"],
  ["7", "Sobrenatural", "Supernatural"], ["60", "Reencarnación", "Reincarnation"],
  ["6", "Magia", "Magic"], ["26", "Artes Marciales", "Martial Arts"], ["36", "Psicológico", "Psychological"],
  ["40", "Misterio", "Mystery"], ["21", "Ciencia Ficción", "Sci-Fi"], ["82", "Horror", "Horror"],
];

const MS_GENRE_LIST = [
  ["accion", "Acción", "Action"], ["fantasia", "Fantasía", "Fantasy"], ["romance", "Romance", "Romance"],
  ["drama", "Drama", "Drama"], ["comedia", "Comedia", "Comedy"], ["aventura", "Aventura", "Adventure"],
  ["artes-marciales", "Artes Marciales", "Martial Arts"],
];

const SK_GENRE_LIST = [
  ["9", "Acción", "Action"], ["2", "Aventura", "Adventure"], ["7", "Comedia", "Comedy"],
  ["8", "Drama", "Drama"], ["4", "Fantasía", "Fantasy"], ["5", "Romance", "Romance"],
  ["19", "Cultivación", "Cultivation"], ["23", "Reencarnación", "Reincarnation"],
  ["3", "Artes Marciales", "Martial Arts"], ["16", "Magia", "Magic"],
  ["22", "Misterio", "Mystery"], ["27", "Psicológico", "Psychological"],
];

const AN_GENRE_LIST = [
  ["accion", "Acción", "Action"], ["artes-marciales", "Artes Marciales", "Martial Arts"],
  ["aventura", "Aventura", "Adventure"], ["drama", "Drama", "Drama"],
  ["isekai", "Isekai", "Isekai"], ["reencarnacion", "Reencarnación", "Reincarnation"],
  ["regresion", "Regresión", "Regression"], ["romance", "Romance", "Romance"],
];

export const SOURCE_CATALOG = {
  zt: {
    cats: [
      { ref: "zt:new", label: "Actualizados", labelEn: "Updated" },
      { ref: "zt:pop", label: "Lo más visto", labelEn: "Most read" },
      { ref: "zt:score", label: "Mejor valorados", labelEn: "Top rated" },
      { ref: "zt:az", label: "A–Z", labelEn: "A–Z" },
    ],
    genres: ZT_GENRE_LIST.map(([id, l, le]) => ({ ref: "zt:genre:" + id, label: l, labelEn: le })),
  },
  zo: {
    cats: [
      { ref: "zo:new", label: "Actualizados", labelEn: "Updated" },
      { ref: "zo:pop", label: "Lo más visto", labelEn: "Most read" },
      { ref: "zo:score", label: "Mejor valorados", labelEn: "Top rated" },
      { ref: "zo:az", label: "A–Z", labelEn: "A–Z" },
    ],
    genres: ZT_GENRE_LIST.slice(0, 10).map(([id, l, le]) => ({ ref: "zo:genre:" + id, label: l, labelEn: le })),
  },
  ms: {
    cats: [
      { ref: "ms:latest", label: "Últimas actualizaciones", labelEn: "Latest updates" },
      { ref: "ms:on-going", label: "En emisión", labelEn: "Ongoing" },
      { ref: "ms:end", label: "Completados", labelEn: "Completed" },
      { ref: "ms:on-hold", label: "En pausa", labelEn: "On hold" },
      { ref: "ms:all", label: "Todo el catálogo", labelEn: "Full catalog" },
    ],
    genres: MS_GENRE_LIST.map(([id, l, le]) => ({ ref: "ms:genre:" + id, label: l, labelEn: le })),
  },
  mh: {
    cats: [
      { ref: "mh:latest", label: "Últimas actualizaciones", labelEn: "Latest updates" },
      { ref: "mh:on-going", label: "En emisión", labelEn: "Ongoing" },
      { ref: "mh:end", label: "Completados", labelEn: "Completed" },
      { ref: "mh:on-hold", label: "En pausa", labelEn: "On hold" },
      { ref: "mh:all", label: "Todo el catálogo", labelEn: "Full catalog" },
    ],
    genres: MS_GENRE_LIST.map(([id, l, le]) => ({ ref: "mh:genre:" + id, label: l, labelEn: le })),
  },
  sk: {
    cats: [
      { ref: "sk:updated", label: "Actualizadas hoy", labelEn: "Updated today" },
      { ref: "sk:views", label: "Lo más leído de siempre", labelEn: "Most read of all time" },
      { ref: "sk:top", label: "Mejor valoradas", labelEn: "Top rated" },
      { ref: "sk:rising", label: "En ascenso", labelEn: "Rising" },
      { ref: "sk:trending", label: "Tendencias de hoy", labelEn: "Trending today" },
      { ref: "sk:week", label: "Lo más leído de la semana", labelEn: "Most read this week" },
      { ref: "sk:month", label: "Lo más leído del mes", labelEn: "Most read this month" },
      { ref: "sk:recent", label: "Recientes", labelEn: "Recent" },
      { ref: "sk:finished", label: "Finalizadas", labelEn: "Finished" },
      { ref: "sk:featured", label: "Destacada", labelEn: "Featured" },
    ],
    genres: SK_GENRE_LIST.map(([id, l, le]) => ({ ref: "sk:genre:" + id, label: l, labelEn: le })),
  },
  mk: {
    cats: [
      { ref: "mk:latest", label: "Actualizaciones recientes", labelEn: "Latest updates" },
      { ref: "mk:views", label: "Más leídas", labelEn: "Most read" },
      { ref: "mk:followers", label: "Más seguidas", labelEn: "Most followed" },
      { ref: "mk:completed", label: "Completadas", labelEn: "Completed" },
      { ref: "mk:ongoing", label: "En curso", labelEn: "Ongoing" },
    ],
    genres: [],
  },
  as: {
    cats: [
      { ref: "as:latest", label: "Últimos capítulos publicados", labelEn: "Latest chapter posts" },
      { ref: "as:all", label: "Todas las novelas", labelEn: "All novels" },
    ],
    genres: [],
  },
  an: {
    cats: [
      { ref: "an:trending", label: "Tendencias", labelEn: "Trending" },
      { ref: "an:latest", label: "Últimas actualizaciones", labelEn: "Latest updates" },
      { ref: "an:views", label: "Más leídas", labelEn: "Most read" },
      { ref: "an:rating", label: "Mejor valoradas", labelEn: "Top rated" },
      { ref: "an:new", label: "Nuevas", labelEn: "New" },
    ],
    genres: AN_GENRE_LIST.map(([id, l, le]) => ({ ref: "an:genre:" + id, label: l, labelEn: le })),
  },
  dv: {
    cats: [
      { ref: "dv:ranking", label: "Ranking de novelas", labelEn: "Novel ranking" },
      { ref: "dv:todas", label: "Listado de novelas", labelEn: "All novels" },
      { ref: "dv:finalizadas", label: "Novelas finalizadas", labelEn: "Finished novels" },
    ],
    genres: [],
  },
};

export function catalogEntryFor(ref) {
  const p = parseBrowseRef(ref);
  if (!p) return null;
  const spec = SOURCE_CATALOG[p.src];
  const srcName = SOURCES[p.src].name;
  if (spec) {
    const hit = spec.cats.find((c) => c.ref === ref) || spec.genres.find((g) => g.ref === ref);
    if (hit) {
      return {
        src: p.src,
        ref,
        label: hit.label,
        labelEn: hit.labelEn,
        fullTitle: srcName + " · " + hit.label,
        fullTitleEn: srcName + " · " + hit.labelEn,
      };
    }
  }
  const tail = p.kind === "genre" && p.arg
    ? (zt.ZT_GENRES && zt.ZT_GENRES[p.arg]) || String(p.arg).replace(/-/g, " ")
    : p.kind;
  return {
    src: p.src,
    ref,
    label: tail,
    labelEn: tail,
    fullTitle: srcName + " · " + tail,
    fullTitleEn: srcName + " · " + tail,
  };
}

/** Qué fuente y qué lista lleva un ref de browse. Formato: "zt:new" | "zt:genre:2" | "sk:updated" | "an:genre:accion" ... */
export function parseBrowseRef(ref) {
  const parts = String(ref || "").split(":");
  if (!SOURCES[parts[0]]) return null;
  const [src, kind, ...rest] = parts;
  return { src, kind: kind || "all", arg: rest.join(":") };
}

// ---------- search ----------

export async function search(query) {
  const q = String((query && (query.q || query)) || "").trim();
  if (!q) return { items: [], next: null };
  const srcs = Object.keys(SOURCES);
  // las novelas van por su propio despacho (sk/mk/as/an/dv); si no, caerían todas en manhwa
  const settled = await Promise.allSettled(srcs.map((s) => (esNovela(s) ? nv.novelSearch(s, q) : adapter(s).search(s, q))));
  const seen = [];
  const items = [];
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status !== "fulfilled" || !settled[i].value) continue;
    for (const it of settled[i].value.items || []) {
      const key = String(it.title || "").toLowerCase().replace(/\s+/g, " ");
      if (seen.indexOf(key) >= 0) continue; // los gemelos repiten títulos: nos quedamos con la primera fuente
      seen.push(key);
      items.push(it);
      if (items.length >= 100) break;
    }
    if (items.length >= 100) break;
  }
  // Los resultados de la búsqueda ordenan mejor si el título empieza igual que lo buscado.
  const ql = q.toLowerCase();
  items.sort((a, b) => {
    const ha = String(a.title).toLowerCase().startsWith(ql) ? 0 : 1;
    const hb = String(b.title).toLowerCase().startsWith(ql) ? 0 : 1;
    return ha - hb;
  });
  return { items, next: null };
}

// ---------- home ----------

/** Fila «Seguir leyendo» desde kino.progress (apiVersion 22 vía enhancements; no existe en Kino viejo). */
async function progressRow(lang) {
  if (typeof kino.progress !== "object" || !kino.progress || typeof kino.progress.list !== "function") return null;
  try {
    const list = await kino.progress.list({ limit: 20 });
    const entries = (Array.isArray(list) ? list : []).filter((e) => e && !e.done && e.resume);
    if (!entries.length) return null;
    const items = [];
    for (const e of entries.slice(0, 20)) {
      let resume;
      try { resume = JSON.parse(e.resume); } catch { resume = null; }
      if (!resume || !resume.mr) continue;
      items.push({
        id: String(e.id).slice(0, 120),
        ref: String(e.id),
        title: String(e.title || "Seguir leyendo").slice(0, 200),
        kind: "movie",
        poster: e.poster || undefined,
        badges: resume.label ? [String(resume.label).slice(0, 20)] : undefined,
        lang: "es",
        open: { screen: { args: { r: String(resume.cr || resume.mr), t: String(e.title || "").slice(0, 200), m: String(resume.mr) } } },
      });
    }
    if (!items.length) return null;
    return {
      id: "seguir",
      title: lang === "en" ? "Keep reading" : "Seguir leyendo",
      items,
    };
  } catch {
    return null; // sin permiso o sin datos: la fila no aparece
  }
}

async function rowsFor(src, lang) {
  const a = adapter(src);
  const rows = [];
  try {
    const name = SOURCES[src].name;
    const kind = SOURCES[src].kind;
    if (kind === "zonatmo" || kind === "zonatmoorg") {
      const rec = await a.list(src, { page: 1, order: "new", postsPerPage: 20 });
      if (rec.items.length) rows.push({ id: src + "-new", title: name + " · Actualizados", titleEn: name + " · Recently updated", items: rec.items, ref: src + ":new" });
      const pop = await a.tops(src, { page: 1, postsPerPage: 20 });
      if (pop.items.length) rows.push({ id: src + "-pop", title: name + " · Lo más visto", titleEn: name + " · Most read", items: pop.items, ref: src + ":pop" });
      const top = await a.list(src, { page: 1, order: "score", postsPerPage: 20 });
      if (top.items.length) rows.push({ id: src + "-top", title: name + " · Mejor valorados", titleEn: name + " · Top rated", items: top.items, ref: src + ":score" });
    } else if (esNovela(src)) {
      const homeRows = await nv.novelHome(src);
      for (const r of homeRows || []) rows.push(r);
    } else {
      const rec = await a.latest(src);
      if (rec.items.length) rows.push({ id: src + "-new", title: name + " · Últimas actualizaciones", titleEn: name + " · Latest updates", items: rec.items, ref: src + ":latest" });
      const emi = await a.list(src, { page: 1, estado: "on-going" });
      if (emi.items.length) rows.push({ id: src + "-emi", title: name + " · En emisión", titleEn: name + " · Ongoing", items: emi.items, ref: src + ":on-going" });
      const top = await a.list(src, { page: 1, estado: "end" });
      if (top.items.length) rows.push({ id: src + "-end", title: name + " · Completados", titleEn: name + " · Completed", items: top.items, ref: src + ":end" });
    }
  } catch {
    // una fuente caída no tumba el Home: sus filas no aparecen
  }
  return rows;
}

export async function home() {
  const lang = kino.lang && String(kino.lang).startsWith("en") ? "en" : "es";
  const rows = [];
  const pr = await progressRow(lang);
  if (pr && pr.items.length) rows.push(pr);
  const settled = await Promise.allSettled(HOME_SOURCES.map((s) => rowsFor(s, lang)));
  for (const r of settled) {
    if (r.status === "fulfilled") rows.push(...r.value);
  }
  return rows;
}

// ---------- browse (Ver más de cualquier fuente, categoría o género) ----------

export async function browse(ref, cursor) {
  const parsed = parseBrowseRef(ref);
  if (!parsed) throw kino.error("not_found", "lista desconocida");
  const page = Math.max(1, Number(cursor) || 1);
  const { src, kind, arg } = parsed;
  if (esNovela(src)) {
    return nv.novelBrowse(src, kind, cursor, arg);
  }
  const a = adapter(src);
  const k = SOURCES[src].kind;
  let res;
  if (k === "zonatmo" || k === "zonatmoorg") {
    if (kind === "pop") res = await a.tops(src, { page, postsPerPage: 24 });
    else if (kind === "new") res = await a.list(src, { page, order: "new", postsPerPage: 24 });
    else if (kind === "score") res = await a.list(src, { page, order: "score", postsPerPage: 24 });
    else if (kind === "az") res = await a.list(src, { page, order: "az", postsPerPage: 24 });
    else if (kind === "old") res = await a.list(src, { page, order: "old", postsPerPage: 24 });
    else if (kind === "genre") res = await a.list(src, { page, genreId: arg, postsPerPage: 24 });
    else if (kind === "all") res = await a.list(src, { page, order: "new", postsPerPage: 24 });
    else throw kino.error("not_found", "lista desconocida");
  } else {
    if (kind === "latest") res = page > 1 ? await a.list(src, { page }) : await a.latest(src);
    else if (kind === "on-going" || kind === "end" || kind === "on-hold" || kind === "canceled" || kind === "upcoming") res = await a.list(src, { page, estado: kind });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genero: arg });
    else if (kind === "all") res = await a.list(src, { page });
    else throw kino.error("not_found", "lista desconocida");
  }
  return res;
}

// ---------- section (chip de Inicio y pestaña en la TV) ----------

export async function section(arg) {
  const lang = kino.lang && String(kino.lang).startsWith("en") ? "en" : "es";
  const asked = arg && arg.tab;
  const tabs = [
    { id: "todo", label: "Todo", labelEn: "All" },
    { id: "zt", label: "ZonaTMO" },
    { id: "zo", label: "ZonaTMO.org" },
    { id: "ms", label: "ManhwaSS" },
    { id: "mh", label: "ManhwaShot" },
  ];
  const tab = tabs.some((t) => t.id === asked) ? asked : "todo";
  const srcs = tab === "todo" ? HOME_SOURCES : [tab];
  const rows = [];
  const pr = await progressRow(lang);
  if (pr && pr.items.length && tab === "todo") rows.push(pr);
  const settled = await Promise.allSettled(srcs.map((s) => rowsFor(s, lang)));
  for (const r of settled) if (r.status === "fulfilled") rows.push(...r.value);
  return { tabs, tab, rows };
}

// ---------- categories (tiles de Categorías) ----------

const GENRES = [
  ["Acción", 2], ["Aventura", 3], ["Comedia", 4], ["Drama", 15], ["Fantasía", 5], ["Romance", 16],
  ["Ciencia ficción", 21], ["Misterio", 40], ["Psicológico", 36], ["Deportes", 37], ["Sobrenatural", 7], ["Horror", 82],
];

export async function categories() {
  const tiles = [];
  for (const [name, id] of GENRES) {
    tiles.push({
      id: "zt-genre-" + id,
      title: name + " (ZonaTMO)",
      ref: "zt:genre:" + id,
    });
  }
  tiles.push({ id: "ms-todo", title: "Explorar ManhwaSS", ref: "ms:all" });
  tiles.push({ id: "mh-todo", title: "Explorar ManhwaShot", ref: "mh:all" });
  tiles.push({ id: "zt-todo", title: "Explorar ZonaTMO", ref: "zt:all" });
  tiles.push({ id: "zo-todo", title: "Explorar ZonaTMO.org", ref: "zo:all" });
  tiles.push({ id: "sk-todo", title: "Explorar Skynovels", ref: "sk:updated" });
  tiles.push({ id: "mk-todo", title: "Explorar MatchaNovels", ref: "mk:latest" });
  tiles.push({ id: "as-todo", title: "Explorar Astral Novels", ref: "as:all" });
  tiles.push({ id: "an-todo", title: "Explorar Anslid", ref: "an:latest" });
  tiles.push({ id: "dv-todo", title: "Explorar DevilNovels", ref: "dv:todas" });
  return tiles.slice(0, 24);
}

export { mangaRef };
