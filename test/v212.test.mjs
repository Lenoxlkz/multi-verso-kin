// Tests v2.12: DevilNovels (dv) pasa de «madara» a su propio adaptador de RASPAJE HTML.
// devilnovels.com NO es madara (a diferencia de anslid.com): las novelas viven en la RAÍZ del
// dominio y los capítulos cuelgan de su novela con la id de post. Las URLs reales están verificadas
// en el índice del sitio (esclavo-de-las-sombras, martial-god-asura-capitulo-6556/197310, …).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "devilnovels.js"), "utf8");
const novels = readFileSync(join(root, "src", "novels.js"), "utf8");
const env = readFileSync(join(root, "src", "env.js"), "utf8");
const screen = readFileSync(join(root, "src", "screen.js"), "utf8");
const catalog = readFileSync(join(root, "src", "catalog.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
const F = (n) => readFileSync(join(root, "test", "fixtures", n), "utf8");

test("dv tiene adaptador propio de raspaje HTML (kind devilnovels)", () => {
  assert.ok(env.includes('dv: { name: "DevilNovels", host: "https://devilnovels.com", kind: "devilnovels" }'), "dv no tiene kind propio");
  assert.ok(novels.includes('import * as dvA from "./devilnovels.js"'), "novels.js no importa el adaptador dv");
  assert.ok(novels.includes('if (k === "devilnovels") return dvA.detail'), "el detalle de dv no va por el adaptador nuevo");
  assert.ok(novels.includes('if (k === "devilnovels") return dvA.chapter'), "el lector de dv no va por el adaptador nuevo");
  // v2.15.0: el detalle de dv ya NO incrusta la lista (la ficha solo trae los extremos);
  // los capítulos llegan POR LOTES vía novelChapters → capsPage (desde v2.17, con búsqueda)
  assert.ok(novels.includes("return dvA.capsPage(src, slug, opts);"), "novelChapters no despacha dv por lotes");
  assert.ok(!novels.includes("d.chapters = await dvA.capsList"), "el detalle de dv sigue bajando TODA la obra al abrirlo");
});

test("receta real del sitio: novelas en la raíz y capítulos con id de post", () => {
  // nada de /novela/ (eso es madara y aquí no existe)
  assert.ok(!src.includes('"/novela/'), "el adaptador dv sigue pidiendo /novela/ (madara)");
  assert.ok(src.includes('"/" + slug + "/"'), "la ficha no se lee de la raíz");
  assert.ok(src.includes('"/" + slug + "/" + capSlug + "/" + id + "/"'), "el capítulo no monta /novela/capitulo/id");
  assert.ok(src.includes("/capitulo/i"), "el número del capítulo sale del slug -capitulo-N");
  // listados nativos y búsqueda de WordPress
  assert.ok(src.includes('"/listado-de-novelas"'), "falta el listado nativo");
  assert.ok(src.includes('"/novelas-finalizadas"'), "falta la sección de finalizadas");
  assert.ok(src.includes('"/?s=" + encodeURIComponent(t)'), "la búsqueda no usa la de WordPress");
});

test("la id de post ordena los capítulos (orden cronológico real) y da vecinos", () => {
  assert.ok(src.includes('(Number(a.id) || 0) - (Number(b.id) || 0)'), "los capítulos no se ordenan por id de post");
  // v2.15.0: los vecinos viven en vecinosDe/vecinosEn (REST en descenso, sin bajar la obra entera)
  assert.ok(src.includes("rows[i - 1].capSlug + \".\" + rows[i - 1].id"), "prev no es el capítulo anterior");
  assert.ok(src.includes("rows[i + 1].capSlug + \".\" + rows[i + 1].id"), "next no es el capítulo siguiente");
  assert.ok(src.includes('r.capSlug + "." + r.id'), "el slug del capítulo no guarda <slug>.<id>");
});

test("el texto del capítulo descarta el chrome del sitio", () => {
  assert.ok(src.includes('class="reading-content"'), "falta el marcador madara heredado");
  assert.ok(src.includes('class="entry-content"'), "falta el marcador estándar de WordPress");
  assert.ok(src.includes('"novelaschinas"'), "el aviso del pie no se corta");
  assert.ok(src.includes("novelaschinas\\.org|devilnovels\\.com|derechos reservados"), "el filtro de ruido no cubre el pie");
});

test("la búsqueda global de Kino alcanza las novelas (antes caían en manhwa)", () => {
  assert.ok(catalog.includes("esNovela(s) ? nv.novelSearch(s, q)"), "catalog.js no despacha las novelas");
});

test("«Abrir en el navegador» apunta a la raíz del dominio", () => {
  assert.ok(screen.includes('kind === "devilnovels"'), "siteUrlOf no cubre devilnovels");
});

test("la versión avanza y el build lleva el adaptador nuevo", () => {
  assert.equal(manifest.version, "2.20.0");
  assert.ok(built.includes('"/" + slug + "/" + capSlug + "/" + id + "/"'), "el build no lleva el adaptador dv");
  assert.ok(built.includes("esNovela(s) ? novelSearch(s, q)"), "el build no lleva la búsqueda de novelas");
});

test("v2.12.1: sin residuos de la versión pasada y con plazos de zonatmo.org", () => {
  // el adaptador viejo (madara) dejó el host marcado «blocked» 24 h en kino.storage: probeCf lo
  // creía sin pedir nada y la pestaña de dv moría sin correr el adaptador nuevo
  assert.ok(env.includes('const CFSEEN_KEY = "cfseen3";'), "la marca CF vieja sigue en cfseen2 (residuo)");
  assert.ok(screen.includes("st.ageMs < 15 * 60 * 1000"), "probeCf sigue creyendo marcas viejas sin comprobar");
  assert.ok(src.includes("timeoutMs: timeout || 45000"), "dv usa el plazo corto de 12 s (WP pesado)");
  assert.ok(!src.includes("timeoutFor"), "dv ya no depende de timeoutFor");
});

// ---------- el adaptador funciona de verdad (fixtures con las URLs reales) ----------

const store = new Map();
globalThis.kino = {
  fetch: async (url) => {
    // los específicos van primero: la URL del capítulo CONTIENE la de la ficha
    const map = [
      ["devilnovels.com/esclavo-de-las-sombras/esclavo-de-las-sombras-capitulo-1889/124182/", "dv/capitulo.html"],
      ["devilnovels.com/esclavo-de-las-sombras/", "dv/ficha.html"],
      ["devilnovels.com/?s=", "dv/busqueda.html"],
      ["devilnovels.com/listado-de-novelas", "dv/busqueda.html"],
      ["devilnovels.com/novelas-finalizadas", "dv/finalizadas.html"],
      ["devilnovels.com/", "dv/busqueda.html"],
    ];
    for (const [k, f] of map) {
      if (url.includes(k)) return { status: 200, ok: true, text: () => F(f) };
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

const { novelSearch, novelHome, novelDetail, novelChapter, novelChapters } = await import("../src/novels.js");

test("dv búsqueda: tarjetas raíz con título y portada, sin ruido del sitio", async () => {
  const s = await novelSearch("dv", "sombras");
  assert.ok(s.items.length >= 2, "resultados: " + s.items.length);
  const esclavo = s.items.find((i) => i.title === "Esclavo de las Sombras");
  assert.ok(esclavo, "no encontró Esclavo de las Sombras");
  assert.ok(String(esclavo.poster).includes("esclavo-portada"), "portada equivocada");
  assert.ok(!s.items.some((i) => ["listado de novelas", "page", "membership join", "imagenes"].includes(String(i.title).toLowerCase())), "el ruido se coló como novela");
});

test("dv detalle: metadatos, y capítulos POR LOTES (REST caída → extremos de la ficha)", async () => {
  const d = await novelDetail("dv", "esclavo-de-las-sombras");
  assert.equal(d.title, "Esclavo de las Sombras");
  assert.ok(String(d.poster).includes("esclavo-portada"), "portada");
  assert.ok(d.overview && d.overview.length > 20, "sinopsis vacía");
  assert.ok(d.genres.includes("Acción"), "géneros: " + d.genres.join(","));
  // v2.15.0: la ficha ya no arrastra la lista completa — llega por lotes y SIN red extra
  // (el motor detecta la REST caída y entrega lo que tiene: los extremos de la ficha)
  const lote = await novelChapters("dv", "esclavo-de-las-sombras", { page: 1, postsPerPage: 50 });
  assert.equal(lote.items.length, 4, "lote: " + lote.items.length);
  assert.equal(lote.items[0].number, "1");
  assert.equal(lote.items[3].number, "1889");
  assert.ok(lote.items.some((c) => c.number === "1.2"), "el capítulo partido (-1-2) no sale como 1.2");
  assert.equal(lote.next, null, "con 4 capítulos no hay siguiente lote");
  assert.equal(lote.total, 4, "total: " + lote.total);
});

test("dv lector: párrafos limpios, ilustraciones y vecinos por id", async () => {
  const c = await novelChapter("dv", "esclavo-de-las-sombras", "esclavo-de-las-sombras-capitulo-1889.124182");
  assert.ok(c.text.length >= 3, "párrafos: " + c.text.length);
  assert.ok(!c.text.some((t) => /novelaschinas|derechos reservados|Deja una respuesta/i.test(t)), "el chrome del sitio se coló");
  assert.ok(c.imgs && c.imgs.length === 1, "ilustraciones: " + (c.imgs || []).length);
  assert.equal(c.number, "1889");
  assert.equal(c.prev, "shadow-slave-capitulo-1-2.116637", "prev no es el capítulo anterior");
  assert.equal(c.next, null, "el último capítulo no tiene next");
});

test("dv home: secciones nativas (ranking, listado, finalizadas)", async () => {
  const h = await novelHome("dv");
  assert.ok(h.length >= 2, "secciones: " + h.length);
  for (const sh of h) assert.ok(sh.title && sh.items.length && sh.items[0].ref.startsWith("dv|"));
});
