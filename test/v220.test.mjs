// Tests v2.20: Diseño Noir Atelier nativo en Kino (AppThemes, hero PageView, Theme Atelier sheet,
// Museum detail cards, lectores Studio para novela y manga con readerCfg BottomSheet, cero drops SDK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino } from "../sdk/kino-shim.mjs";
import { checkScreenTree, checkScreenAnswer, WIDGETS } from "../sdk/screen.mjs";
import { validateManifest } from "../sdk/contract.mjs";
import { contrast, resolvePalette } from "../sdk/palette.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestText = readFileSync(join(root, "kino-plugin.json"), "utf8");
const checkedManifest = validateManifest(manifestText);
const manifest = checkedManifest.manifest;
const built = readFileSync(join(root, "plugin.js"), "utf8");
const srcScreen = readFileSync(join(root, "src", "screen.js"), "utf8");

test("v2.20: kino-plugin.json declara paleta Noir Atelier con contraste válido y 8 appThemes", () => {
  assert.equal(checkedManifest.ok, true, checkedManifest.message || "manifest inválido");
  assert.equal(manifest.color, "#E2B96F");
  assert.ok(manifest.theme && manifest.theme.accent === "#E2B96F");
  const p = resolvePalette(manifest.theme);
  assert.deepEqual(p.warnings, []);
  assert.ok(contrast(p.onAccent, p.accent) >= 4.5);
  assert.ok(contrast(p.accent, p.background) >= 3);
  assert.ok(contrast(p.highlight, p.background) >= 4.5);
  assert.equal(manifest.appThemes.length, 8);
  assert.equal(manifest.appThemes[0].id, "atelier-obsidiana");
  assert.ok(manifest.appThemes.some((t) => t.id === "amoled-black"));
});

