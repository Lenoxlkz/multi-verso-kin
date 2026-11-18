// Tests v2.4: Biblioteca en la barra, Me Gusta y Agregar a Biblioteca, Home por fuentes,
// lector de novelas de texto y las seis fuentes nuevas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES, NOVEL_SOURCES, HOME_TABS, parseRef } from "../src/env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "screen.js"), "utf8");
const nv = readFileSync(join(root, "src", "novels.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("el manifiesto declara las nueve fuentes y sus hosts", () => {
  assert.equal(Object.keys(SOURCES).length, 9, "deben existir 9 fuentes (LegnNovels eliminada)");
  assert.equal(manifest.version, "2.12.0");
  for (const h of ["skynovels.net", "matchanovels.com", "anslid.com", "devilnovels.com", "public-api.wordpress.com", "astralnovelstranslations.wordpress.com"]) {
    assert.ok(manifest.hosts.includes(h) || manifest.hosts.includes("*." + h), "falta el host " + h);
  }
  assert.ok(manifest.categories.includes("novela"), "la categoría «novela» falta");
  assert.equal(NOVEL_SOURCES.length, 5);
  assert.ok(HOME_TABS.length === 9 && HOME_TABS[0] === "zt" && !HOME_TABS.includes("ln"));
});

test("la barra de navegación tiene Inicio, Biblioteca y Ajustes", () => {
  assert.ok(src.includes('key: "biblioteca", icon: "bookmark", label: "Biblioteca"'), "falta el ítem de Biblioteca");
  assert.ok(src.includes('case "biblioteca": return viewBiblioteca(ctx)'), "falta la ruta");
  const navBar = src.slice(src.indexOf("case \"navBar\""));
  assert.ok(navBar.includes('key === "biblioteca"'), "el evento navBar no atiende Biblioteca");
});

test("la Biblioteca separa Me Gustas y Etiquetados con las 4 etiquetas", () => {
  assert.ok(src.includes("Mis Me Gustas") && src.includes("Etiquetados"), "faltan los dos apartados");
  const bib = src.slice(src.indexOf("function viewBiblioteca"), src.indexOf("// ---------- vista: búsqueda"));
  for (const t of ["Leyendo", "Por leer", "Pendiente", "Terminado"]) {
    assert.ok(bib.includes('"' + t + '"') || src.includes('t: "' + t + '"'), "falta la etiqueta " + t);
  }
  assert.ok(src.includes('kino.storage.set("favs"') && src.includes('kino.storage.set("biblio"'), "faltan las claves de storage");
});

test("el detalle tiene Me Gusta y Agregar a Biblioteca con quitar", () => {
  assert.ok(src.includes('"Me Gusta"') && src.includes('"Agregar a Biblioteca"'), "faltan los botones");
  assert.ok(src.includes('arg: "quitar"'), "falta poder quitar la etiqueta");
  assert.ok(src.includes('case "fav":') && src.includes('case "biblio":') && src.includes('case "bibOpen":'), "faltan los eventos");
});

test("el Home se separa por fuente con la cápsula y su panel", () => {
  assert.ok(src.includes("capsToggle") && src.includes("capsClose") && src.includes("capsTick"), "falta el ciclo de la cápsula");
  assert.ok(src.includes("positioned:"), "el panel no es un overlay posicionado");
  assert.ok(src.includes("function tabSpecs"), "faltan las secciones nativas de manga");
  assert.ok(src.includes("async function loadHomeShelves"), "falta el cargador por fuente");
  const main = src.slice(src.indexOf("function panelSources"), src.indexOf("// ---------- biblioteca"));
  assert.ok(main.includes("HOME_TABS."), "el panel no usa HOME_TABS");
  assert.ok(src.includes("ms: 1000, event: \"capsTick\""), "falta el temporizador de raíz");
});

test("cada fuente muestra sus secciones nativas", () => {
  // ZonaTMO / ManhwaSS: sus categorías reales, sin mezcla
  for (const s of ["Actualizados", "Lo más visto", "Mejor valorados", "Últimas actualizaciones", "En emisión", "Completados"]) {
    assert.ok(src.includes(s), "falta la sección " + s);
  }
  // Madara (Anslid y gemelos): sus filtros m_orderby reales
  for (const ob of ["trending", "latest", "views", "rating", "new"]) {
    assert.ok(nv.includes('m_orderby=' + ob) || nv.includes('ob: "' + ob + '"'), "falta m_orderby " + ob);
  }
  // Skynovels: /v1/home con sus listas reales
  for (const k of ["trending", "weekly_views", "most_viewed", "rising", "top_rated", "finished", "featured"]) {
    assert.ok(nv.includes('"' + k + '"'), "falta la sección de Skynovels " + k);
  }
});

test("el lector de novelas renderiza párrafos de texto", () => {
  const leer = src.slice(src.indexOf("function viewLeer"), src.indexOf("// ---------- vista: ajustes"));
  assert.ok(leer.includes("c.text && c.text.length"), "falta el modo texto");
  assert.ok(leer.includes("novela") && !leer.includes("Salir del capítulo"), "el modo texto no debe traer el botón Salir");
  const load = src.slice(src.indexOf("async function loadChapter"), src.indexOf("function withChapterMeta"));
  assert.ok(load.includes("mode: \"texto\""), "loadChapter no marca el modo texto");
  assert.ok(load.includes("saveProgress"), "las novelas deben guardar progreso");
});

test("los seis adaptadores de novela están completos", () => {
  for (const fn of ["novelSearch", "novelHome", "novelDetail", "novelChapter"]) {
    assert.ok(nv.includes("export async function " + fn), "falta " + fn);
  }
  for (const ep of ["/v1/novels?q=", "/v1/chapters/", "/api/v1/public/novels", "rest/v1.1/sites/astralnovelstranslations", "/ajax/chapters/", "m_orderby=trending"]) {
    assert.ok(nv.includes(ep), "falta el endpoint " + ep);
  }
  // El despacho cubre las 6 fuentes
  for (const s of ["sk", "mk", "as", "an", "dv"]) {
    assert.ok(new RegExp('\\b' + s + '[:\\b]').test(nv), "falta la fuente " + s + " en el despacho");
  }
});

test("los refs de novela se leen con el mismo parseRef", () => {
  const r = parseRef("sk|m|61");
  assert.ok(r && r.src === "sk" && r.kind === "m" && r.a === "61");
  const c = parseRef("an|c|solo-leveling-ragnarok-novela|capitulo-3/");
  assert.ok(c && c.kind === "c" && c.a === "solo-leveling-ragnarok-novela");
});

test("el plugin compilado lleva las fuentes nuevas sin residuos", () => {
  assert.ok(built.includes("novelChapter") && built.includes("viewBiblioteca"), "el build no incluye las novedades");
  assert.ok(!built.includes("rowSpecs()"), "fetchRows viejo quedó");
  assert.ok(!built.includes("Buscar en las 4 fuentes"), "el FAB viejo quedó");
});

test("la búsqueda por filtro alcanza las novelas", () => {
  const runSearch = src.slice(src.indexOf("async function runSearch"), src.indexOf("async function handleOpen"));
  assert.ok(runSearch.includes("adapter(x).search(x, q)"), "runSearch no pasa por el adaptador");
});
