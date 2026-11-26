// Tests v2.21: Catálogo paginado por categoría y género en TODAS las 9 fuentes,
// eliminación del botón inferior "Ver más de [fuente]", refs por fila en viewMain,
// navegación catSel/catMas en viewFuente y cero drops del SDK Kino en teléfono/TV/es/en.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino } from "../sdk/kino-shim.mjs";
import { checkScreenTree, checkScreenAnswer, WIDGETS } from "../sdk/screen.mjs";
import { validateManifest } from "../sdk/contract.mjs";
import { SOURCES } from "../src/env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8")).manifest;
const built = readFileSync(join(root, "plugin.js"), "utf8");

function jsonRes(obj, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { "content-type": "application/json" }, text: () => JSON.stringify(obj) };
}
function htmlRes(html, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { "content-type": "text/html" }, text: () => html };
}

function ztCardHtml(slug, title) {
  return `<div class="element" data-identifier="1"><a href="https://zonatmo.net/library/manga/1/${slug}"><div class="thumbnail" style="background-image:url('https://zonatmo.net/${slug}.jpg')"><span class="book-type">MANGA</span><h4 class="text-truncate" title="${title}">${title}</h4></div></a></div>`;
}
function zoHtml(prefix, count = 24) {
  let out = `<div class="lib-container">`;
  const slugBase = String(prefix).toLowerCase();
  for (let i = 1; i <= count; i++) {
    out += `<div class="book-item"><a href="/library/manga/${i}/${slugBase}-${i}/"><img src="https://zonatmo.org/${slugBase}-${i}.jpg" alt="portada"><h4 title="${prefix} Título ${i}">${prefix} Título ${i}</h4></a></div>`;
  }
  return out + `</div>`;
}
function msHtml(prefix, count = 15) {
  let out = `<div class="explorar-grid">`;
  const slugBase = String(prefix).toLowerCase();
  for (let i = 1; i <= count; i++) {
    out += `<div class="s-card"><a href="/manga/${slugBase}-${i}/"><img src="https://manhwass.lat/${slugBase}-${i}.jpg" alt="${prefix} ${i} portada" /></a><a class="s-card-title" href="/manga/${slugBase}-${i}/">${prefix} ${i}</a></div>`;
  }
  return out + `</div>`;
}
function anHtml(prefix, count = 16) {
  let out = `<div class="c-tabs-item">`;
  const slugBase = String(prefix).toLowerCase();
  for (let i = 1; i <= count; i++) {
    out += `<div class="page-item-detail"><div class="item-thumb"><a href="https://anslid.com/novela/${slugBase}-${i}/" title="${prefix} ${i}"><img data-src="https://anslid.com/${slugBase}-${i}.jpg" /></a></div><div class="item-summary"><div class="post-title"><h3><a href="https://anslid.com/novela/${slugBase}-${i}/">${prefix} ${i}</a></h3></div></div></div>`;
  }
  return out + `</div>`;
}
function dvHtml(prefix, count = 30) {
  let out = `<main>`;
  const slugBase = String(prefix).toLowerCase();
  for (let i = 1; i <= count; i++) {
    out += `<article><a href="https://devilnovels.com/${slugBase}-${i}/"><img src="https://devilnovels.com/${slugBase}-${i}.jpg" /><span>${prefix} Novela ${i}</span></a></article>`;
  }
  return out + `</main>`;
}

