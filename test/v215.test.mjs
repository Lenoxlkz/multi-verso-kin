// v2.15.0 — capítulos COMPLETOS por carga progresiva y filtro de orden de capítulos.
//
// 1) DevilNovels: la ficha solo lista los extremos y las novelas llegan a 3000+ capítulos. El
//    motor nuevo enumera TODO por la REST de WordPress (los capítulos son páginas hijas:
//    wp-json/wp/v2/pages?parent=<id>, 100 por página, total real en X-WP-Total), con la
//    paginación de la ficha y sus filas como planes de respaldo. capsPage entrega LOTES
//    (nada baja la obra de golpe); vecinosDe da prev/next al lector con páginas DESC.
// 2) La misma interfaz de lotes ({items, next, total}) cubre a TODAS las fuentes de novela:
//    las API de una respuesta (Skynovels…) cortan su caché, sin segundas descargas.
// 3) El detalle de manga y novelas gana el filtro de orden (antiguos/recientes primero),
//    aplicado al instante y persistido.
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

test("v2.15.0: manifest y piezas del motor progresivo", () => {
  assert.equal(manifest.version, "2.15.0");
  // el motor REST de DevilNovels
  assert.ok(dvSrc.includes("wp-json/wp/v2/pages"), "falta la REST de WordPress en dv");
  assert.ok(dvSrc.includes("export async function capsPage"), "falta capsPage (lotes)");
  assert.ok(dvSrc.includes("export async function vecinosDe"), "falta vecinosDe (lector sin obra entera)");
  assert.ok(dvSrc.includes('"x-wp-total"'), "el total real de la REST no se lee");
  assert.ok(dvSrc.includes("enumFichaPaginas"), "falta el plan B (paginación de la ficha)");
  // la interfaz uniforme para TODAS las fuentes de novela
  assert.ok(novelsSrc.includes("export async function novelChapters"), "falta novelChapters");
  assert.ok(novelsSrc.includes("async function skCaps") && novelsSrc.includes("async function mkCaps"), "faltan los loaders únicos");
  // la pantalla pide el primer lote y sabe pedir el siguiente
  assert.ok(screen.includes("nv.novelChapters(p.src, p.a, { page: 1"), "loadDetail no pide el lote de novelas");
  assert.ok(screen.includes(".concat(more).slice(0, 4000)"), "el estado del detalle sigue cortado en 500");
  // el filtro de orden en el detalle
  assert.ok(screen.includes('event: "capsOrder"'), "falta el evento capsOrder");
  assert.ok(screen.includes('"capsOrden"'), "el orden no se guarda para las próximas visitas");
  assert.ok(screen.includes("Antiguos primero") && screen.includes("Recientes primero"), "faltan los dos botones de orden");
  // fetchJson expone cabeceras (el total de la REST llega por X-WP-Total)
  assert.ok(envSrc.includes("return { status, ok, body, headers"), "fetchJson no expone cabeceras");
});

// ---------- DevilNovels: REST de WordPress, lotes y vecinos ----------

const store = new Map();
globalThis.kino = {
  fetch: async (url) => {
    const cab = { status: 200, ok: true, headers: { "x-wp-total": "150" } };
    // REST de WordPress: búsqueda de la página madre y páginas de hijos (asc y desc).
    // «&page=N&» con los & para no confundir con «per_page=100»
    if (url.includes("wp-json/wp/v2/pages?slug=la-obra")) {
      return { ...cab, text: () => JSON.stringify([{ id: 777, slug: "la-obra" }]) };
    }
    if (url.includes("parent=777") && url.includes("order=asc") && url.includes("&page=2&")) {
      return { ...cab, text: () => JSON.stringify(paginaRest(101, 50)) };
    }
    if (url.includes("parent=777") && url.includes("order=asc")) {
      return { ...cab, text: () => JSON.stringify(paginaRest(1, 100)) };
    }
    if (url.includes("parent=777") && url.includes("order=desc") && url.includes("&page=2&")) {
      return { ...cab, text: () => JSON.stringify(paginaRest(1, 50)) };
    }
    if (url.includes("parent=777") && url.includes("order=desc")) {
      return { ...cab, text: () => JSON.stringify(paginaRest(51, 100)) };
    }
    // Skynovels: la API entrega TODOS los capítulos en una respuesta (120)
    if (url.includes("api.skynovels.net/v1/novels/novela-x/chapters")) {
      return {
        status: 200, ok: true, headers: {},
        text: () => JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: i + 1, number: i + 1, title: "Capítulo " + (i + 1) }))),
      };
    }
    // ficha con los extremos (el capítulo del lector va antes: su URL contiene la de la ficha)
    if (url.includes("devilnovels.com/la-obra/la-obra-capitulo-150/1150/")) {
      return { status: 200, ok: true, headers: {}, text: () => F("dv/capitulo.html") };
    }
    if (url.includes("devilnovels.com/la-obra/")) {
      return { status: 200, ok: true, headers: {}, text: () => F("dv/rest.html") };
    }
    throw new Error("fixture no previsto: " + url.slice(0, 120));
  },
  storage: {
    get: (k) => store.get(k) || null,
    set: (k, v) => store.set(k, String(v)),
    remove: (k) => store.delete(k),
    keys: () => [...store.keys()],
  },
  error: (code, msg) => Object.assign(new Error(msg), { code }),
  config: { get: () => null },
};

