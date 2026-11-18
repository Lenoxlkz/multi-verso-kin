// v2.14.0 — la v2.13.0 rompió la fuente por completo («no respondió»): su buscador exigía la
// ancla completa «<a …>…</a>» y con el HTML real de DevilNovels se quedaba SIN tarjetas →
// home vacío → loadHomeShelves llamaba a probeCf y enseñaba el error genérico. La 2.12.1 sí
// mostraba contenido porque su buscador (href raíz con primer texto, sin exigir </a>) toleraba
// el HTML roto del sitio. Esta batería replica esas variantes reales y exige la UNIÓN:
// todo lo que veía la 2.12.1 + la calidad de la 2.13.0 (títulos propios, data-src, sin menú).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const F = (p) => readFileSync(root + "test/fixtures/" + p, "utf8");
const src = readFileSync(root + "src/devilnovels.js", "utf8");
const env = readFileSync(root + "src/env.js", "utf8");
const manifest = JSON.parse(readFileSync(root + "kino-plugin.json", "utf8"));

test("v2.14.0: manifest y unión de las dos versiones (buscador 2.12.1 + calidad 2.13.0)", () => {
  assert.equal(manifest.version, "2.15.0");
  // el buscador base NO exige el cierre </a> (lo que mató la fuente en la 2.13.0)
  assert.ok(src.includes("([^>]*)>([^<]{0,200})<"), "falta el buscador tolerante de la 2.12.1");
  assert.ok(!src.includes("{0,4000}"), "residuo del inner de 4000 de la 2.13.0");
  // y la calidad de la 2.13.0 sigue dentro
  assert.ok(/\["data-src", "data-lazy-src", "data-original", "src"\]/.test(src), "sin orden de preferencia de atributos");
  assert.ok(src.includes('"https://devilnovels.com" + u'), "sin absolutización de URLs");
  assert.ok(src.includes("max * 2 > conImg.length"), "sin seguro anti-portadas repetidas");
  assert.ok(src.includes("esAuthText(title)"), "sin filtro de acciones de cuenta");
  assert.ok(!src.includes("2600"), "la ventana de 2600 hacia atrás sigue ahí");
  // la marca CF se renueva para que el dispositivo arranque limpio (cfseen3)
  assert.ok(env.includes('const CFSEEN_KEY = "cfseen3";'), "la clave de marcas CF no se renovó");
});

// ---------- el adaptador contra el HTML roto real (fixture viejo.html) ----------

const store = new Map();
globalThis.kino = {
  fetch: async (url) => {
    const map = [
      ["devilnovels.com/novelas-finalizadas", "dv/finalizadas.html"],
      ["devilnovels.com/", "dv/viejo.html"],
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

const { novelHome } = await import("../src/novels.js");

test("dv home sobre HTML roto: la fuente YA NO se queda sin tarjetas (regresión 2.13.0)", async () => {
  const h = await novelHome("dv");
  const ranking = h.find((sh) => sh.id === "dv-ranking");
  assert.ok(ranking && ranking.items.length >= 6, "tarjetas en ranking: " + (ranking && ranking.items.length));
  const titulos = ranking.items.map((i) => i.title);
  // las seis variantes de HTML real salen, cada una con SU título
  for (const t of ["Novela Sin Cierre", "Novela con Espacio", "Novela Padre", "Novela Hija", "Novela Mayúscula", "Novela Larga", "Novela Lazy"]) {
    assert.ok(titulos.includes(t), "falta «" + t + "»: " + titulos.join(" | "));
  }
  // y el menú de cuenta sigue fuera
  assert.ok(!titulos.some((t) => /iniciar sesi|registrarse|recuperar|acortador/i.test(t)), "el menú se coló: " + titulos.join(" | "));
});

test("dv home sobre HTML roto: títulos sin contaminar entre tarjetas", async () => {
  const h = await novelHome("dv");
  const ranking = h.find((sh) => sh.id === "dv-ranking");
  const titulos = ranking.items.map((i) => i.title);
  assert.equal(new Set(titulos).size, titulos.length, "títulos repetidos: " + titulos.join(" | "));
  // «Novela Larga» existe aunque su </a> queda a 5659 caracteres (fuera de cualquier ventana)
  assert.ok(titulos.includes("Novela Larga"), "sin la tarjeta E: " + titulos.join(" | "));
  // «Novela Padre» e «Hija» anidadas: cada una con su título propio
  assert.ok(titulos.includes("Novela Padre") && titulos.includes("Novela Hija"), "anidadas mal resueltas");
  // «Novela Sin Cierre» no hereda el h4 de la tarjeta vecina (el tramo roto se descarta)
  assert.ok(titulos.includes("Novela Sin Cierre"), "la tarjeta A perdió su título propio");
});

test("dv home sobre HTML roto: portadas de verdad (data-src, absolutas, sin sustitutos)", async () => {
  const h = await novelHome("dv");
  const ranking = h.find((sh) => sh.id === "dv-ranking");
  const por = Object.fromEntries(ranking.items.map((i) => [i.title, i.poster]));
  // A: la portada es SU imagen (data-src), no el sustituto dflazy ni la de la tarjeta vecina
  assert.equal(por["Novela Sin Cierre"], "https://devilnovels.com/wp-content/uploads/2026/01/sin-cierre.jpg");
  // B: la portada está DENTRO del enlace y era relativa → absolutizada
  assert.equal(por["Novela con Espacio"], "https://devilnovels.com/wp-content/uploads/2026/02/espacio.jpg");
  // F: src era un data: de 1 px y data-src relativa → absolutizada
  assert.equal(por["Novela Lazy"], "https://devilnovels.com/wp-content/uploads/2026/03/lazy.jpg");
  for (const i of ranking.items) {
    if (!i.poster) continue;
    assert.ok(/^https:\/\/devilnovels\.com\/wp-content\//.test(String(i.poster)), "portada rara: " + i.poster);
    assert.ok(!/dflazy|data:/i.test(String(i.poster)), "sustituto como portada: " + i.poster);
  }
});
