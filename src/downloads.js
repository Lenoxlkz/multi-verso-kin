// downloads.js — descarga de capítulos para leer sin conexión (Kino 0.9.81+, storageLarge 16 MB).
//
// Cómo funciona:
//  - La persona encola capítulos (uno a uno con el botón de cada capítulo, o en lote de 5/10/20/30).
//  - La cola se procesa por temporizadores mientras la pantalla de descargas está abierta
//    (un capítulo por tic; un capítulo son unas 10-30 imágenes y tarda unos segundos).
//  - Cada capítulo descargado vive en UNA clave de kino.storage («dl:…») como JSON con sus páginas
//    en base64. Límite duro de Kino: 2 MB por valor, así que un capítulo que pase de ~1.9 MB se rechaza.
//  - El lector sin conexión muestra las páginas una a una como data: (páginas de más de ~45 KB
//    se muestran con un aviso: es el límite de estado de los árboles de Kino).
//
// Las claves de descarga («dl:…») están fuera del recorte de la caché: solo se borran a mano o por cuota.

import { SOURCES, parseRef, mangaRef } from "./env.js";
import * as zt from "./zonatmo.js";
import * as ms from "./manhwa.js";

const adapter = (src) => (SOURCES[src].kind === "zonatmo" ? zt : ms);

const KEY_STATE = "descargas";
export const DL_QUOTA = 14 * 1024 * 1024; // deja margen dentro de los 16 MB de storageLarge
const CHAPTER_MAX = 1900000; // por debajo del tope de 2 MB por valor de storageLarge

// ---------- estado persistente ----------

export function dlState() {
  try {
    const raw = kino.storage.get(KEY_STATE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.cola) && s.lista && typeof s.bytes === "number") return s;
    }
  } catch { /* corrupto: se rehace */ }
  return { cola: [], lista: {}, bytes: 0, terminadas: 0 };
}

function saveDlState(s) {
  try { kino.storage.set(KEY_STATE, JSON.stringify(s)); } catch { /* lleno: se informa arriba */ }
}

export function dlQuota() {
  const s = dlState();
  return { bytes: s.bytes, quota: DL_QUOTA, count: Object.keys(s.lista).length };
}

export function isDownloaded(cr, state) {
  const s = state || dlState();
  return Boolean(s.lista[cr]);
}

export function isQueued(cr, state) {
  const s = state || dlState();
  return s.cola.some((e) => e.cr === cr);
}

