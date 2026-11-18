// Tests v2.3: sin archivos locales, filtros de búsqueda, abrir en navegador,
// regreso del lector al detalle, y todo lo de v2.2 sigue en pie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGO_TEXT_RE, PAGO_CLASS_RE } from "../src/env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "screen.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");

test("la descarga de capítulos se eliminó por completo (v2.2)", () => {
  assert.equal(existsSync(join(root, "src", "downloads.js")), false, "src/downloads.js debe no existir");
  for (const muerto of ["dlCap", "dlLote", "dlAbrir", "tickDescarga", "processTick", "dlBadgeOf", "viewDescargas"]) {
    assert.ok(!built.includes(muerto), "plugin.js aún menciona: " + muerto);
  }
  assert.ok(!src.includes("./downloads.js"), "screen.js aún importa downloads.js");
});

test("los archivos locales se eliminaron por completo (v2.3)", () => {
  for (const muerto of ["Leer archivos locales", "viewOffline", "offlineLibrary", "devicePage", "hasFiles", "pickImgs", "pickFolder", "abrirOff", "borrarOff", "pagOff", "kino.files", 'route: "offline"', 'case "offline"']) {
    assert.ok(!src.includes(muerto), "screen.js aún menciona: " + muerto);
    assert.ok(!built.includes(muerto), "plugin.js aún menciona: " + muerto);
  }
  const m = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
  assert.equal(JSON.stringify(m.enhancements || {}).includes("files"), false, "el manifiesto aún declara files");
  assert.ok(m.version >= "2.3.0", "la versión avanza desde 2.3");
});

test("el manifiesto no tiene tics y trae el ajuste de pago", () => {
  const m = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
  assert.equal(m.screen.every, undefined, "no debe haber temporizadores");
  const ocultar = (m.settings || []).find((s) => s.key === "ocultarPago");
  assert.ok(ocultar && ocultar.type === "toggle", "falta el ajuste ocultarPago");
  assert.ok((m.appThemes || []).some((t) => t.id === "amoled-black"), "falta el tema AMOLED");
});

test("detección de capítulos de pago", () => {
  assert.ok(PAGO_TEXT_RE.test("Capítulo 12 Premium"));
  assert.ok(PAGO_TEXT_RE.test("Cap 5 🔒"));
  assert.ok(PAGO_TEXT_RE.test("Chapter 3 - VIP"));
  assert.ok(PAGO_TEXT_RE.test("Exclusivo oro"));
  assert.equal(PAGO_TEXT_RE.test("Capítulo 12"), false, "falso positivo en título normal");
  assert.equal(PAGO_TEXT_RE.test("Sonoro Capítulo 1"), false, "«oro» no debe saltar dentro de otra palabra");
  assert.ok(PAGO_CLASS_RE.test("ch-row premium"));
  assert.ok(PAGO_CLASS_RE.test("ch-row lock-row"));
  assert.equal(PAGO_CLASS_RE.test("ch-row"), false);
});

test("el lector queda sin barra, sin botón Salir y con anterior/siguiente", () => {
  const a = src.indexOf("function viewLeer");
  const b = src.indexOf("// ---------- vista: ajustes");
  const leer = src.slice(a, b > a ? b : undefined);
  assert.ok(!leer.includes("bottomBar: true"), "el lector no debe llevar la barra");
  assert.ok(!leer.includes("Salir del capítulo"), "el botón Salir se retiró");
  assert.ok(leer.includes("Anterior") && leer.includes("Siguiente"), "faltan anterior/siguiente");
});

test("el enlace profundo abre el detalle, así regresar del lector nunca cae al Home", () => {
  const abrir = src.slice(src.indexOf("async function handleOpen"));
  assert.ok(abrir.includes('route: { push: "detalle", params: { r: args.m } }'), "Seguir leyendo debe abrir el detalle");
  assert.ok(!abrir.includes('push: "leer"'), "ningún flujo debe apilar el lector desde el Home");
});

test("filtros de búsqueda: todas o una fuente", () => {
  assert.ok(src.includes('onChanged: "busqSrc"'), "falta el chip del filtro");
  assert.ok(src.includes("async function runSearch"), "falta runSearch");
  const q = src.slice(src.indexOf('case "q":'), src.indexOf('case "caps":'));
  assert.ok(q.includes("runSearch(q, state.busqSrc"), "el evento q debe respetar el filtro");
  const chip = src.slice(src.indexOf('case "busqSrc"'), src.indexOf('case "q":'));
  assert.ok(chip.includes("runSearch(qq, f)"), "cambiar el filtro con texto repite la búsqueda");
});

test("el detalle abre el manga en el navegador", () => {
  assert.ok(src.includes("Abrir en el navegador"), "falta el botón");
  assert.ok(src.includes("go: { url: { href: siteUrl"), "falta la acción go.url");
  assert.ok(src.includes("function siteUrlOf"), "la URL del sitio no se construye por fuente");
});

test("descripción con Ver más / Ver menos (v2.2)", () => {
  assert.ok(src.includes("descToggle") && src.includes("Ver más") && src.includes("Ver menos"));
});

test("la purga borra restos de descargas y archivos", () => {
  assert.ok(src.includes('k === "offline"'), "falta purgar la clave offline");
  assert.ok(src.includes('k.indexOf("dl:") === 0'), "falta purgar dl:");
});
