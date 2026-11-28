// v2.17.0 — higiene de headers, PAGE_ID, reintento ante bloqueos temporales y búsqueda de capítulos.
//
// Inteligencia nueva del RCA (otra sesión con navegador real, 2026-11):
//  1) el tema expone CAT_ID, PAGE_ID y PER_PAGE en el JS de la ficha → PAGE_ID alimenta el plan
//     B (REST de hijos por parent=) sin búsqueda por slug, con validación de su primera página;
//  2) NO mandar headers que delaten WebView (X-Requested-With fuera del AJAX);
//  3) la reputación de Cloudflare es temporal (el 1020/403 a veces pasa y a veces no) → UN
//     reintento corto ante 403/429/503 en fetchText;
//  4) el AJAX trae search= → buscar capítulos de TODA la obra desde el detalle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const F = (p) => readFileSync(root + "test/fixtures/" + p, "utf8");
const screen = readFileSync(root + "src/screen.js", "utf8");
const novelsSrc = readFileSync(root + "src/novels.js", "utf8");
const dvSrc = readFileSync(root + "src/devilnovels.js", "utf8");
const envSrc = readFileSync(root + "src/env.js", "utf8");
const manifest = JSON.parse(readFileSync(root + "kino-plugin.json", "utf8"));

test("v2.17.0: manifest y piezas nuevas", () => {
  assert.equal(manifest.version, "2.20.0");
  // (2) higiene de headers: nada que delate WebView/automatización
  assert.ok(!dvSrc.includes('"X-Requested-With"'), "el AJAX sigue mandando X-Requested-With");
  assert.ok(dvSrc.includes('"User-Agent": UA'), "el UA forzado no está en el AJAX");
  // (1) PAGE_ID de la ficha → plan B directo
  assert.ok(dvSrc.includes("function pageIdDe"), "falta pageIdDe");
  assert.ok(dvSrc.includes("PAGE_ID"), "el marcador PAGE_ID del tema no se busca");
  // (4) búsqueda de capítulos
  assert.ok(dvSrc.includes("export async function capsSearch"), "falta capsSearch en dv");
  assert.ok(novelsSrc.includes("dvA.capsSearch(src, slug, opts.search, opts.page)"), "novelChapters no despacha la búsqueda");
  assert.ok(screen.includes('onSubmitted: "capq"'), "falta la caja de búsqueda en el detalle");
  assert.ok(screen.includes('case "capq"'), "falta el evento capq");
  // (3) reintento ante bloqueos temporales
  assert.ok(envSrc.includes("r.status === 403 || r.status === 429 || r.status === 503"), "fetchText no reintenta ante 403/429/503");
});

// ---------- fixtures y mock ----------

const vistas = [];
const contador = new Map();

/** El envelope real del AJAX: 100 por página (total 3249, 33 páginas). Con search no vacío,
 *  responde solo el capítulo pedido (el servidor filtra). */
function paginaAjax(p, q) {
  if (q) {
    const n = /^\d+$/.test(q) ? Number(q) : null;
    const caps = n && n >= 1 && n <= 3249
      ? [{ id: 50000 + n, title: "Capítulo " + n, url: "https://devilnovels.com/esclavo-de-las-sombras/esclavo-de-las-sombras-capitulo-" + n + "/" + (50000 + n) }]
      : [];
    return { success: true, data: { chapters: caps, total: caps.length, pages: 1 } };
  }
  const desde = (p - 1) * 100 + 1;
  const hasta = Math.min(p * 100, 3249);
  const chapters = [];
  for (let n = desde; n <= hasta; n++) {
    const id = 50000 + n;
    chapters.push({ id, title: "Capítulo " + n, url: "https://devilnovels.com/esclavo-de-las-sombras/esclavo-de-las-sombras-capitulo-" + n + "/" + id });
  }
  return { success: true, data: { chapters, total: 3249, pages: 33 } };
}

function restHijos(base, desde, cuantos) {
  const out = [];
  for (let n = desde; n < desde + cuantos; n++) out.push({ id: base + n, slug: (base === 3000 ? "con-pageid" : "obra-mala") + "-capitulo-" + n });
  return out;
}