test("v2.20: src/screen.js y plugin.js están libres de setTimeout y cargan la nueva UI de Kino", () => {
  assert.equal(/\bsetTimeout\s*\(/.test(built), false, "plugin.js no debe usar setTimeout en QuickJS");
  assert.ok(srcScreen.includes("themeAtelierSheet"), "falta el sheet del Atelier de Temas");
  assert.ok(srcScreen.includes("readerConfigSheet"), "falta el sheet del lector Studio");
  assert.ok(srcScreen.includes("parseNovelParagraph"), "falta el limpiador de párrafos de novela");
  assert.ok(built.includes("atelier-obsidiana") && built.includes("readerCfg") && built.includes("themeSheet"));
});

test("v2.20: viewMain, viewFuente, viewBiblioteca, viewBuscar, viewDetalle, viewLeer y viewAjustes pasan checkScreenTree sin drops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-v220-"));
  try {
    const { kino } = createKino(manifest, { storageFile: join(dir, "storage.json") });
    globalThis.kino = kino;

  const { screen, screenEvent } = await import("../src/screen.js");

  const contexts = [
    ["main-loading", { route: { name: "main" }, state: { hsrc: "zt" }, lang: "es", device: "phone", size: { widthClass: "compact" }, activeTheme: "atelier-obsidiana" }],
    ["main-loaded", {
      route: { name: "main" },
      state: {
        hsrc: "zt",
        done: true,
        hrows: [
          {
            id: "zt-new",
            title: "Actualizados",
            items: [
              { s: "zt|m|a", t: "Solo Leveling", p: "https://example.com/1.jpg" },
              { s: "zt|m|b", t: "Omniscient Reader", p: "https://example.com/2.jpg" },
              { s: "zt|m|c", t: "Tower of God", p: "https://example.com/3.jpg" },
            ],
          },
        ],
        rows: [
          { id: "seguir-screen", title: "Seguir leyendo", items: [{ r: "zt|c|a|1", m: "zt|m|a", t: "Solo Leveling", p: "https://example.com/1.jpg", b: "Cap. 12" }] },
        ],
      },
      lang: "es",
      device: "phone",
      size: { widthClass: "compact" },
      activeTheme: "atelier-obsidiana",
    }],
    ["main-capsOpen-tv-en", {
      route: { name: "main" },
      state: {
        hsrc: "zo",
        done: true,
        capsOpen: true,
        hrows: [{ id: "zo-new", title: "Updated", items: [{ s: "zo|m|a", t: "Title A", p: "https://example.com/a.jpg" }, { s: "zo|m|b", t: "Title B", p: "https://example.com/b.jpg" }] }],
      },
      lang: "en",
      device: "tv",
      size: { widthClass: "expanded" },
      activeTheme: "atelier-obsidiana",
    }],
    ["main-cf", { route: { name: "main" }, state: { hsrc: "zo", done: true, hrows: [], cf: true, cfKind: "challenge", herr: "CF" }, lang: "es", device: "phone", size: { widthClass: "compact" } }],
    ["fuente", { route: { name: "fuente", args: { s: "zo" } }, state: { fuente: { src: "zo", shelves: [{ id: "zo-new", title: "Actualizados", items: [{ s: "zo|m|x", t: "Obra", p: "https://example.com/x.jpg" }] }] } }, lang: "es", device: "phone" }],
    ["biblioteca", { route: { name: "biblioteca" }, state: { favs: { "zt|m|a": { s: "zt", t: "A", p: "https://example.com/1.jpg" } }, biblio: { "zt|m|b": { tag: "leyendo", s: "zt", t: "B", p: "https://example.com/2.jpg" } } }, lang: "es", device: "phone" }],
    ["buscar-busy", { route: { name: "buscar" }, state: { q: "solo", busy: true }, lang: "es", device: "phone" }],
    ["buscar-results", { route: { name: "buscar" }, state: { q: "solo", results: [{ src: "zt", items: [{ s: "zt|m|a", t: "Solo", p: "https://example.com/1.jpg" }] }] }, lang: "es", device: "phone" }],
    ["detalle-busy", { route: { name: "detalle" }, state: { busyDetail: true }, lang: "es", device: "phone" }],
    ["detalle-loaded", {
      route: { name: "detalle" },
      state: {
        bibOpen: true,
        detailRef: "dv|m|x",
        detail: {
          src: "dv",
          slug: "x",
          title: "Obra Maestra",
          overview: "Sinopsis editorial ".repeat(20),
          poster: "https://example.com/p.jpg",
          genres: ["Acción", "Fantasía"],
          status: "En emisión",
          demography: "Seinen",
          score: "9.4",
          total: 120,
          next: 2,
          chapters: Array.from({ length: 100 }, (_, i) => ({ r: "dv|c|x|" + (i + 1), n: String(i + 1), t: "Título " + (i + 1), pago: i === 2 })),
        },
        prog: { cr: "dv|c|x|3", n: "3" },
      },
      lang: "es",
      device: "phone",
    }],
    ["leer-busy", { route: { name: "leer" }, state: { busyChapter: true }, lang: "es", device: "phone" }],
    ["leer-novel", {
      route: { name: "leer" },
      state: {
        chapter: {
          ref: "dv|c|x|1",
          src: "dv",
          mangaSlug: "x",
          mr: "dv|m|x",
          mTitle: "Novela",
          number: "1",
          title: "El comienzo",
          text: ["**Capítulo Uno**", "Primer párrafo con **negrita** y \\*asterisco\\*.", "***", "Segundo párrafo."],
          imgs: ["https://example.com/ill.jpg"],
          prev: "dv|c|x|0",
          next: "dv|c|x|2",
          total: 4,
          ppages: 4,
        },
      },
      lang: "es",
      device: "phone",
    }],
    ["leer-manga-strip", {
      route: { name: "leer" },
      state: {
        rprefs: { mangaMode: "strip", mangaDir: "ltr", mangaFrame: "framed" },
        chapter: {
          ref: "ms|c|x|1",
          src: "ms",
          mangaSlug: "x",
          mr: "ms|m|x",
          mTitle: "Webtoon",
          number: "1",
          direction: "ltr",
          pages: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
          resumePage: 2,
          total: 2,
        },
      },
      lang: "es",
      device: "phone",
    }],
    ["ajustes", { route: { name: "ajustes" }, state: {}, lang: "es", device: "phone", activeTheme: "atelier-obsidiana" }],
  ];

  for (const [name, ctx] of contexts) {
    const raw = await screen(ctx);
    const checked = checkScreenTree(raw, ctx.lang || "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 });
    assert.ok(checked.tree, `${name} devolvió árbol nulo`);
    assert.deepEqual(checked.dropped, [], `${name} tuvo logs/drops inesperados: ${checked.dropped.join("; ")}`);
  }

  // Verificar PageView hero en main-loaded y readerCfg BottomSheet + limpieza de markdown en leer-novel
  const mainTree = await screen(contexts[1][1]);
  const mainJson = JSON.stringify(mainTree);
  assert.ok(mainJson.includes('"type":"PageView"'), "main debe incluir carrusel PageView con heroCards");
  assert.ok(mainJson.includes('"type":"heroCard"'), "main debe incluir tarjetas heroCard");
  assert.ok(mainJson.includes('"key":"themeSheet"'), "main debe incluir el BottomSheet themeSheet");

  const novelTree = await screen(contexts[11][1]);
  const novelJson = JSON.stringify(novelTree);
  assert.ok(novelJson.includes('"key":"readerCfg"'), "leer debe incluir BottomSheet readerCfg");
  assert.ok(novelJson.includes("·   ·   ·"), "el divisor *** de novela debe formatearse como ·   ·   ·");
  assert.ok(novelJson.includes("Primer párrafo con negrita y *asterisco*."), "el texto de novela debe limpiar marcas ** y \\\\*");

  // Verificar evento rpref persistiendo preferencias del lector Studio
  const ev = await screenEvent({ name: "rpref", arg: "novelSize:h4", state: {}, lang: "es", device: "phone" });
  const ans = checkScreenAnswer(ev, "es", WIDGETS, { apiVersion: 22 });
  assert.deepEqual(ans.dropped, []);
  assert.equal(ev.state.rprefs.novelSize, "h4");

  const ev2 = await screenEvent({ name: "rpref", arg: "mangaMode:strip", state: ev.state, lang: "es", device: "phone" });
  assert.equal(ev2.state.rprefs.mangaMode, "strip");
  assert.equal(JSON.parse(kino.storage.get("rprefs")).novelSize, "h4");
  assert.equal(JSON.parse(kino.storage.get("rprefs")).mangaMode, "strip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
