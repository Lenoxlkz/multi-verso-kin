// v2.18.0 — el Home limpio, el capítulo limpio y la pantalla dedicada por fuente.
//
// RCA 2026-11 (reporte del dispositivo):
//  #1 el «Ranking de novelas» mostraba título + contador de vistas combinados → el título sale
//     de spans con clase de título, los contadores se quitan y un texto que SOLO es contador no
//     vale como título;
//  #3a el lector pintaba imágenes de cabecera (banner/logo) encima del texto → toda imagen que
//      precede al primer párrafo del contenido es cabecera y se descarta;
//  #3b el texto del pie del sitio se colaba → cortes de pie ampliados (case-insensitive) y
//      filtrar() con las frases de la interfaz;
//  #3c el listado mostraba nombres/ids en vez del número real → último número del slug como
//      respaldo y la paginación/rutas sin número ya no son capítulos;
//  #2 el Home gana un «Ver más de <fuente>» que abre una pantalla dedicada con TODO el
//      contenido de la fuente y un botón claro de Salir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const F = (p) => readFileSync(root + "test/fixtures/" + p, "utf8");
const dvSrc = readFileSync(root + "src/devilnovels.js", "utf8");
const screenSrc = readFileSync(root + "src/screen.js", "utf8");
const novelsSrc = readFileSync(root + "src/novels.js", "utf8");
const manifest = JSON.parse(readFileSync(root + "kino-plugin.json", "utf8"));

test("v2.18.0: manifest y piezas nuevas", () => {
  assert.equal(manifest.version, "2.18.0");
  // #1: contadores fuera del título
  assert.ok(dvSrc.includes("function quitaVistas"), "falta quitaVistas");
  assert.ok(dvSrc.includes("function esContador"), "falta esContador");
  assert.ok(dvSrc.includes("titulo|title"), "no se busca el span con clase de título");
  // #3a/#3b: capítulo limpio
  assert.ok(dvSrc.includes("p.imgs = p.imgs.slice"), "las imágenes de cabecera no se descartan");
  assert.ok(dvSrc.includes("marcaUsada"), "no se re-corta al contenido dentro de <article>");
  assert.ok(dvSrc.includes('"entry-footer"'), "faltan cortes de pie del tema");
  assert.ok(dvSrc.includes("devilnovels\\.com|derechos reservados"), "filtrar no cubre el pie real");
  // #3c: números reales
  assert.ok(dvSrc.includes("function lastNumberDe"), "falta lastNumberDe");
  assert.ok(dvSrc.includes("numDe(cs) || lastNumberDe(cs)"), "el número no usa el último número del slug");
  assert.ok(dvSrc.includes("RUTAS_FIJAS.test(cs2)"), "la paginación entra como capítulo");
  // #2: pantalla dedicada por categoría/fuente
  assert.ok(screenSrc.includes('route: "fuente"'), "el catálogo no abre la ruta fuente");
  assert.ok(screenSrc.includes('case "fuente"'), "screen no despacha la ruta fuente");
  assert.ok(!screenSrc.includes('"Ver más de " + SOURCES[src].name'), "no debe quedar el botón inferior Ver más de [fuente]");
  assert.ok(screenSrc.includes("Salir (volver al Home)"), "falta el botón de Salir");
  assert.ok(screenSrc.includes("loadFuenteAll"), "falta la carga por fuente");
  assert.ok(novelsSrc.includes("dvA.home(src, opts)"), "novelHome no pasa la opción full");
});

// ---------- fixtures y mock ----------

globalThis.kino = {
  fetch: async (url) => {
    const u = String(url);
    if (u.includes("capitulo-1889/51889")) return { status: 200, ok: true, headers: {}, text: () => F("dv/capitulo-real.html") };
    if (u.includes("devilnovels.com/esclavo-de-las-sombras/")) return { status: 200, ok: true, headers: {}, text: () => F("dv/esclavo.html") };
    if (u.includes("/listado-de-novelas")) return { status: 200, ok: true, headers: {}, text: () => F("dv/inicio.html") };
    if (u.includes("/novelas-finalizadas")) return { status: 200, ok: true, headers: {}, text: () => F("dv/finalizadas.html") };
    if (u.includes("/obra-renombre/page/")) throw new Error("fixture no previsto (página del listado): " + u);
    if (u.includes("/obra-renombre/")) return { status: 200, ok: true, headers: {}, text: () => F("dv/renombre.html") };
    if (/devilnovels\.com\/?$/.test(u)) return { status: 200, ok: true, headers: {}, text: () => F("dv/inicio.html") };
    throw new Error("fixture no previsto: " + u.slice(0, 120));
  },
  storage: { get: () => null, set: () => { }, remove: () => { }, keys: () => [] },
  error: (code, msg) => Object.assign(new Error(msg), { code }),
  config: { get: () => null },
};