function setupMockKino(dir) {
  const { kino } = createKino(manifest, { storageFile: join(dir, "storage.json") });
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("zonatmo.net")) {
      const pg = Number((/[?&]page=(\d+)/.exec(u) || [])[1] || "1");
      const isGenre = u.includes("genres=");
      const prefix = isGenre ? "ZTGen" : "ZTCat";
      return jsonRes({
        error: false,
        data: {
          items: Array.from({ length: 24 }, (_, i) => ({
            slug: `${prefix.toLowerCase()}-${pg}-${i + 1}`,
            title: `${prefix} P${pg} #${i + 1}`,
            cover: `/2026/${prefix}-${pg}-${i + 1}.jpg`,
            genres: [2],
          })),
          pagination: { has_next: pg < 3, current_page: pg },
        },
      });
    }
    if (u.includes("zonatmo.org")) {
      const pg = (/page=(\d+)/.exec(u) || [])[1] || "1";
      const prefix = u.includes("genders") ? "ZOGen" : "ZOCat";
      return htmlRes(zoHtml(`${prefix}-p${pg}`, 24));
    }
    if (u.includes("manhwass.lat") || u.includes("manhwashot.lat")) {
      const pg = (/\/page\/(\d+)\//.exec(u) || [])[1] || "1";
      const prefix = u.includes("genero=") ? "MSGen" : "MSCat";
      return htmlRes(msHtml(`${prefix}-p${pg}`, 15));
    }
    if (u.includes("api.skynovels.net/v1/novels")) {
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      const genre = (/genres=(\d+)/.exec(u) || [])[1];
      const prefix = genre ? `SKG${genre}` : "SK";
      return jsonRes({
        total: 60,
        page: pg,
        limit: 24,
        items: Array.from({ length: 24 }, (_, i) => ({
          id: pg * 100 + i + 1,
          title: `${prefix} Novela P${pg} #${i + 1}`,
          cover: `https://api.skynovels.net/c/${pg}-${i + 1}.jpg`,
        })),
      });
    }
    if (u.includes("matchanovels.com/api/v1/public/novels")) {
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      return jsonRes({
        total: 40,
        page: pg,
        pages: 2,
        has_next: pg < 2,
        has_prev: pg > 1,
        items: Array.from({ length: 20 }, (_, i) => ({
          slug: `mk-p${pg}-${i + 1}`,
          title: `MK Novela P${pg} #${i + 1}`,
          cover_image_url: `https://matchanovels.com/c/${pg}-${i + 1}.jpg`,
        })),
      });
    }
    if (u.includes("public-api.wordpress.com") && u.includes("/categories")) {
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      return jsonRes({
        found: 50,
        categories: Array.from({ length: 24 }, (_, i) => ({
          ID: pg * 100 + i + 1,
          name: `AS Novela P${pg} #${i + 1}`,
          slug: `as-novela-p${pg}-${i + 1}`,
          description: "Sinopsis",
        })),
      });
    }
    if (u.includes("public-api.wordpress.com") && u.includes("/posts")) {
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      return jsonRes({
        found: 60,
        posts: Array.from({ length: 20 }, (_, i) => ({
          ID: pg * 100 + i + 1,
          title: `AS Novela Post P${pg} #${i + 1} – Capítulo 1`,
          featured_image: `https://astralnovelstranslations.wordpress.com/c/${pg}-${i + 1}.jpg`,
          categories: { [`as-${pg}-${i + 1}`]: { name: `AS Serie P${pg} #${i + 1}`, slug: `as-serie-p${pg}-${i + 1}` } },
        })),
      });
    }
    if (u.includes("anslid.com")) {
      const pg = (/\/page\/(\d+)\//.exec(u) || [])[1] || "1";
      const prefix = u.includes("/manga-genre/") ? "ANGen" : "ANCat";
      return htmlRes(anHtml(`${prefix}-p${pg}`, 16));
    }
    if (u.includes("devilnovels.com")) {
      const prefix = u.includes("finalizadas") ? "DVFin" : "DVAll";
      return htmlRes(dvHtml(prefix, 30));
    }
    throw new Error("Mock fetch URL no esperada: " + u);
  };
  globalThis.kino = { ...kino, fetch: mockFetch };
  return { kino: globalThis.kino };
}

