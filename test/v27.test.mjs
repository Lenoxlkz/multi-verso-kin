// Tests v2.7: portada real en las tarjetas Madara (lazy-load), Referer opcional por fuente,
// desafío JS de zonatmo.org, y eliminación completa de LegnNovels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "screen.js"), "utf8");
const env = readFileSync(join(root, "src", "env.js"), "utf8");
const nvl = readFileSync(join(root, "src", "novels.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("madaraCards toma la portada real, nunca el placeholder de lazy-load", () => {
  assert.ok(nvl.includes('matchAll(/(?:data-src|src)="([^"]+)"/g)'), "no busca data-src y src en orden");
  assert.ok(nvl.includes("dflazy"), "no descarta el placeholder dflazy");
  // data-src debe probarse ANTES que src: en el HTML de Madara src=dflazy.jpg va primero
  assert.ok(nvl.indexOf("matchAll(/(?:data-src|src)") > 0, "no hay selector ordenado");
  const posterFn = nvl.slice(nvl.indexOf("for (const mm of seg.matchAll"), nvl.indexOf("})(seg);"));
  assert.ok(posterFn.includes("if (!/dflazy"), "el filtro del placeholder no aplica por candidato");
});

test("imgHeads: UA interno siempre; Referer solo por fuente (mapa) o forzado", () => {
  assert.ok(env.includes("const IMG_REFERER"), "falta el mapa por fuente");
  assert.ok(env.includes("astralnovelstranslations.wordpress.com"), "Astral no está en el mapa");
  assert.ok(env.includes('force === true || (force !== false'), "la fuerza/mapa no decide el Referer");
  assert.ok(env.includes('"User-Agent": UA'), "el UA no es el interno");
  // el rail de recientes sigue sin Referer (mezcla fuentes) y el resto lo decide el mapa
  assert.ok(src.includes("imgHeads(seguir.items.find((x) => x.p && x.p.indexOf(\"http\") === 0)?.p, false)"), "el rail mixto cambió");
  assert.ok(src.includes("headers: imgHeads(primerP && primerP.p)"), "el rail de estantes no pasa por el mapa");
});

test("la detección del desafío nace del registro HTTP (sin petición extra)", () => {
  assert.ok(env.includes("function noteHttp") && env.includes("function cfChallengeSeen"), "falta el registro");
  assert.ok(env.includes("noteHttp(url, r.status, text)"), "fetchText no registra");
  assert.ok(env.includes("export function cfChallengeSeen"), "el registro no se exporta");
  assert.ok(src.includes("cfChallengeSeen(base)"), "la sonda no consulta el registro primero");
});

test("isCfChallenge cubre el desafío JS de zonatmo.org", () => {
  for (const marca of ["used cloudflare to restrict access", "access denied", "challenge-platform"]) {
    assert.ok(env.toLowerCase().includes(marca), "falta la marca " + marca);
  }
});

test("LegnNovels eliminada en todos los sitios", () => {
  assert.equal(existsSync(join(root, "src", "downloads.js")), false);
  assert.ok(!env.includes('"ln"'), "env.js aún la lista");
  assert.ok(!env.includes("legnnovels"), "env.js aún tiene su host");
  assert.ok(!nvl.includes("legnnovels"), "novels.js aún tiene su host");
  assert.ok(!src.includes('"ln"') && !src.includes("legnnovels"), "screen.js aún la lista");
  assert.ok(!manifest.hosts.some((h) => h.includes("legnnovels")), "el manifiesto aún declara sus hosts");
  assert.ok(!manifest.description.includes("LegnNovels"), "la descripción aún la nombra");
  assert.ok(!built.includes("legnnovels"), "el build aún la menciona");
});

test("las cabeceras base no identifican WebView (sin X-Requested-With global)", () => {
  const base = env.slice(env.indexOf("const BASE_HEADS"), env.indexOf("};", env.indexOf("const BASE_HEADS")));
  assert.ok(base.includes('"User-Agent": UA'), "el UA no está en la base");
  assert.ok(!base.includes("X-Requested-With"), "la base manda X-Requested-With (hueco de WebView)");
  // solo admin-ajax lo lleva, donde WordPress lo exige
  const ajax = nvl.slice(nvl.indexOf("wp-admin/admin-ajax.php") - 200, nvl.indexOf("wp-admin/admin-ajax.php") + 200);
  assert.ok(ajax.includes("XMLHttpRequest"), "admin-ajax no lleva su header propio");
});
