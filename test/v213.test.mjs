// v213 — RCA 2026-11 del home de DevilNovels: (1) portadas repetidas/lentas, (2) títulos
// incorrectos y duplicados, (3) las primeras tarjetas eran el MENÚ del sitio («Iniciar sesión»,
// «Registrarse», /mi-login, /mi-registro, /mi-recuperar, /acortador…). Verificado con el
// índice real del sitio: el menú es Inicio · Lista de Novelas · Iniciar sesión · Registrarse,
// el tema usa lazy-loader (dflazy: sustituto en src, portada en data-src) y las páginas de
// finalizadas firman «Título - Finalizada». La causa técnica: la extracción miraba 2600
// caracteres HACIA ATRÁS y cogía título/portada de la tarjeta anterior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const F = (p) => readFileSync(root + "test/fixtures/" + p, "utf8");
const src = readFileSync(root + "src/devilnovels.js", "utf8");
const env = readFileSync(root + "src/env.js", "utf8");
const manifest = JSON.parse(readFileSync(root + "kino-plugin.json", "utf8"));

test("v2.13.0: manifest y controles estáticos del RCA", () => {
  assert.equal(manifest.version, "2.13.0");
  // la extracción ya no mira hacia atrás (contaminación entre tarjetas)
  assert.ok(!src.includes("2600"), "novelCards sigue con la ventana de 2600 hacia atrás");
  // data-src tiene prioridad sobre src (el sustituto del lazy-loader vive en src)
  assert.ok(/\["data-src", "data-lazy-src", "data-original", "src"\]/.test(src), "no hay orden de preferencia de atributos");
  // las URLs relativas de portada se absolutizan
  assert.ok(src.includes('"https://devilnovels.com" + u'), "urlDeImg no absolutiza rutas relativas");
  // el home lleva el seguro anti-portadas-repetidas
  assert.ok(src.includes("max * 2 > conImg.length"), "falta el seguro anti-portadas repetidas");
  // las imágenes de devilnovels llevan Referer propio (hotlink-check → «tarda demasiado»)
  assert.ok(/const IMG_REFERER = \{[^}]*"devilnovels\.com": true/.test(env), "IMG_REFERER sin devilnovels.com");
});

// ---------- el adaptador contra la estructura real (fixtures) ----------

const store = new Map();
globalThis.kino = {
  fetch: async (url) => {
    const map = [
      ["devilnovels.com/novelas-finalizadas", "dv/finalizadas.html"],
      ["devilnovels.com/listado-de-novelas", "dv/busqueda.html"],
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

const { novelHome } = await import("../src/novels.js");

const AUTH = /iniciar sesi|registrarse|mi login|mi registro|mi cuenta|recuperar|acortador|join us|membres/i;

test("dv home: el menú del sitio (login/registro/cuenta/herramientas) NO sale como tarjetas", async () => {
  const h = await novelHome("dv");
  const todas = h.flatMap((sh) => sh.items);
  assert.ok(todas.length >= 4, "tarjetas: " + todas.length);
  const sucias = todas.filter((i) => AUTH.test(String(i.title)));
  assert.equal(sucias.length, 0, "el menú se coló como tarjetas: " + sucias.map((i) => i.title).join(" | "));
  // y las primeras tarjetas son novelas de verdad, no acciones de cuenta (RCA problema 3)
  assert.equal(todas[0].title, "Esclavo de las Sombras");
});

test("dv home: cada tarjeta lleva SU título y SU portada, sin duplicados ni sustitutos", async () => {
  const h = await novelHome("dv");
  // dv-finalizadas va aparte: sus portadas repetidas se quitan A PROPÓSITO (test siguiente)
  for (const sh of h.filter((s) => s.id !== "dv-finalizadas")) {
    // títulos únicos DENTRO de cada sección (ranking y listado comparten fixture a propósito)
    const titulos = sh.items.map((i) => i.title);
    assert.equal(new Set(titulos).size, titulos.length, "títulos repetidos en " + sh.id + ": " + titulos.join(" | "));
    // portadas: absolutas, sin data: ni sustituto del lazy-loader, y cada una distinta (RCA 1)
    for (const i of sh.items) {
      assert.ok(i.poster, "tarjeta sin portada: " + i.title);
      assert.ok(/^https:\/\/devilnovels\.com\/wp-content\//.test(String(i.poster)), "portada no absoluta o fuera del host: " + i.poster);
      assert.ok(!/dflazy|data:/i.test(String(i.poster)), "portada es un sustituto: " + i.poster);
    }
    const posters = sh.items.map((i) => String(i.poster));
    assert.equal(new Set(posters).size, posters.length, "portadas repetidas en " + sh.id + ": " + posters.join(" | "));
  }
  // la portada de «Contra los Dioses» venía de data-src RELATIVA → absolutizada
  const todas = h.flatMap((sh) => sh.items);
  const contra = todas.find((i) => i.title === "Contra los Dioses");
  assert.equal(contra.poster, "https://devilnovels.com/wp-content/uploads/2024/02/contra-los-dioses.jpg");
  // el título desde el atributo title del enlace (la tarjeta solo lleva una insignia dentro)
  assert.ok(todas.some((i) => i.title === "Tales of Demons and Gods"), "el título del atributo no se leyó");
});

test("dv home: el seguro quita las portadas repetidas de la sección (aunque queden títulos)", async () => {
  const h = await novelHome("dv");
  const fin = h.find((sh) => sh.id === "dv-finalizadas");
  assert.ok(fin && fin.items.length >= 4, "sección finalizadas: " + (fin && fin.items.length));
  for (const i of fin.items) assert.equal(i.poster, undefined, "la sección siguió enseñando portadas compartidas: " + i.title);
  // y los títulos firmados «- Finalizada» quedan limpios (título propio del sitio)
  assert.ok(fin.items.some((i) => i.title === "Solo Levear Ragnarok"), "no se limpió « - Finalizada»");
  assert.ok(fin.items.some((i) => i.title === "Warlock of the Magus World"));
});

test("dv home: un título de novela largo que empieza como acción de cuenta NO se pierde", async () => {
  // «Registrados en el sistema del caos» (6 palabras) empieza como «Registr…» pero es una
  // novela: el filtro de texto solo tumba frases cortas de cuenta (≤ 4 palabras)
  const h = await novelHome("dv");
  const reg = h.flatMap((sh) => sh.items).find((i) => i.title === "Registrados en el sistema del caos");
  assert.ok(reg, "el filtro de texto se comió una novela de verdad");
  assert.equal(reg.poster, "https://devilnovels.com/wp-content/uploads/2024/05/registrados.jpg");
});
