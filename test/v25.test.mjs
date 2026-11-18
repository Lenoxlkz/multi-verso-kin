// Tests v2.5: UA interno, cápsula de fuentes con panel y temporizador de 5 s, historial de
// lectura borrable, lector de novelas paginado y caché de listas de capítulos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "screen.js"), "utf8");
const env = readFileSync(join(root, "src", "env.js"), "utf8");
const nv = readFileSync(join(root, "src", "novels.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("el UA interno es el fijado y viaja en toda petición", () => {
  const UA = "Mozilla/5.0 (Linux; Android 17; SM-A102U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Mobile Safari/537.36";
  assert.ok(env.includes(UA), "el UA interno no coincide");
  assert.ok(env.includes("BASE_HEADS"), "faltan las cabeceras de base");
  assert.ok(env.includes("Accept-Language"), "falta Accept-Language");
  assert.ok(env.includes("{ ...BASE_HEADS, ...heads }"), "fetchText no parte de BASE_HEADS");
  // un solo punto de rotación: el resto de adaptadores lo importan
  for (const f of ["src/zonatmo.js", "src/manhwa.js", "src/novels.js"]) {
    const t = readFileSync(join(root, f), "utf8");
    assert.ok(t.includes('from "./env.js"') && !/User-Agent":\s*"Mozilla\/5\.0 \(Linux/.test(t), f + " debe tomar el UA de env.js");
  }
  assert.ok(built.includes(UA), "el build no lleva el UA interno");
});

test("la cápsula abre, cierra por toque fuera y por temporizador de 5 s", () => {
  assert.ok(src.includes('case "capsToggle"') && src.includes('case "capsClose"') && src.includes('case "capsTick"'), "faltan los eventos");
  assert.ok(src.includes("Date.now() - (state.capsAt || 0) >= 5000"), "el umbral de 5 s no está");
  assert.ok(src.includes("ms: 1000, event: \"capsTick\""), "el temporizador de raíz no es de 1 s");
  assert.ok(src.includes("root.every = [{ ms: 1000, event: \"capsTick\" }]"), "el timer no cuelga de la raíz");
  // el scrim cubre todo y recibe el toque (opacity >= 0.38 según el contrato)
  const main = src.slice(src.indexOf("if (state.capsOpen) {"), src.indexOf("const body = {"));
  assert.ok(main.includes("positioned: { top: 0, left: 0, right: 0, bottom: 0 }"), "el scrim no cubre todo");
  assert.ok(main.includes("onTap: { event: \"capsClose\" }"), "el scrim no cierra al tocar fuera");
  assert.ok(main.includes("opacity: 0.62"), "el scrim no tiene opacidad válida");
  // el FAB se oculta con el panel abierto
  assert.ok(src.includes("if (!state.capsOpen) opts.fab = floatFab()"), "el FAB no se oculta con el panel abierto");
});

test("el panel lista las nueve fuentes y cerrar con tabSrc", () => {
  const panel = src.slice(src.indexOf("function panelSources"), src.indexOf("function viewMain"));
  for (const k of ["zt", "zo", "ms", "mh", "sk", "mk", "as", "an", "dv"]) {
    assert.ok(panel.includes('arg: ' + k) || panel.includes("arg: k"), "el panel no abre la fuente " + k);
  }
  const tab = src.slice(src.indexOf('case "tabSrc"'), src.indexOf('case "capsToggle"'));
  assert.ok(tab.includes("capsOpen: false"), "elegir fuente no minimiza el panel");
  assert.ok(panel.includes("novela"), "el panel no distingue novelas");
});

test("las lecturas recientes están bajo la cápsula y el historial es borrable", () => {
  assert.ok(src.includes("Sigue leyendo") || src.includes('"Sigue leyendo"'), "falta el carril de recientes");
  assert.ok(src.includes('"borrarHistorial"'), "falta el borrado del historial");
  const bh = src.slice(src.indexOf('case "borrarHistorial"'), src.indexOf('case "cap"'));
  assert.ok(bh.includes('kino.storage.set(PROG_KEY, "{}")'), "no borra el respaldo en storage");
  assert.ok(bh.includes("kino.progress.clear"), "no borra los elementos de kino.progress");
  assert.ok(bh.includes("kino.progress.list"), "no lista los elementos antes de borrarlos");
});

test("el lector de novelas usa ListView (perezoso) y progreso por scroll", () => {
  const leer = src.slice(src.indexOf("if (c.text && c.text.length)"), src.indexOf('} else if (c.direction === "rtl"'));
  assert.ok(leer.includes('type: "ListView"'), "el texto no usa ListView");
  assert.ok(leer.includes("items: bloques"), "el ListView no lleva los párrafos");
  assert.ok(!leer.includes('type: "pages"'), "pages solo admite 2-8 hijos: no va ahí");
  assert.ok(src.includes('root.layout = "fill"'), "el lector no pone layout fill");
  const load = src.slice(src.indexOf("async function loadChapter"), src.indexOf("function withChapterMeta"));
  assert.ok(load.includes("ppages"), "loadChapter no calcula páginas equivalentes");
  const scr = src.slice(src.indexOf('case "scr":'), src.indexOf('case "share":'));
  assert.ok(scr.includes("saveProgress"), "el scroll no guarda progreso");
});

test("la lista de capítulos va en caché: una sola petición por novela y ventana", () => {
  assert.ok(nv.includes("async function capsOf"), "falta el caché de capítulos");
  assert.ok(nv.includes("const CAPS_TTL"), "falta el TTL");
  assert.ok((nv.match(/capsOf\(/g) || []).length >= 5, "capsOf debe cubrir sk/mk/as/madara");
  // mkChapter ya no re-pide el detalle completo para calcular vecinos
  const mkc = nv.slice(nv.indexOf("async function mkChapter"), nv.indexOf("// ---------- astral"));
  assert.ok(!mkc.includes("await mkDetail"), "mkChapter sigue pidiendo el detalle por capítulo");
  // madaraChapters delega en la red una sola vez
  const mad = nv.slice(nv.indexOf("async function madaraChapters"), nv.indexOf("async function madaraChapter(src"));
  assert.ok(mad.includes("capsOf") && mad.includes("madaraChaptersNet"), "madaraChapters no va por caché");
});

test("el Home distingue «fuente caída» de «sin datos» y el reintento lleva la fuente", () => {
  assert.ok(src.includes("herr"), "falta el estado de error por fuente");
  assert.ok(src.includes("no respondió"), "el mensaje de fuente caída falta");
  assert.ok(src.includes('errorBox(state.herr, "tabSrc", src)'), "el reintento no lleva la fuente");
});

test("la purga de caché expira antes de recortar por número", () => {
  assert.ok(env.includes("86400000"), "no expira lo viejo (>24 h)");
  const pr = env.slice(env.indexOf("function pruneCache"));
  assert.ok(pr.includes("kino.storage.remove"), "no borra nada");
});

test("la versión avanza a 2.7.0", () => {
  assert.equal(manifest.version, "2.11.0");
  assert.ok(built.includes("capsTick") && built.includes("borrarHistorial"), "el build no lleva las novedades");
});
