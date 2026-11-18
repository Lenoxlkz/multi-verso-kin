// Tests v2.11: la fuente zo (zonatmo.org) funciona por RASPAJE HTML (receta del plugin de
// referencia ZonaTM0) porque .org no sirve la API JSON /wp-api/ — solo zonatmo.net la tiene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "zonatmoorg.js"), "utf8");
const screen = readFileSync(join(root, "src", "screen.js"), "utf8");
const env = readFileSync(join(root, "src", "env.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("zo tiene adaptador propio de raspaje HTML (kind zonatmoorg)", () => {
  assert.ok(env.includes('zo: { name: "ZonaTMO.org", host: "https://zonatmo.org", kind: "zonatmoorg" }'), "zo no tiene kind propio");
  assert.ok(screen.includes('kind === "zonatmoorg" ? zoA'), "el adapter no mapea zo");
  assert.ok(screen.includes('import * as zoA from "./zonatmoorg.js"'), "falta el import del adaptador");
  assert.ok(screen.includes('kind === "zonatmoorg") {'), "el detalle en paralelo no cubre zo");
});

test("receta del plugin de referencia: /biblioteca AJAX, obra y view_uploads", () => {
  assert.ok(src.includes("X-Requested-With"), "la /biblioteca AJAX no va como XHR");
  assert.ok(src.includes('"/biblioteca?title="'), "falta el filtro de la biblioteca");
  assert.ok(src.includes('"/library/" + deSlug(slug) + "/"'), "la obra no se lee de /library/");
  assert.ok(src.includes('"/view_uploads/" + ch.id + "/"'), "el lector no abre /view_uploads/");
  assert.ok(src.includes('" + uploadId +'), "las páginas no se filtran por uploadId (se cuelan banners)");
  assert.ok(src.includes("reader-image"), "falta el plan B del lector");
});

test("las imágenes del lector viven en storage.zonatmo.org (declarado en el manifiesto)", () => {
  assert.ok(manifest.hosts.includes("storage.zonatmo.org"), "el manifiesto no declara storage.zonatmo.org");
  assert.ok(manifest.hosts.includes("zonatmo.org"), "el manifiesto no declara zonatmo.org");
});

test("slugs con puntos (ID_RE admite puntos; el trío tipo.id.nombre viaja en el ref)", () => {
  assert.ok(src.includes('type + "." + id + "." + name'), "el slug interno no codifica tipo/id/nombre");
  assert.ok(src.includes('deSlug(slug)'), "no hay conversión de slug a ruta");
  assert.ok(src.includes('"/library/" + deSlug(slug) + "/"'), "la ruta no sale del slug");
  assert.ok(src.includes('numN.indexOf(".") >= 0 ? String(parseFloat(numN))'), "el número no normaliza ceros finales");
});

test("los capítulos traen TODOS los del HTML (sin paginación) y vecinos completos", () => {
  assert.ok(src.includes("next: null"), "la lista de capítulos no declara que no hay paginación");
  // los vecinos salen como slugs pelados y loadChapter los envuelve en ref completa (igual que zonatmo.js)
  assert.ok(src.includes('prev = "up-"'), "no calcula vecinos");
  assert.ok(src.includes("SERIE_CACHE"), "no hay caché de capítulos por obra");
  assert.ok(src.includes("MAX_CAPS = 490"), "sin tope de capítulos por pantalla");
});

test("la versión avanza a 2.11.0 y el build lleva el adaptador nuevo", () => {
  assert.equal(manifest.version, "2.14.0");
  assert.ok(built.includes('"/view_uploads/" + ch.id + "/"'), "el build no lleva el adaptador zo");
  assert.ok(built.includes("X-Requested-With"), "el build no lleva la receta AJAX");
});