/** Página REST: «desde» y «cuántos» → capítulos N con id 1000+N (la id crece con el tiempo). */
function paginaRest(desde, cuantos) {
  const out = [];
  for (let n = desde; n < desde + cuantos; n++) out.push({ id: 1000 + n, slug: "la-obra-capitulo-" + n });
  return out;
}

const { novelDetail, novelChapter, novelChapters } = await import("../src/novels.js");
const dvA = await import("../src/devilnovels.js");

test("dv lotes: la ficha trae los extremos y la REST completa la obra (150 caps)", async () => {
  const d = await novelDetail("dv", "la-obra");
  assert.equal(d.title, "La Obra");
  assert.equal(d.chapters, undefined, "el detalle no debe bajar la obra entera");
  const l1 = await novelChapters("dv", "la-obra", { page: 1, postsPerPage: 50 });
  assert.equal(l1.items.length, 50, "primer lote: " + l1.items.length);
  assert.equal(l1.items[0].number, "1");
  assert.equal(l1.items[49].number, "50");
  assert.equal(l1.next, 2, "hay más lotes");
  assert.equal(l1.total, 150, "el total real llega por X-WP-Total: " + l1.total);
  // el lote 3 pide la página REST que falta (100 filas cargadas → 150)
  const l3 = await novelChapters("dv", "la-obra", { page: 3, postsPerPage: 50 });
  assert.equal(l3.items.length, 50, "tercer lote: " + l3.items.length);
  assert.equal(l3.items[0].number, "101");
  assert.equal(l3.items[49].number, "150");
  assert.equal(l3.next, null, "no hay más lotes");
});

test("dv vecinos: el lector no baja la obra entera (REST en descenso)", async () => {
  // el más nuevo: la primera página desc basta; next = null porque es el último de todos
  const v = await dvA.vecinosDe("la-obra", "1150");
  assert.deepEqual(v, { prev: "la-obra-capitulo-149.1149", next: null });
  // uno que abre la página desc (el más viejo de las 100 nuevas): baja UNA página más
  const v2 = await dvA.vecinosDe("la-obra", "1051");
  assert.deepEqual(v2, { prev: "la-obra-capitulo-50.1050", next: "la-obra-capitulo-52.1052" });
});

test("dv lector: prev/next salen del motor nuevo (mismo formato <cap>.<id>)", async () => {
  const c = await novelChapter("dv", "la-obra", "la-obra-capitulo-150.1150");
  assert.ok(c.text.length >= 2, "párrafos: " + c.text.length);
  assert.equal(c.prev, "la-obra-capitulo-149.1149", "prev: " + c.prev);
  assert.equal(c.next, null, "next: " + c.next);
});

// ---------- las demás fuentes: lotes desde su caché, sin segundas descargas ----------

test("sk lotes: la API de una respuesta se corta en lotes (50) con total real", async () => {
  const l1 = await novelChapters("sk", "novela-x", { page: 1, postsPerPage: 50 });
  assert.equal(l1.items.length, 50, "primer lote sk: " + l1.items.length);
  assert.equal(l1.next, 2);
  assert.equal(l1.total, 120);
  assert.equal(l1.items[0].number, "1");
  const l3 = await novelChapters("sk", "novela-x", { page: 3, postsPerPage: 50 });
  assert.equal(l3.items.length, 20, "último lote sk: " + l3.items.length);
  assert.equal(l3.next, null, "se acabaron los lotes");
  assert.equal(l3.total, 120);
});

// ---------- el filtro de orden en el detalle ----------

test("filtro de orden: se aplica al instante y queda persistido", async () => {
  const { screenEvent } = await import("../src/screen.js");
  const r = await screenEvent({ name: "capsOrder", arg: "desc", state: { detail: { chapters: [] } }, lang: "es" });
  assert.equal(r.state.capsOrder, "desc", "el estado no cambia al instante");
  assert.equal(store.get("capsOrden"), "desc", "no se persistió la preferencia");
  const r2 = await screenEvent({ name: "capsOrder", arg: "asc", state: { capsOrder: "desc" }, lang: "es" });
  assert.equal(r2.state.capsOrder, "asc");
  assert.equal(store.get("capsOrden"), "asc");
});

test("Primero/Último quedan cronológicos aunque la lista esté en desc", () => {
  // el orden de muestra no decide qué es primero: el número del capítulo sí
  assert.ok(screen.includes("const cronologica = ordenarCaps(d.chapters, \"asc\")"), "Primero/Último no son cronológicos");
  assert.ok(screen.includes("return orden === \"desc\" ? asc.slice().reverse() : asc"), "el orden desc no invierte");
});