globalThis.kino = {
  fetch: async (url, opts) => {
    vistas.push(url + (opts && opts.body ? " :: " + opts.body : ""));
    const clave = url.replace(/[?#].*$/, "");
    contador.set(clave, (contador.get(clave) || 0) + 1);
    // el AJAX real del sitio (plan A) — búsqueda o páginas completas
    if (url.includes("wp-admin/admin-ajax.php")) {
      const body = String((opts && opts.body) || "");
      const sm = /&search=([^&]*)/.exec(body);
      const pm = /&page=(\d+)/.exec(body);
      const r = paginaAjax(pm ? Number(pm[1]) : 1, sm ? decodeURIComponent(sm[1] || "") : "");
      return { status: 200, ok: true, headers: {}, text: () => JSON.stringify(r) };
    }
    // reintento del env: 403 una vez y luego 200; 500 siempre (sin reintento)
    if (url.includes("reintento.test/403")) {
      return contador.get(clave) === 1
        ? { status: 403, ok: false, headers: {}, text: () => "bloqueada" }
        : { status: 200, ok: true, headers: {}, text: () => "al segundo intento" };
    }
    if (url.includes("reintento.test/500")) {
      return { status: 500, ok: false, headers: {}, text: () => "rota" };
    }
    const cab = { status: 200, ok: true, headers: { "x-wp-total": "150" } };
    // plan B con PAGE_ID válido de la ficha: parent=888 directo, SIN búsqueda por slug
    if (url.includes("parent=888") && url.includes("order=asc") && url.includes("&page=2&")) {
      return { ...cab, text: () => JSON.stringify(restHijos(3000, 101, 50)) };
    }
    if (url.includes("parent=888") && url.includes("order=asc")) {
      return { ...cab, text: () => JSON.stringify(restHijos(3000, 1, 100)) };
    }
    // PAGE_ID inválido (999 sin hijos válidos): el plan B detecta y busca por slug → 555
    if (url.includes("parent=999")) {
      return { status: 200, ok: true, headers: {}, text: () => JSON.stringify({ code: "rest_post_invalid_id", message: "Invalid post ID." }) };
    }
    if (url.includes("parent=555") && url.includes("order=asc")) {
      return { ...cab, text: () => JSON.stringify(restHijos(4000, 1, 100)) };
    }
    if (url.includes("wp-json/wp/v2/pages?slug=obra-mala")) {
      return { ...cab, text: () => JSON.stringify([{ id: 555, slug: "obra-mala" }]) };
    }
    // fichas (el capítulo del lector va antes: su URL contiene la de la ficha)
    if (url.includes("devilnovels.com/con-pageid/")) {
      return { status: 200, ok: true, headers: {}, text: () => F("dv/pageid.html") };
    }
    if (url.includes("devilnovels.com/obra-mala/")) {
      return { status: 200, ok: true, headers: {}, text: () => F("dv/malapageid.html") };
    }
    if (url.includes("devilnovels.com/esclavo-de-las-sombras/")) {
      return { status: 200, ok: true, headers: {}, text: () => F("dv/esclavo.html") };
    }
    throw new Error("fixture no previsto: " + url.slice(0, 120));
  },
  storage: {
    get: (k) => null,
    set: () => { },
    remove: () => { },
    keys: () => [],
  },
  error: (code, msg) => Object.assign(new Error(msg), { code }),
  config: { get: () => null },
};

const { novelChapters } = await import("../src/novels.js");
const envA = await import("../src/env.js");

test("v2.17.0: fetchText reintenta UNA vez ante 403 y no ante 500", async () => {
  const r1 = await envA.fetchText("https://reintento.test/403/");
  assert.equal(r1.status, 200, "el 403 temporal se recupera al segundo intento: " + r1.status);
  assert.equal(contador.get("https://reintento.test/403/"), 2, "exactamente un reintento");
  const r2 = await envA.fetchText("https://reintento.test/500/");
  assert.equal(r2.status, 500, "un 500 no es bloqueo de Cloudflare: sin reintento");
  assert.equal(contador.get("https://reintento.test/500/"), 1, "un solo intento ante 500");
});

test("v2.17.0: la búsqueda de capítulos llega al AJAX y NO toca la enumeración", async () => {
  const r = await novelChapters("dv", "esclavo-de-las-sombras", { page: 1, postsPerPage: 50, search: "1889" });
  assert.equal(r.items.length, 1, "resultados: " + r.items.length);
  assert.equal(r.items[0].number, "1889");
  assert.equal(r.items[0].slug, "esclavo-de-las-sombras-capitulo-1889.51889");
  assert.equal(r.next, null);
  assert.equal(r.total, 1);
  assert.ok(vistas.some((v) => v.includes("action=dv_load_chapters&cat_id=133&page=1&search=1889")), "el cuerpo del AJAX no llevó search=1889");
  // la enumeración de la obra queda INTACTA (mezclar resultados filtrados corrompería la lista)
  const l1 = await novelChapters("dv", "esclavo-de-las-sombras", { page: 1, postsPerPage: 50 });
  assert.equal(l1.items.length, 50, "el primer lote completo no se contaminó: " + l1.items.length);
  assert.equal(l1.items[0].number, "1");
  assert.equal(l1.total, 3249, "el total completo sigue siendo el real: " + l1.total);
});

test("v2.17.0: PAGE_ID de la ficha alimenta el plan B sin búsqueda por slug", async () => {
  const l1 = await novelChapters("dv", "con-pageid", { page: 1, postsPerPage: 50 });
  assert.equal(l1.items.length, 50, "lote por parent=888: " + l1.items.length);
  assert.equal(l1.items[0].number, "1");
  assert.equal(l1.total, 150);
  assert.ok(!vistas.some((v) => v.includes("pages?slug=con-pageid")), "se buscó por slug pese al PAGE_ID de la ficha");
});

test("v2.17.0: un PAGE_ID equivocado se detecta y cae a la búsqueda por slug", async () => {
  const l1 = await novelChapters("dv", "obra-mala", { page: 1, postsPerPage: 50 });
  assert.equal(l1.items.length, 50, "el respaldo por slug trae el lote: " + l1.items.length);
  assert.equal(l1.items[0].number, "1");
  assert.ok(vistas.some((v) => v.includes("pages?slug=obra-mala")), "no se llegó a la búsqueda por slug");
  assert.ok(!vistas.some((v) => v.includes("pages?slug=obra-mala") && v.includes("::")), "la búsqueda por slug no debía llevar cuerpo");
});
