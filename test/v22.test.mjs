// Tests v2.2: eliminación de descargas, candados de pago, Ver más/menos, tema AMOLED y barra sin Descargas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGO_TEXT_RE, PAGO_CLASS_RE } from "../src/env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("la descarga de capítulos se eliminó por completo", () => {
  assert.equal(existsSync(join(root, "src", "downloads.js")), false, "src/downloads.js debe no existir");
  const built = readFileSync(join(root, "plugin.js"), "utf8");
  for (const muerto of ["dlCap", "dlLote", "dlAbrir", "tickDescarga", "processTick", "dlBadgeOf", "viewDescargas"]) {
    assert.ok(!built.includes(muerto), "plugin.js aún menciona: " + muerto);
  }
  const src = readFileSync(join(root, "src", "screen.js"), "utf8");
  assert.ok(!src.includes("./downloads.js"), "screen.js aún importa downloads.js");
});

test("el manifiesto no tiene tics y trae el ajuste de pago", () => {
  const m = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
  assert.equal(m.version, "2.2.0");
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

test("el lector queda sin barra y con botón de salir", () => {
  const src = readFileSync(join(root, "src", "screen.js"), "utf8");
  const leer = src.slice(src.indexOf("function viewLeer"), src.indexOf("---------- vista: sin conexión"));
  assert.ok(!leer.includes("bottomBar: true"), "el lector no debe llevar la barra");
  assert.ok(leer.includes("Salir del capítulo"), "falta el botón de salir");
  assert.ok(!leer.includes('offline === "dl"'), "la rama de capítulos descargados debe estar fuera");
  assert.ok(leer.includes("Anterior") && leer.includes("Siguiente"), "faltan anterior/siguiente");
});

test("descripción con Ver más / Ver menos", () => {
  const src = readFileSync(join(root, "src", "screen.js"), "utf8");
  assert.ok(src.includes("descToggle") && src.includes("Ver más") && src.includes("Ver menos"));
});

test("barra con dos secciones y ruta offline para archivos locales", () => {
  const src = readFileSync(join(root, "src", "screen.js"), "utf8");
  assert.ok(src.includes('key: "home"') && src.includes('key: "ajustes"'));
  assert.ok(!src.includes('key: "descargas"'), "la barra no debe tener Descargas");
  assert.ok(src.includes('case "offline"') && src.includes("Leer archivos locales"));
  assert.ok(src.includes("purgeDl"), "falta la purga de restos de descargas");
});