test("v2.21: browse() pagina categorías y géneros reales en TODAS las 9 fuentes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-v221-"));
  try {
    setupMockKino(dir);
    const { browse, SOURCE_CATALOG, categories } = await import("../src/catalog.js");

    const refsToTest = [
      ["zt:new", "ZTCat P1", "ZTCat P2"],
      ["zt:genre:2", "ZTGen P1", "ZTGen P2"],
      ["zo:new", "ZOCat-p1", "ZOCat-p2"],
      ["zo:genre:2", "ZOGen-p1", "ZOGen-p2"],
      ["ms:on-going", "MSCat-p1", "MSCat-p2"],
      ["ms:genre:accion", "MSGen-p1", "MSGen-p2"],
      ["mh:end", "MSCat-p1", "MSCat-p2"],
      ["mh:genre:fantasia", "MSGen-p1", "MSGen-p2"],
      ["sk:updated", "SK Novela P1", "SK Novela P2"],
      ["sk:genre:9", "SKG9 Novela P1", "SKG9 Novela P2"],
      ["mk:views", "MK Novela P1", "MK Novela P2"],
      ["as:all", "AS Novela P1", "AS Novela P2"],
      ["as:latest", "as serie p1", "as serie p2"],
      ["an:trending", "ANCat-p1", "ANCat-p2"],
      ["an:genre:accion", "ANGen-p1", "ANGen-p2"],
      ["dv:todas", "DVAll Novela 1", "DVAll Novela 25"],
    ];

    for (const [ref, p1Text, p2Text] of refsToTest) {
      const r1 = await browse(ref, null);
      assert.ok(r1.items.length > 0, `${ref} p1 vacío`);
      assert.ok(r1.items[0].title.toLowerCase().includes(p1Text.toLowerCase()), `${ref} p1 título inesperado: ${r1.items[0].title}`);
      assert.ok(r1.next, `${ref} debería tener página 2 (next=${r1.next})`);
      const r2 = await browse(ref, r1.next);
      assert.ok(r2.items.length > 0, `${ref} p2 vacío`);
      assert.ok(r2.items[0].title.toLowerCase().includes(p2Text.toLowerCase()), `${ref} p2 título inesperado: ${r2.items[0].title}`);
    }

    // Todas las 9 fuentes tienen entrada en SOURCE_CATALOG y categories()
    for (const src of Object.keys(SOURCES)) {
      assert.ok(SOURCE_CATALOG[src] && SOURCE_CATALOG[src].cats.length >= 2, `falta SOURCE_CATALOG para ${src}`);
    }
    const cats = await categories();
    for (const src of Object.keys(SOURCES)) {
      assert.ok(cats.some((c) => String(c.ref).startsWith(src + ":")), `categories() debe incluir ${src}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v2.21: viewMain elimina el botón inferior 'Ver más de [fuente]' y añade ref por categoría; viewFuente pagina y cambia categoría/género sin drops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-v221-scr-"));
  try {
    setupMockKino(dir);
    const { screen, screenEvent } = await import("../src/screen.js");

    // 1. viewMain: sin botón inferior "Ver más de ZonaTMO", pero cada riel con ref de categoría
    const mainCtx = {
      route: { name: "main" },
      state: {
        hsrc: "zt",
        done: true,
        hrows: [
          { id: "zt-new", ref: "zt:new", title: "ZonaTMO · Actualizados", items: [{ s: "zt|m|1", t: "Obra 1", p: "https://example.com/1.jpg" }, { s: "zt|m|2", t: "Obra 2", p: "https://example.com/2.jpg" }] },
          { id: "zt-pop", ref: "zt:pop", title: "ZonaTMO · Lo más visto", items: [{ s: "zt|m|3", t: "Obra 3", p: "https://example.com/3.jpg" }] },
        ],
      },
      lang: "es",
      device: "phone",
      size: { widthClass: "compact" },
    };
    const mainTree = await screen(mainCtx);
    const mainChecked = checkScreenTree(mainTree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 });
    assert.deepEqual(mainChecked.dropped, []);
    const mainJson = JSON.stringify(mainTree);
    assert.equal(mainJson.includes("Ver más de ZonaTMO"), false, "no debe existir el botón inferior 'Ver más de ZonaTMO'");
    assert.ok(mainJson.includes('"ref":"zt:new"'), "riel Actualizados debe llevar ref zt:new");
    assert.ok(mainJson.includes('"ref":"zt:pop"'), "riel Lo más visto debe llevar ref zt:pop");

    // 2. open route fuente con ref zt:new -> carga página 1
    const openAns = await screenEvent({
      name: "open",
      route: { name: "fuente", args: { s: "zt", ref: "zt:new" } },
      state: {},
      lang: "es",
      device: "phone",
    });
    assert.equal(openAns.state.fuente.ref, "zt:new");
    assert.equal(openAns.state.fuente.items.length, 24);
    assert.ok(openAns.state.fuente.next, "página 1 debe traer next");

    // 3. catMas -> carga página 2 y acumula 48 títulos sin duplicados
    const masAns = await screenEvent({
      name: "catMas",
      route: { name: "fuente", args: { s: "zt", ref: "zt:new" } },
      state: openAns.state,
      lang: "es",
      device: "phone",
    });
    assert.equal(masAns.state.fuente.items.length, 48);

    // 4. catSel -> cambia a género zt:genre:2
    const genAns = await screenEvent({
      name: "catSel",
      value: "zt:genre:2",
      route: { name: "fuente", args: { s: "zt", ref: "zt:new" } },
      state: masAns.state,
      lang: "es",
      device: "phone",
    });
    assert.equal(genAns.state.fuente.ref, "zt:genre:2");
    assert.ok(genAns.state.fuente.title.includes("Acción"), "título debe reflejar el género Acción");
    assert.ok(genAns.state.fuente.items[0].t.includes("ZTGen P1"));

    // 5. viewFuente pasa checkScreenTree con 0 drops en teléfono/es, TV/en, y fuentes sin géneros (mk)
    for (const [lang, device, size] of [["es", "phone", "compact"], ["en", "tv", "expanded"]]) {
      const fTree = await screen({
        route: { name: "fuente", args: { s: "zt", ref: "zt:genre:2" } },
        state: genAns.state,
        lang,
        device,
        size: { widthClass: size },
      });
      const checked = checkScreenTree(fTree, lang, WIDGETS, { settings: manifest.settings, apiVersion: 22 });
      assert.deepEqual(checked.dropped, [], `viewFuente (${lang}/${device}) tuvo drops: ${checked.dropped.join("; ")}`);
    }

    const mkOpen = await screenEvent({ name: "open", route: { name: "fuente", args: { s: "mk", ref: "mk:views" } }, state: {}, lang: "es", device: "phone" });
    const mkTree = await screen({ route: { name: "fuente", args: { s: "mk", ref: "mk:views" } }, state: mkOpen.state, lang: "es", device: "phone" });
    const mkChecked = checkScreenTree(mkTree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 });
    assert.deepEqual(mkChecked.dropped, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v2.21: plugin.js compilado no contiene setTimeout", () => {
  assert.equal(/\bsetTimeout\s*\(/.test(built), false);
});
