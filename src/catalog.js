// catalog.js — search, home, browse, section y categories de Multi-verso Kin.
// Multi-fuente: la búsqueda alcanza las nueve fuentes (las gemelas incluidas) y quita repetidos por título;
// browse() soporta paginación real por categoría y género en TODAS las fuentes (manga y novelas).

import { SOURCES, HOME_SOURCES, NOVEL_SOURCES, mangaRef } from "./env.js";
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

const adapter = (src) => {
  const k = SOURCES[src].kind;
  if (k === "zonatmo") return zt;
  if (k === "zonatmoorg") return zoA;
  if (k === "olympus") return ol;
  if (k === "leercapitulo") return lc;
  if (k === "ikigai") return ik;
  if (k === "lectorfenix") return lf;
  if (k === "mhscans") return mc;
  if (k === "manhwaweb") return mw;
  return ms;
};
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

const OL_GENRE_LIST = [
  ["1", "Acción", "Action"], ["4", "Artes marciales", "Martial Arts"], ["5", "Aventura", "Adventure"],
  ["6", "Ciencia Ficción", "Sci-Fi"], ["7", "Comedia", "Comedy"], ["9", "Cultivación", "Cultivation"],
  ["14", "Fantasía", "Fantasy"], ["16", "Harem", "Harem"], ["19", "Magia", "Magic"],
  ["20", "Misterio", "Mystery"], ["21", "Murim", "Murim"], ["22", "Psicológico", "Psychological"],
  ["25", "Reencarnación", "Reincarnation"], ["26", "Romance", "Romance"],
];

const LC_GENRE_LIST = [
  ["action", "Acción", "Action"], ["adventure", "Aventura", "Adventure"], ["comedy", "Comedia", "Comedy"],
  ["drama", "Drama", "Drama"], ["fantasy", "Fantasía", "Fantasy"], ["isekai", "Isekai", "Isekai"],
  ["mystery", "Misterio", "Mystery"], ["psychological", "Psicológico", "Psychological"],
  ["romance", "Romance", "Romance"], ["sci-fi", "Ciencia Ficción", "Sci-Fi"], ["wuxia", "Wuxia", "Wuxia"],
  ["seinen", "Seinen", "Seinen"], ["shounen", "Shounen", "Shounen"],
];

const IK_GENRE_LIST = [
  ["906397904327999491", "Acción", "Action"], ["906397904061530115", "Aventura", "Adventure"],
  ["906398112851165187", "Comedia", "Comedy"], ["906397903933407235", "Drama", "Drama"],
  ["906397894348570627", "Fantasía", "Fantasy"], ["906397894527549443", "Romance", "Romance"],
  ["906409501957390339", "Josei", "Josei"], ["906397894408372227", "Shoujo", "Shoujo"],
  ["906409351330037763", "Boys Love", "Boys Love"], ["906409351272792067", "+18", "+18"],
];

const LF_GENRE_LIST = [
  ["Acción", "Acción", "Action"], ["Aventura", "Aventura", "Adventure"], ["Comedia", "Comedia", "Comedy"],
  ["Drama", "Drama", "Drama"], ["Fantasía", "Fantasía", "Fantasy"], ["Isekai", "Isekai", "Isekai"],
  ["Romance", "Romance", "Romance"], ["Artes Marciales", "Artes Marciales", "Martial Arts"],
  ["Shonen", "Shounen", "Shounen"], ["Magia", "Magia", "Magic"],
];

const MC_GENRE_LIST = [
  ["Acción", "Acción", "Action"], ["Fantasía", "Fantasía", "Fantasy"], ["Aventura", "Aventura", "Adventure"],
  ["Artes Marciales", "Artes Marciales", "Martial Arts"], ["Drama", "Drama", "Drama"],
  ["Comedia", "Comedia", "Comedy"], ["Sistema", "Sistema", "System"], ["Reencarnación", "Reencarnación", "Reincarnation"],
  ["Ciencia ficción", "Ciencia Ficción", "Sci-Fi"], ["Shounen", "Shounen", "Shounen"],
];

