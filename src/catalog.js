// catalog.js — search, home, browse, section y categories de Multi-verso Kin.
// Multi-fuente: la búsqueda alcanza las cuatro fuentes (las gemelas incluidas) y quita repetidos por título;
// el Home muestra las dos fuentes primarias (zonatmo.net y manhwass.lat) y la pantalla deja elegir las cuatro.

import { SOURCES, HOME_SOURCES, mangaRef } from "./env.js";
import * as zt from "./zonatmo.js";
import * as ms from "./manhwa.js";

const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : ms);

/** Qué fuente y qué lista lleva un ref de browse. Formato: "zt:new" | "zt:pop" | "zt:score" | "zt:genre:2" | "ms:latest" | "ms:on-going" | "ms:all". */
function parseBrowseRef(ref) {
  const parts = String(ref).split(":");
  if (!SOURCES[parts[0]]) return null;
  const [src, kind, arg] = parts;
  return { src, kind, arg };
}

// ---------- search ----------

export async function search(query) {
  const q = String((query && (query.q || query)) || "").trim();
  if (!q) return { items: [], next: null };
  const srcs = Object.keys(SOURCES);
  const settled = await Promise.allSettled(srcs.map((s) => adapter(s).search(s, q)));
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
    if (SOURCES[src].kind === "zonatmo") {
      const rec = await a.list(src, { page: 1, order: "new", postsPerPage: 20 });
      if (rec.items.length) rows.push({ id: src + "-new", title: name + " · Actualizados", titleEn: name + " · Recently updated", items: rec.items, ref: src + ":new" });
      const pop = await a.tops(src, { page: 1, postsPerPage: 20 });
      if (pop.items.length) rows.push({ id: src + "-pop", title: name + " · Lo más visto", titleEn: name + " · Most read", items: pop.items, ref: src + ":pop" });
      const top = await a.list(src, { page: 1, order: "score", postsPerPage: 20 });
      if (top.items.length) rows.push({ id: src + "-top", title: name + " · Mejor valorados", titleEn: name + " · Top rated", items: top.items, ref: src + ":score" });
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

// ---------- browse (Ver más) ----------

export async function browse(ref, cursor) {
  const parsed = parseBrowseRef(ref);
  if (!parsed) throw kino.error("not_found", "lista desconocida");
  const page = Math.max(1, Number(cursor) || 1);
  const { src, kind, arg } = parsed;
  const a = adapter(src);
  let res;
  if (kind === "pop") res = await a.tops(src, { page, postsPerPage: 24 });
  else if (kind === "new") res = await a.list(src, { page, order: "new", postsPerPage: 24 });
  else if (kind === "score") res = await a.list(src, { page, order: "score", postsPerPage: 24 });
  else if (kind === "az") res = await a.list(src, { page, order: "az", postsPerPage: 24 });
  else if (kind === "old") res = await a.list(src, { page, order: "old", postsPerPage: 24 });
  else if (kind === "genre") res = await a.list(src, { page, genreId: arg, postsPerPage: 24 });
  else if (kind === "latest") res = page > 1 ? a.list(src, { page }) : a.latest(src);
  else if (kind === "on-going" || kind === "end" || kind === "on-hold" || kind === "canceled" || kind === "upcoming") res = await a.list(src, { page, estado: kind });
  else if (kind === "all") res = SOURCES[src].kind === "zonatmo" ? a.list(src, { page, order: "new", postsPerPage: 24 }) : a.list(src, { page });
  else throw kino.error("not_found", "lista desconocida");
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
  return tiles.slice(0, 24);
}

export { mangaRef };
