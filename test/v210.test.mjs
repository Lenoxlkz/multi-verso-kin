// Tests v2.10: lector y progreso — claves por apertura (fin del «empieza a la mitad»),
// retomar en la página guardada, regla del punto más leído, done al terminar, throttle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "screen.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("claves del lector POR APERTURA: cambiar de capítulo arranca en la página 1", () => {
  // el bug: claves constantes («tira», «novela», «manga-pages») reutilizaban el scrollable
  // con el offset del capítulo anterior — el mismo bug que ZonaTM0 v1.2.1 documentó
  assert.ok(src.includes('key: "novela-" + (c.tk || 0)'), "el lector de novela reutiliza clave");
  assert.ok(src.includes('key: "manga-pages-" + (c.tk || 0)'), "el paginador reutiliza clave");
  assert.ok(src.includes('key: "tira-" + (c.tk || 0)'), "la tira reutiliza clave");
  assert.ok(src.includes("pg\" + (c.tk || 0) + \"-\" + i"), "las páginas internas reutilizan clave");
  assert.ok(src.includes("let navSeq = 0") && src.includes("chapter.tk = ++navSeq"), "falta el token por apertura");
  // nav NO retoma: el capítulo nuevo siempre desde el inicio
  const nav = src.slice(src.indexOf('case "nav"'), src.indexOf('case "pag"'));
  assert.ok(nav.includes("chapter.tk = ++navSeq") && !nav.includes("resumePage"), "nav restaura posición del capítulo anterior");
});

test("retomar: la página guardada vuelve al lector (initialPage en páginas; nota en tira)", () => {
  const cap = src.slice(src.indexOf('case "cap"'), src.indexOf('case "nav"'));
  assert.ok(cap.includes("chapter.resumePage = Math.min(prev.page"), "no lee la página guardada");
  assert.ok(cap.includes("prev.cr === ref"), "restaura de cualquier capítulo, no solo el guardado");
  const paginas = src.slice(src.indexOf("type: \"pages\""), src.indexOf("type: \"SingleChildScrollView\", key: \"tira-\""));
  assert.ok(paginas.includes("initialPage: c.resumePage > 1"), "el paginador no arranca en la página guardada");
  assert.ok(src.includes("Estabas por la página"), "la tira no avisa dónde se quedó");
  assert.ok(src.includes("{ cr: r.cr, n: r.n || \"\", page: r.page || 1 }"), "readProgress pierde la página");
});

test("regla del punto más leído: reabrir o el primer onScroll a 0 no borran lo leído", () => {
  const sp = src.slice(src.indexOf("function saveProgress"), src.indexOf("async function readProgress"));
  assert.ok(sp.includes("prev.cr === cr"), "no compara contra el guardado");
  assert.ok(sp.includes("if (p0 > page || (p0 === page && f0 > frac)) return;"), "no protege el punto más leído");
  assert.ok(sp.includes("frac,"), "la fracción no se guarda en storage");
  assert.ok(sp.includes("done: frac >= 0.995 || undefined"), "no marca capítulo terminado");
});

test("el guardado por scroll escribe con criterio (cambio de página, 2% o 4 s)", () => {
  const scr = src.slice(src.indexOf('case "scr"'), src.indexOf('case "share"'));
  assert.ok(scr.includes("page !== s0.page || Math.abs(frac - s0.frac) > 0.02 || now - s0.at > 4000"), "el throttle no existe");
  assert.ok(scr.includes("let scrSave") || src.includes("let scrSave"), "falta el estado del throttle");
});

test("modo páginas hasta 250 páginas solo si Kino declara el widget", () => {
  assert.ok(src.includes("pagesDisponible() ? 250 : 8"), "el rango de páginas no se amplía");
  assert.ok(src.includes("kino.screen.widgets.indexOf(\"pages\") >= 0"), "no consulta los widgets de Kino");
});

test("la versión avanza a 2.10.0 y el build lleva las claves nuevas", () => {
  assert.equal(manifest.version, "2.15.0");
  assert.ok(built.includes('key: "tira-" + (c.tk || 0)') && built.includes("initialPage: c.resumePage > 1"), "el build no lleva el arreglo");
});