const MW_GENRE_LIST = [
  ["3", "Acción", "Action"], ["29", "Aventura", "Adventure"], ["18", "Comedia", "Comedy"],
  ["1", "Drama", "Drama"], ["2", "Romance", "Romance"], ["23", "Fantasía", "Fantasy"],
  ["31", "Sobrenatural", "Supernatural"], ["41", "Reencarnación", "Reincarnation"],
  ["39", "Artes Marciales", "Martial Arts"], ["37", "Sistema de niveles", "Leveling"],
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
  ol: {
    cats: [
      { ref: "ol:new", label: "Recientes", labelEn: "Latest" },
      { ref: "ol:pop", label: "Ranking diario", labelEn: "Daily ranking" },
      { ref: "ol:weekly", label: "Ranking semanal", labelEn: "Weekly ranking" },
      { ref: "ol:novels", label: "Novelas ligeras", labelEn: "Light novels" },
      { ref: "ol:active", label: "Activos", labelEn: "Ongoing" },
      { ref: "ol:finished", label: "Finalizados", labelEn: "Completed" },
      { ref: "ol:az", label: "A–Z", labelEn: "A–Z" },
    ],
    genres: OL_GENRE_LIST.map(([id, l, le]) => ({ ref: "ol:genre:" + id, label: l, labelEn: le })),
  },
  lc: {
    cats: [
      { ref: "lc:latest", label: "Últimos mangas", labelEn: "Latest manga" },
      { ref: "lc:pop", label: "Tendencias", labelEn: "Trending" },
      { ref: "lc:ongoing", label: "En emisión", labelEn: "Ongoing" },
      { ref: "lc:completed", label: "Completados", labelEn: "Completed" },
      { ref: "lc:paused", label: "En pausa", labelEn: "On hold" },
      { ref: "lc:manhwa", label: "Manhwas", labelEn: "Manhwa" },
      { ref: "lc:all", label: "Todo el catálogo", labelEn: "Full catalog" },
    ],
    genres: LC_GENRE_LIST.map(([id, l, le]) => ({ ref: "lc:genre:" + id, label: l, labelEn: le })),
  },
  ik: {
    cats: [
      { ref: "ik:new", label: "Actualizados", labelEn: "Updated" },
      { ref: "ik:pop", label: "Más vistos", labelEn: "Most viewed" },
      { ref: "ik:novels", label: "Novelas ligeras", labelEn: "Light novels" },
      { ref: "ik:comics", label: "Cómics", labelEn: "Comics" },
      { ref: "ik:rated", label: "Mejor valorados", labelEn: "Top rated" },
      { ref: "ik:az", label: "A–Z", labelEn: "A–Z" },
    ],
    genres: IK_GENRE_LIST.map(([id, l, le]) => ({ ref: "ik:genre:" + id, label: l, labelEn: le })),
  },
  lf: {
    cats: [
      { ref: "lf:latest", label: "Actualizados", labelEn: "Updated" },
      { ref: "lf:pop", label: "Populares", labelEn: "Popular" },
      { ref: "lf:today", label: "Tendencias hoy", labelEn: "Popular today" },
      { ref: "lf:new", label: "Nuevos", labelEn: "New" },
      { ref: "lf:all", label: "Todo el catálogo", labelEn: "Full catalog" },
    ],
    genres: LF_GENRE_LIST.map(([id, l, le]) => ({ ref: "lf:genre:" + id, label: l, labelEn: le })),
  },
  mc: {
    cats: [
      { ref: "mc:latest", label: "Actualizados", labelEn: "Updated" },
      { ref: "mc:pop", label: "Más vistos", labelEn: "Most viewed" },
      { ref: "mc:rated", label: "Mejor valorados", labelEn: "Top rated" },
      { ref: "mc:novels", label: "Novelas", labelEn: "Novels" },
      { ref: "mc:manhwa", label: "Manhwas", labelEn: "Manhwa" },
      { ref: "mc:az", label: "A–Z", labelEn: "A–Z" },
    ],
    genres: MC_GENRE_LIST.map(([id, l, le]) => ({ ref: "mc:genre:" + id, label: l, labelEn: le })),
  },
  mw: {
    cats: [
      { ref: "mw:latest", label: "Capítulos recientes", labelEn: "Latest chapters" },
      { ref: "mw:pop", label: "Populares", labelEn: "Popular" },
      { ref: "mw:new", label: "Recién agregados", labelEn: "Newly added" },
      { ref: "mw:manhwa", label: "Manhwa", labelEn: "Manhwa" },
      { ref: "mw:manga", label: "Manga", labelEn: "Manga" },
      { ref: "mw:az", label: "A–Z", labelEn: "A–Z" },
    ],
    genres: MW_GENRE_LIST.map(([id, l, le]) => ({ ref: "mw:genre:" + id, label: l, labelEn: le })),
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
    ? (ol.OL_GENRES && p.src === "ol" && ol.OL_GENRES[p.arg])
      || (lc.LC_GENRES && p.src === "lc" && lc.LC_GENRES[p.arg])
      || (zt.ZT_GENRES && zt.ZT_GENRES[p.arg])
      || String(p.arg).replace(/-/g, " ")
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
  const lists = settled.map((r) => (r.status === "fulfilled" && r.value && Array.isArray(r.value.items) ? r.value.items : []));
  const idx = lists.map(() => 0);
  // Intercalado equitativo por fuente para que ninguna quede fuera por el tope de 100 resultados.
  let advanced = true;
  while (items.length < 100 && advanced) {
    advanced = false;
    for (let i = 0; i < lists.length && items.length < 100; i++) {
      const list = lists[i];
      while (idx[i] < list.length) {
        const it = list[idx[i]++];
        advanced = true;
        if (!it || !it.title) continue;
        const key = String(it.title).toLowerCase().replace(/\s+/g, " ");
        if (seen.indexOf(key) >= 0) continue; // los gemelos repiten títulos: nos quedamos con la primera fuente
        seen.push(key);
        items.push(it);
        break;
      }
    }
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
    } else if (kind === "olympus") {
      const rec = await a.list(src, { page: 1, order: "new", type: "comic" });
      if (rec.items.length) rows.push({ id: src + "-new", title: name + " · Recientes", titleEn: name + " · Latest", items: rec.items, ref: src + ":new" });
      const pop = await a.tops(src, { page: 1, kind: "daily" });
      if (pop.items.length) rows.push({ id: src + "-pop", title: name + " · Ranking diario", titleEn: name + " · Daily ranking", items: pop.items, ref: src + ":pop" });
      const nov = await a.list(src, { page: 1, order: "new", type: "novel" });
      if (nov.items.length) rows.push({ id: src + "-nov", title: name + " · Novelas ligeras", titleEn: name + " · Light novels", items: nov.items, ref: src + ":novels" });
    } else if (kind === "leercapitulo") {
      const hs = await a.homeSections(src);
      if (hs.latest && hs.latest.length) rows.push({ id: src + "-new", title: name + " · Últimos mangas", titleEn: name + " · Latest manga", items: hs.latest, ref: src + ":latest" });
      if (hs.trending && hs.trending.length) rows.push({ id: src + "-pop", title: name + " · Tendencias", titleEn: name + " · Trending", items: hs.trending, ref: src + ":pop" });
      const emi = await a.list(src, { page: 1, estado: "ongoing" });
      if (emi.items.length) rows.push({ id: src + "-emi", title: name + " · En emisión", titleEn: name + " · Ongoing", items: emi.items, ref: src + ":ongoing" });
    } else if (kind === "ikigai") {
      const rec = await a.latest(src, 1);
      if (rec.items.length) rows.push({ id: src + "-new", title: name + " · Actualizados", titleEn: name + " · Updated", items: rec.items, ref: src + ":new" });
      const pop = await a.tops(src, 1);
      if (pop.items.length) rows.push({ id: src + "-pop", title: name + " · Más vistos", titleEn: name + " · Most viewed", items: pop.items, ref: src + ":pop" });
      const nov = await a.list(src, { page: 1, sort: "last_chapter_date", type: "novel" });
      if (nov.items.length) rows.push({ id: src + "-nov", title: name + " · Novelas ligeras", titleEn: name + " · Light novels", items: nov.items, ref: src + ":novels" });
    } else if (kind === "lectorfenix") {
      const hs = await a.homeSections(src);
      if (hs.recent && hs.recent.length) rows.push({ id: src + "-new", title: name + " · Actualizados", titleEn: name + " · Updated", items: hs.recent, ref: src + ":latest" });
      if (hs.popular && hs.popular.length) rows.push({ id: src + "-pop", title: name + " · Populares", titleEn: name + " · Popular", items: hs.popular, ref: src + ":pop" });
      if (hs.popularToday && hs.popularToday.length) rows.push({ id: src + "-today", title: name + " · Tendencias hoy", titleEn: name + " · Popular today", items: hs.popularToday, ref: src + ":today" });
    } else if (kind === "mhscans") {
      const rec = await a.latest(src, 1);
      if (rec.items.length) rows.push({ id: src + "-new", title: name + " · Actualizados", titleEn: name + " · Updated", items: rec.items, ref: src + ":latest" });
      const pop = await a.tops(src, 1);
      if (pop.items.length) rows.push({ id: src + "-pop", title: name + " · Más vistos", titleEn: name + " · Most viewed", items: pop.items, ref: src + ":pop" });
      const nov = await a.list(src, { page: 1, sort: "updated", type: "Novel" });
      if (nov.items.length) rows.push({ id: src + "-nov", title: name + " · Novelas", titleEn: name + " · Novels", items: nov.items, ref: src + ":novels" });
    } else if (kind === "manhwaweb") {
      const hs = await a.homeSections(src);
      if (hs.recent && hs.recent.length) rows.push({ id: src + "-new", title: name + " · Capítulos recientes", titleEn: name + " · Latest chapters", items: hs.recent, ref: src + ":latest" });
      if (hs.popular && hs.popular.length) rows.push({ id: src + "-pop", title: name + " · Populares", titleEn: name + " · Popular", items: hs.popular, ref: src + ":pop" });
      if (hs.fresh && hs.fresh.length) rows.push({ id: src + "-nuevos", title: name + " · Recién agregados", titleEn: name + " · Newly added", items: hs.fresh, ref: src + ":new" });
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
  } else if (k === "olympus") {
    if (kind === "pop") res = await a.tops(src, { page, kind: "daily" });
    else if (kind === "weekly") res = await a.tops(src, { page, kind: "weekly" });
    else if (kind === "novels") res = await a.list(src, { page, order: "new", type: "novel" });
    else if (kind === "active") res = await a.list(src, { page, order: "new", statusId: 1 });
    else if (kind === "finished") res = await a.list(src, { page, order: "new", statusId: 4 });
    else if (kind === "az") res = await a.list(src, { page, order: "az" });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genreId: arg });
    else if (kind === "new" || kind === "all") res = await a.list(src, { page, order: "new" });
    else throw kino.error("not_found", "lista desconocida");
  } else if (k === "leercapitulo") {
    if (kind === "pop") res = page > 1 ? await a.list(src, { page }) : await a.tops(src);
    else if (kind === "latest") res = page > 1 ? await a.list(src, { page }) : await a.latest(src);
    else if (kind === "ongoing" || kind === "completed" || kind === "paused" || kind === "cancelled") res = await a.list(src, { page, estado: kind });
    else if (kind === "manga" || kind === "manhwa" || kind === "manhua") res = await a.list(src, { page, type: kind });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genre: arg });
    else if (kind === "all") res = await a.list(src, { page });
    else throw kino.error("not_found", "lista desconocida");
  } else if (k === "ikigai") {
    if (kind === "pop") res = await a.tops(src, page);
    else if (kind === "novels") res = await a.list(src, { page, sort: "last_chapter_date", type: "novel" });
    else if (kind === "comics") res = await a.list(src, { page, sort: "last_chapter_date", type: "comic" });
    else if (kind === "rated") res = await a.list(src, { page, sort: "rating_count" });
    else if (kind === "az") res = await a.list(src, { page, sort: "name" });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genre: arg, sort: "view_count" });
    else if (kind === "new" || kind === "all") res = await a.latest(src, page);
    else throw kino.error("not_found", "lista desconocida");
  } else if (k === "lectorfenix") {
    if (kind === "pop") res = await a.tops(src, page);
    else if (kind === "today") {
      if (page === 1) {
        const hs = await a.homeSections(src);
        res = { items: hs.popularToday || [], next: "2" };
      } else {
        res = await a.list(src, { page, sort: "views" });
      }
    } else if (kind === "new") res = await a.list(src, { page, sort: "created_at" });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genre: arg, sort: "views" });
    else if (kind === "latest" || kind === "all") res = await a.latest(src, page);
    else throw kino.error("not_found", "lista desconocida");
  } else if (k === "mhscans") {
    if (kind === "pop") res = await a.tops(src, page);
    else if (kind === "rated") res = await a.list(src, { page, sort: "rating" });
    else if (kind === "novels") res = await a.list(src, { page, sort: "updated", type: "Novel" });
    else if (kind === "manhwa") res = await a.list(src, { page, sort: "updated", type: "Manhwa" });
    else if (kind === "az") res = await a.list(src, { page, sort: "title" });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genre: arg, sort: "views" });
    else if (kind === "latest" || kind === "all") res = await a.latest(src, page);
    else throw kino.error("not_found", "lista desconocida");
  } else if (k === "manhwaweb") {
    if (kind === "pop") res = await a.tops(src, page);
    else if (kind === "new") {
      if (page === 1) {
        const hs = await a.homeSections(src);
        res = { items: hs.fresh || [], next: "2" };
      } else {
        res = await a.list(src, { page, orderItem: "creacion", orderDir: "desc" });
      }
    } else if (kind === "manhwa") res = await a.list(src, { page, tipo: "manhwa" });
    else if (kind === "manga") res = await a.list(src, { page, tipo: "manga" });
    else if (kind === "az") res = await a.list(src, { page, orderItem: "alfabetico", orderDir: "asc" });
    else if (kind === "genre" && arg) res = await a.list(src, { page, genre: arg, orderItem: "popularidad" });
    else if (kind === "latest" || kind === "all") res = await a.latest(src, page);
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
    { id: "ol", label: "Olympus" },
    { id: "lc", label: "LeerCapitulo" },
    { id: "ik", label: "Ikigai" },
    { id: "lf", label: "LectorFenix" },
    { id: "mc", label: "MHScans" },
    { id: "mw", label: "ManhwaWeb" },
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
  ["Acción", 2], ["Aventura", 3], ["Comedia", 4], ["Drama", 15],
  ["Fantasía", 5], ["Romance", 16], ["Misterio", 40], ["Sobrenatural", 7],
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
  tiles.push({ id: "ol-todo", title: "Explorar Olympus", ref: "ol:new" });
  tiles.push({ id: "lc-todo", title: "Explorar LeerCapitulo", ref: "lc:latest" });
  tiles.push({ id: "ik-todo", title: "Explorar Ikigai", ref: "ik:new" });
  tiles.push({ id: "lf-todo", title: "Explorar LectorFenix", ref: "lf:latest" });
  tiles.push({ id: "mc-todo", title: "Explorar MHScans", ref: "mc:latest" });
  tiles.push({ id: "mw-todo", title: "Explorar ManhwaWeb", ref: "mw:latest" });
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