const dvA = await import("../src/devilnovels.js");
const { novelChapters } = await import("../src/novels.js");
const mod = await import("../src/screen.js");

test("v2.18.0 (#1): el ranking separa el título del contador de vistas", async () => {
  const rows = await dvA.home("dv");
  const ranking = rows.find((r) => (r.title || "").includes("Ranking"));
  assert.ok(ranking, "no hay sección de ranking: " + rows.map((r) => r.title).join(", "));
  const titulos = ranking.items.map((x) => x.title);
  assert.ok(titulos.includes("La espada del vagabundo"), "título del span con clase: " + titulos.join(" | "));
  assert.ok(titulos.includes("El cazador de tormentas"), "el contador antes del span de título no tumba la extracción");
  assert.ok(titulos.includes("Reina en la niebla"), "la tarjeta con title attr");
  assert.ok(titulos.every((t) => !/vistas/i.test(t)), "un título sigue llevando el contador: " + titulos.join(" | "));
  assert.ok(!titulos.some((t) => /^\d/.test(t)), "un contador quedó como título: " + titulos.join(" | "));
});

test("v2.18.0 (#3a): el lector no pinta la cabecera del sitio", async () => {
  const c = await dvA.chapter("dv", "esclavo-de-las-sombras", "esclavo-de-las-sombras-capitulo-1889.51889");
  assert.ok(!c.imgs.some((u) => /banner-cabecera|hero-inicio/.test(u)), "una imagen de cabecera llegó al lector: " + c.imgs.join(", "));
  assert.ok(c.imgs.some((u) => /ilustracion-media/.test(u)), "la ilustración DEL CUERPO se perdió: " + c.imgs.join(", "));
  assert.ok(c.text.some((t) => t.includes("La lluvia caía")), "falta el primer párrafo");
  assert.ok(c.text.some((t) => t.includes("No abras esa puerta")), "falta el diálogo");
  // #3b: el pie del sitio no se cuela
  assert.ok(!c.text.some((t) => /Etiquetas:|Derechos reservados|También te puede gustar|Anterior: Capítulo/i.test(t)), "texto de la interfaz en el capítulo: " + c.text.join(" ∥ "));
  assert.equal(c.number, "1889", "el número real del capítulo");
});

test("v2.18.0 (#3c): slugs renombrados dan el número real y la paginación no es capítulo", async () => {
  const l1 = await novelChapters("dv", "obra-renombre", { page: 1, postsPerPage: 50 });
  assert.deepEqual(l1.items.map((x) => x.number), ["77", "78"], "números de los capítulos renombrados: " + l1.items.map((x) => x.number).join(", "));
  assert.equal(l1.total, 2, "la paginación y las rutas sin número no cuentan como capítulos");
});

test("v2.18.0 (#2): la pantalla dedicada de la fuente lleva Salir y el Home enlaza por categoría", async () => {
  // sin estado cargado: esqueleto + Salir + Reintentar (la carga llega por el evento open)
  const v = await mod.screen({ route: { name: "fuente", args: { s: "dv" } }, lang: "es", device: "phone", state: {} });
  const s = JSON.stringify(v);
  assert.ok(s.includes("Salir (volver al Home)"), "la pantalla dedicada no tiene botón de Salir");
  assert.ok(s.includes("DevilNovels · "), "título de la pantalla dedicada");
  assert.ok(s.includes("Reintentar"), "sin datos debe poder reintentarse");
  // el Home con estantes: sin botón inferior repetido y cada fila con su ref de categoría
  const m = await mod.screen({ route: { name: "main" }, lang: "es", device: "phone", state: { hsrc: "dv", done: true, hrows: [{ id: "dv-ranking", ref: "dv:ranking", title: "Ranking de novelas", items: [{ s: "dv|m|la-espada-del-vagabundo", t: "La espada del vagabundo", p: "https://devilnovels.com/espada.jpg" }] }] } });
  const sm = JSON.stringify(m);
  assert.ok(!sm.includes("Ver más de DevilNovels"), "el botón inferior Ver más de DevilNovels debe haberse eliminado");
  assert.ok(sm.includes('"ref":"dv:ranking"') || sm.includes('"ref": "dv:ranking"'), "el riel de categoría debe llevar su ref dv:ranking");
  assert.ok(sm.includes('\"route\": \"fuente\"') || sm.includes('"route":"fuente"'), "el héroe apunta a la ruta fuente");
  assert.ok(sm.includes('"s": "dv"') || sm.includes('"s":"dv"'), "el héroe lleva la fuente como argumento");
});
