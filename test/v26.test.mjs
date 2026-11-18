// Tests v2.6: cabeceras de imagen (UA interno + Referer), jarra de cookies Cloudflare,
// detección de desafíos y ventana visual Kino-native para resolverlos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "screen.js"), "utf8");
const env = readFileSync(join(root, "src", "env.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("imgHeads: UA interno + Referer del propio host; nada para URLs raras", () => {
  assert.ok(env.includes("export function imgHeads"), "falta imgHeads");
  assert.ok(env.includes('h["Referer"] = m[1] + "/"'), "el Referer no es el origen");
  assert.ok(env.includes('"User-Agent": UA'), "el UA de imagen no es el interno");
});

test("las cabeceras van en todos los nodos de imagen", () => {
  // rails: seguir (mixto, solo UA) y estantes (mono-fuente, UA+Referer)
  assert.ok(src.includes("headers: imgHeads(seguir.items.find"), "el rail de recientes no lleva headers");
  assert.ok(src.includes("headers: imgHeads(primerP && primerP.p)"), "los rails de estantes no llevan headers");
  // Image sueltas: cover del detalle, ilustraciones, páginas del lector (2 sitios)
  assert.ok(src.includes("url: d.poster, headers: imgHeads(d.poster)"), "la cover del detalle no lleva headers");
  assert.ok(src.includes('url: u, headers: imgHeads(u), aspect: "2:3"'), "las ilustraciones no llevan headers");
  const conPag = (src.match(/headers: imgHeads\(u\)/g) || []).length;
  assert.ok(conPag >= 3, "los nodos de imagen con headers: " + conPag);
  assert.ok(built.includes("Referer"), "el build no lleva Referer");
});

test("la jarra de cookies CF entra en fetchText y se guarda por host", () => {
  assert.ok(env.includes("function cfSaveCookies"), "falta el guardado");
  assert.ok(env.includes("function cfCookieHead"), "falta la lectura");
  const ft = env.slice(env.indexOf("export async function fetchText"));
  assert.ok(ft.includes("cfCookieHead(url)"), "fetchText no consulta la jarra");
  assert.ok(ft.includes('hs.Cookie = cf'), "fetchText no añade la Cookie");
  assert.ok(env.includes('const CFJAR_KEY = "cfjar"'), "falta la clave de la jarra");
});

test("isCfChallenge reconoce los desafíos (403/429/503 con sus marcas)", () => {
  assert.ok(env.includes("challenge-platform") && env.includes("just a moment"), "faltan las marcas");
  const m = env.match(/status !== 403 && status !== 429 && status !== 503/);
  assert.ok(m, "los códigos del desafío no son los correctos");
});

test("cfAbrir abre la ventana visual con el UA interno y recarga la fuente", () => {
  const cf = src.slice(src.indexOf('case "cfAbrir"'), src.indexOf('case "capsToggle"'));
  assert.ok(cf.includes("kino.visualBrowser.open"), "no abre la ventana visual");
  assert.ok(cf.includes("userAgent: UA"), "la ventana no usa el UA interno (la cookie queda ligada a él)");
  assert.ok(cf.includes('cookies: ["cf_clearance"]'), "no espera cf_clearance");
  assert.ok(cf.includes("cfSaveCookies"), "no guarda la jarra");
  assert.ok(cf.includes("argL.split(\"|\")[0]"), "no extrae la fuente de un ref compuesto");
  assert.ok(cf.includes("ctx.device === \"tv\""), "no protege la TV");
  assert.ok(cf.includes("available === true"), "no comprueba la disponibilidad");
});

test("el Home muestra el panel de desafío y el detalle lo ofrece tras un error CF", () => {
  assert.ok(src.includes('"Desafío de Cloudflare"'), "falta el título del panel");
  assert.ok(src.includes('onPressed: { event: "cfAbrir", arg: src }'), "el botón del Home no lleva la fuente");
  assert.ok(src.includes("function detailErrorBox"), "el detalle no tiene su caja de error CF");
  assert.ok(src.includes('onPressed: { event: "cfAbrir", arg: ref }'), "el botón del detalle no lleva el ref");
  const sonda = src.slice(src.indexOf("async function probeCf"), src.indexOf("/** Sonda") + 1e9 || src.length);
  const probe = src.slice(src.indexOf("async function probeCf"));
  assert.ok(probe.includes("isCfChallenge(ctrl.status, ctrl.text)"), "la sonda no usa isCfChallenge");
  // corre en AMBOS caminos de fallo: sin filas y el catch (los adaptadores lanzan con 403)
  assert.ok(src.includes("return probeCf(src, en, shelves);") && src.includes("return probeCf(src, en, [],"), "la sonda no cubre el catch");
});

test("el manifiesto habilita el navegador visual con apiVersion 20", () => {
  assert.equal(manifest.apiVersion, 20);
  assert.equal(manifest.visualBrowser, true);
  for (const h of ["skynovels.net", "matchanovels.com", "anslid.com", "devilnovels.com"]) {
    assert.ok(manifest.hosts.some((x) => x.includes(h)), "falta el host " + h);
  }
  assert.ok(built.includes("visualBrowser"), "el build no lleva el navegador visual");
});
