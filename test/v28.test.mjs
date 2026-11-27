// Tests v2.8: SkyNovels — imágenes en /v1/media/novels/ (thumbs/full) y secciones nuevas de /v1/home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nvl = readFileSync(join(root, "src", "novels.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("skPoster sirve las imágenes por la ruta nueva /v1/media/novels/", () => {
  assert.ok(nvl.includes('"/v1/media/novels/"'), "no usa la ruta nueva de media");
  assert.ok(nvl.includes('(thumb ? "thumbs/" : "")'), "no distingue miniatura/full");
  assert.ok(nvl.includes("encodeURIComponent(String(n.image))"), "no codifica el nombre del archivo");
  assert.ok(!nvl.includes('SK_API + "/img/"'), "la ruta vieja /img/ sigue presente");
});

test("el Home de SkyNovels usa las claves nuevas de la API y la destacada como dict", () => {
  for (const k of ['k: "featured"', 'k: "updated"', 'k: "trending"', 'k: "weekly_views"', 'k: "monthly_views"', 'k: "most_viewed"', 'k: "rising"', 'k: "top_rated"', 'k: "recent"', 'k: "finished"']) {
    assert.ok(nvl.includes(k), "falta la sección " + k);
  }
  assert.ok(nvl.includes("raw && raw.id && raw.title ? [raw]"), "featured no se admite como dict suelto");
  assert.ok(nvl.includes("skPoster(n, true)"), "las tarjetas del Home no piden miniatura");
});

test("la versión avanza a 2.10.0", () => {
  assert.equal(manifest.version, "2.19.0");
  assert.ok(built.includes("/v1/media/novels/"), "el build no lleva la ruta nueva");
});