function dlHash(cr) {
  let h = 5381;
  for (let i = 0; i < cr.length; i++) h = ((h << 5) + h + cr.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ---------- cola ----------

/** Encola un capítulo. `meta`: { src, slug, number, mTitle, mPoster }. Devuelve true si entró. */
export function enqueue(cr, meta) {
  const s = dlState();
  if (s.lista[cr] || s.cola.some((e) => e.cr === cr)) return false;
  s.cola.push({
    cr,
    src: meta.src,
    slug: meta.slug,
    number: meta.number || "",
    mTitle: meta.mTitle || "",
    mPoster: meta.mPoster || "",
    estado: "pendiente",
    addedAt: Date.now(),
  });
  // La cola no crece sin control: máx. 60 pendientes.
  while (s.cola.length > 60) s.cola.shift();
  saveDlState(s);
  return true;
}

/** Encola los refs que falten, en orden. Devuelve cuántos entraron. */
export function enqueueMany(refs, metaOf) {
  let n = 0;
  for (const cr of refs) {
    if (enqueue(cr, metaOf(cr))) n++;
  }
  return n;
}

export function removeFromQueue(cr) {
  const s = dlState();
  s.cola = s.cola.filter((e) => e.cr !== cr);
  saveDlState(s);
}

/** Borra un capítulo descargado (su valor de storage y su entrada). */
export function removeDl(cr) {
  const s = dlState();
  const e = s.lista[cr];
  if (!e) return false;
  dropKeys(e.key, e.pages);
  s.bytes = Math.max(0, s.bytes - (e.bytes || 0));
  delete s.lista[cr];
  saveDlState(s);
  return true;
}

/** Vacía la cola pendiente. */
export function clearQueue() {
  const s = dlState();
  s.cola = s.cola.filter((e) => e.estado === "bajando");
  saveDlState(s);
}

// ---------- descarga de un capítulo ----------

function mimeOf(b64) {
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGO")) return "image/gif";
  return "image/webp";
}

// ---------- motor por tics (una página por vuelta: nunca bloquea los toques) ----------
//
// Kino ejecuta los tics y los toques en el mismo turno de la pantalla: mientras un tic corre, ningún
// toque se atiende. Por eso cada tic baja UNAS POCAS PÁGINAS con un presupuesto corto (~2,5 s) y deja
// el resto para el siguiente tic (los tics corren en cualquier ruta del plugin, no solo en Descargas).
// Un tic completo nunca pasa de ~13,5 s (1,5 de colchón + 12 de plazo de una imagen), por debajo del
// presupuesto de 20 s por llamada de Kino.

const PAGE_BUDGET_MS = 1500; // trabajo por tic antes de volver a ceder
const PAGE_TIMEOUT_MS = 12000; // plazo de cada imagen (una sola por tic si el presupuesto ya se gastó)
const MAX_FALLOS = 3; // intentos seguidos por capítulo antes de marcarlo como error

function dlMetaKey(cr) {
  return "dlMeta:" + dlHash(cr);
}

/**
 * Avanza la cola un paso: primero los datos del capítulo, luego páginas hasta el presupuesto.
 * Devuelve { nothing } | { progress, entry } | { done, entry } | { failed, entry }.
 */
export async function processTick() {
  const s = dlState();
  const entry = s.cola.find((e) => e.estado === "bajando") || s.cola.find((e) => e.estado === "pendiente");
  if (!entry) return { nothing: true };
  if (s.bytes >= DL_QUOTA) {
    entry.estado = "error";
    entry.err = "Cuota llena: borra capítulos para seguir.";
    saveDlState(s);
    return { failed: entry };
  }
  const t0 = Date.now();
  const p = parseRef(entry.cr);
  if (!p || p.kind !== "c") {
    entry.estado = "error";
    entry.err = "Referencia de capítulo desconocida.";
    saveDlState(s);
    return { failed: entry };
  }
  try {
    // Fase 1: los datos del capítulo (una vez; las páginas empiezan en el siguiente tic).
    if (entry.estado === "pendiente") {
      const ch = await adapter(p.src).chapter(p.src, p.a, p.b);
      if (!ch.pages.length) throw new Error("El capítulo no tiene imágenes");
      kino.storage.set(dlMetaKey(entry.cr), JSON.stringify({
        urls: ch.pages,
        number: ch.number || entry.number,
        title: ch.title || entry.number,
        direction: ch.direction || "ltr",
      }));
      entry.estado = "bajando";
      entry.total = ch.pages.length;
      entry.hecho = 0;
      entry.mimes = [];
      entry.fallos = 0;
      saveDlState(s);
      return { progress: entry };
    }
    // Fase 2: páginas hasta el presupuesto; cada imagen guarda su propia clave.
    const rawMeta = kino.storage.get(dlMetaKey(entry.cr));
    if (!rawMeta) throw new Error("Se perdieron los datos del capítulo: reintenta.");
    const meta = JSON.parse(rawMeta);
    while (Date.now() - t0 < PAGE_BUDGET_MS) {
      const i = entry.hecho || 0;
      if (i >= meta.urls.length) break;
      let b64 = null;
      try {
        const r = await kino.fetch(meta.urls[i], { timeoutMs: PAGE_TIMEOUT_MS });
        b64 = r.base64();
        if (!b64) throw new Error("vacía");
      } catch (e) {
        // sin reintento dentro del mismo tic: el siguiente tic lo vuelve a intentar
        entry.fallos = (entry.fallos || 0) + 1;
        if (entry.fallos >= MAX_FALLOS) {
          entry.estado = "error";
          entry.err = "Página " + (i + 1) + ": " + String((e && e.message) || "fallo de red").slice(0, 120);
          saveDlState(s);
          return { failed: entry };
        }
        saveDlState(s);
        return { progress: entry };
      }
      entry.mimes[i] = mimeOf(b64);
      kino.storage.set("dl:" + dlHash(entry.cr) + ":" + i, b64);
      entry.hecho = i + 1;
      entry.fallos = 0;
      saveDlState(s);
      if (entry.hecho * 1 >= meta.urls.length) break;
    }
    if ((entry.hecho || 0) < meta.urls.length) return { progress: entry };
    // Fase 3: capítulo completo: escribe el índice y pásalo a la lista.
    const key = dlHash(entry.cr);
    let bytes = 0;
    for (let i = 0; i < meta.urls.length; i++) {
      const pg = kino.storage.get("dl:" + key + ":" + i);
      bytes += pg ? pg.length : 0;
    }
    if (bytes > CHAPTER_MAX) throw new Error("El capítulo pesa más de 2 MB: no cabe en la descarga");
    kino.storage.set("dl:" + key, JSON.stringify({
      cr: entry.cr,
      mr: mangaRef(p.src, p.a),
      src: p.src,
      mangaSlug: p.a,
      number: meta.number,
      title: meta.title,
      mTitle: entry.mTitle || "",
      mPoster: entry.mPoster || "",
      mimes: entry.mimes,
      pages: meta.urls.length,
      direction: meta.direction,
      ts: Date.now(),
    }));
    kino.storage.remove(dlMetaKey(entry.cr));
    const s2 = dlState();
    s2.cola = s2.cola.filter((e) => e.cr !== entry.cr);
    s2.lista[entry.cr] = {
      key,
      src: p.src,
      slug: p.a,
      number: meta.number,
      mTitle: entry.mTitle || "",
      mPoster: entry.mPoster || "",
      bytes,
      pages: meta.urls.length,
      direction: meta.direction,
      ts: Date.now(),
    };
    s2.bytes += bytes;
    s2.terminadas = (s2.terminadas || 0) + 1;
    saveDlState(s2);
    return { done: entry, bytes };
  } catch (e) {
    const s3 = dlState();
    const ent = s3.cola.find((x) => x.cr === entry.cr);
    if (ent) {
      ent.fallos = (ent.fallos || 0) + 1;
      if (ent.fallos >= MAX_FALLOS) {
        ent.estado = "error";
        ent.err = String((e && e.message) || "error").slice(0, 160);
      }
      saveDlState(s3);
      if (ent.estado !== "error") return { progress: ent };
    }
    return { failed: entry, err: String((e && e.message) || "error") };
  }
}

// ---------- lectura ----------

/** Metadatos de un capítulo descargado (sin las páginas). */
export function readDlMeta(cr) {
  const s = dlState();
  const e = s.lista[cr];
  if (!e) return null;
  try {
    const raw = kino.storage.get("dl:" + e.key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      offline: "dl",
      ref: cr,
      mr: d.mr,
      key: e.key,
      mimes: d.mimes || [],
      total: d.pages || (d.mimes ? d.mimes.length : 0),
      number: d.number,
      title: d.title,
      mTitle: d.mTitle,
      mPoster: d.mPoster,
      direction: d.direction || "ltr",
      prev: null,
      next: null,
      pages: [],
    };
  } catch { return null; }
}

/** Una página descargada: { b64, mime } leída directo de storage (síncrono), o null. */
export function readDlPage(meta, page) {
  try {
    const b64 = kino.storage.get("dl:" + meta.key + ":" + (page - 1));
    if (!b64) return null;
    return { b64, mime: (meta.mimes && meta.mimes[page - 1]) || "image/webp" };
  } catch { return null; }
}

/** Borrado completo de las claves de un capítulo. */
export function dropKeys(key, pages) {
  try { kino.storage.remove("dl:" + key); } catch { }
  for (let i = 0; i < (pages || 0); i++) {
    try { kino.storage.remove("dl:" + key + ":" + i); } catch { }
  }
}
