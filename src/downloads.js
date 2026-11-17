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

export function isDownloaded(cr) {
  const s = dlState();
  return Boolean(s.lista[cr]);
}

export function isQueued(cr) {
  const s = dlState();
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

/**
 * Descarga el siguiente capítulo pendiente (o el `entry` dado). `budgetMs` es el tiempo máximo que
 * puede gastar la llamada: al agotarse, el capítulo vuelve a la cola para el siguiente tic.
 * Devuelve un resumen para la interfaz.
 */
export async function processQueue(budgetMs = 15000, only = null) {
  const s = dlState();
  const entry = only || s.cola.find((e) => e.estado === "pendiente");
  if (!entry) return { nothing: true };
  if (s.bytes >= DL_QUOTA) {
    entry.estado = "error";
    entry.err = "Cuota llena: borra capítulos para seguir.";
    saveDlState(s);
    return { failed: entry };
  }
  const t0 = Date.now();
  entry.estado = "bajando";
  saveDlState(s);
  try {
    const p = parseRef(entry.cr);
    if (!p || p.kind !== "c") throw kino.error("invalid_request", "capítulo desconocido");
    const ch = await adapter(p.src).chapter(p.src, p.a, p.b);
    if (!ch.pages.length) throw new Error("El capítulo no tiene imágenes");
    // Una clave de storage por página: el lector lee la página sin pasarla por el state de la pantalla
    // (el state se limita a 64 KB; el árbol admite data: de hasta 200 000 caracteres).
    const key = dlHash(entry.cr);
    let total = 0;
    const mimes = [];
    let written = 0;
    for (let i = 0; i < ch.pages.length; i++) {
      if (Date.now() - t0 > budgetMs) {
        // sin tiempo: vuelve a la cola para el siguiente tic; lo escrito se conserva y no se repite
        entry.estado = "pendiente";
        entry.hecho = written;
        saveDlState(s);
        return { paused: entry };
      }
      const url = ch.pages[i];
      const r = await kino.fetch(url, { timeoutMs: 9000 });
      const b64 = r.base64();
      if (entry.hecho && i < entry.hecho) {
        mimes.push(mimeOf(b64));
        continue; // ya estaba escrita de un intento anterior
      }
      const mime = mimeOf(b64);
      mimes.push(mime);
      kino.storage.set("dl:" + key + ":" + i, b64);
      total += b64.length;
      written = i + 1;
      if (total > CHAPTER_MAX) throw new Error("El capítulo pesa más de 2 MB: no cabe en la descarga");
    }
    const meta = {
      cr: entry.cr,
      mr: mangaRef(p.src, p.a),
      src: p.src,
      mangaSlug: p.a,
      number: ch.number || entry.number,
      title: ch.title || entry.number,
      mTitle: entry.mTitle || "",
      mPoster: entry.mPoster || "",
      mimes,
      pages: ch.pages.length,
      direction: ch.direction,
      ts: Date.now(),
    };
    const json = JSON.stringify(meta);
    kino.storage.set("dl:" + key, json);
    const s2 = dlState();
    s2.cola = s2.cola.filter((e) => e.cr !== entry.cr);
    s2.lista[entry.cr] = {
      key,
      src: p.src,
      slug: p.a,
      number: meta.number,
      mTitle: meta.mTitle,
      mPoster: meta.mPoster,
      bytes: total,
      pages: ch.pages.length,
      direction: ch.direction,
      ts: Date.now(),
    };
    s2.bytes += total;
    s2.terminadas = (s2.terminadas || 0) + 1;
    saveDlState(s2);
    return { done: entry, bytes: total, pages: ch.pages.length, ms: Date.now() - t0 };
  } catch (e) {
    const s3 = dlState();
    const ent = s3.cola.find((x) => x.cr === entry.cr);
    if (ent) {
      ent.estado = "error";
      ent.err = String((e && e.message) || "error").slice(0, 160);
      saveDlState(s3);
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
