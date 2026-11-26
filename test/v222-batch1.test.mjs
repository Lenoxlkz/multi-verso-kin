// Tests Batch 1: Integración de Olympus (ol: cómics + novelas) y LeerCapitulo (lc) con Crawlee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino } from "../sdk/kino-shim.mjs";
import { checkScreenTree, WIDGETS } from "../sdk/screen.mjs";
import { validateManifest } from "../sdk/contract.mjs";
import { SOURCES, HOME_TABS } from "../src/env.js";
import { isCrawleeManagedUrl, isZonaTmoOrgUrl } from "../lib/zo-crawlee.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8")).manifest;

function jsonRes(obj, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { "content-type": "application/json" }, text: () => JSON.stringify(obj) };
}
function htmlRes(html, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { "content-type": "text/html" }, text: () => html };
}

function setupBatch1Mock(dir) {
  const { kino } = createKino(manifest, { storageFile: join(dir, "storage.json") });
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("olympusxyz.com/api/series/list")) {
      return jsonRes({
        data: [
          { id: 11, name: "Academia de la Ascensión", slug: "academia-de-la-ascension", cover: "comics/covers/11/a.webp", type: "comic" },
          { id: 15, name: "Asesino de la luna a la deriva", slug: "asesino-luna", cover: "comics/covers/15/b.webp", type: "novel" },
        ],
      });
    }
    if (u.includes("olympusxyz.com/api/rankings")) {
      return jsonRes({
        current_page: 1,
        last_page: 2,
        data: [
          { id: 743, name: "Sabueso de Sangre", slug: "sabueso", cover: "https://media.imagesolymp.xyz/comics/covers/743/s.webp", type: "comic" },
        ],
      });
    }
    if (u.includes("olympusxyz.com/api/series?")) {
      const isNov = u.includes("type=novel");
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      return jsonRes({
        data: {
          series: {
            current_page: pg,
            last_page: 2,
            data: isNov
              ? [{ id: 15, name: "Asesino de la luna", slug: "asesino-luna", cover: "https://media.imagesolymp.xyz/n15.webp", type: "novel", genres: [{ name: "Acción" }] }]
              : [{ id: 11, name: `Olympus Comic P${pg}`, slug: `ol-comic-${pg}`, cover: "https://media.imagesolymp.xyz/c11.webp", type: "comic", genres: [{ name: "Fantasía" }] }],
          },
        },
      });
    }
    if (u.includes("olympusxyz.com/api/series/asesino-luna/chapters")) {
      return jsonRes({
        data: [{ id: 1937, name: "1" }, { id: 1938, name: "2" }],
        meta: { current_page: 1, last_page: 1, total: 2 },
      });
    }
    if (u.includes("olympusxyz.com/api/series/academia-de-la-ascension/chapters")) {
      return jsonRes({
        data: [{ id: 41724, name: "0" }, { id: 41725, name: "1" }],
        meta: { current_page: 1, last_page: 1, total: 2 },
      });
    }
    if (u.includes("olympusxyz.com/api/series/asesino-luna?type=novel")) {
      return jsonRes({ data: { id: 15, name: "Asesino de la luna", slug: "asesino-luna", summary: "Novela marcial.", cover: "https://media.imagesolymp.xyz/n15.webp", status: { name: "Activo" }, genres: [{ name: "Murim" }], chapter_count: 16 } });
    }
    if (u.includes("olympusxyz.com/api/series/academia-de-la-ascension")) {
      return jsonRes({ data: { id: 11, name: "Academia de la Ascensión", slug: "academia-de-la-ascension", summary: "Cómic de acción.", cover: "https://media.imagesolymp.xyz/c11.webp", status: { name: "Activo" }, genres: [{ name: "Acción" }], chapter_count: 20 } });
    }
    if (u.includes("olympusxyz.com/series/novela-asesino-luna/capitulo/1")) {
      return htmlRes(`<h1>Capítulo 1</h1><main class="strip"><article class="novel"><p>Abrió los ojos.<br><br>&nbsp;<br><br>Todo era oscuridad.<br><br>Lo tradujo gente que no cobra para que lo leas</p></article></main>`);
    }
    if (u.includes("olympusxyz.com/series/comic-academia-de-la-ascension/capitulo/0")) {
      return htmlRes(`<h1>Capítulo 0</h1><img src="https://media.imagesolymp.xyz/comics/11/41724/01.webp"><img src="https://media.imagesolymp.xyz/comics/11/41724/02.webp">`);
    }

    if (u.includes("leercapitulo.co/search/?q=")) {
      return jsonRes([
        { name: "\u200eNano máquina\u200e", cover_uri: "/covers/4f/nano.jpg", uri: "/manga/5be8t9bobk/nano-maquina/" },
        { name: "Obra Larga", cover_uri: "/covers/aa/larga.jpg", uri: `/manga/abc12345/${"x".repeat(150)}/` },
      ]);
    }
    if (u === "https://www.leercapitulo.co/") {
      return htmlRes(`
        <section><h2>Tendencias</h2><article class="lc-card"><a href="/manga/t1/tendencia-1/"><img src="/covers/t1.jpg"></a><a class="lc-card-name" href="/manga/t1/tendencia-1/">Tendencia 1</a></article></section>
        <section><h2>Populares</h2><article class="lc-card"><a href="/manga/p1/popular-1/"><img src="/covers/p1.jpg"></a><a class="lc-card-name" href="/manga/p1/popular-1/">Popular 1</a></article></section>
        <section><h2>Ultimos mangas</h2><article class="lc-card"><a href="/manga/u1/ultimo-1/"><img src="/covers/u1.jpg"></a><a class="lc-card-name" href="/manga/u1/ultimo-1/">Ultimo 1</a></article></section>
      `);
    }
    if (u.includes("leercapitulo.co/manga/?")) {
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      return htmlRes(`
        <article class="lc-card"><a href="/manga/m${pg}/lc-obra-${pg}/"><img src="/covers/m${pg}.jpg"></a><a class="lc-card-name" href="/manga/m${pg}/lc-obra-${pg}/">LC Obra P${pg}</a></article>
        <a href="/manga/?page=${pg + 1}">Siguiente</a>
      `);
    }
    if (u.includes("leercapitulo.co/manga/5be8t9bobk/")) {
      return htmlRes(`
        <img src="/covers/4f/nano.jpg">
        <h1>Nano máquina</h1>
        <p id="example2">Historia de artes marciales y nanomáquinas.</p>
        <a href="/manga/?genre=action">Action</a>
        <ul class="lc-facts"><li><span class="k">Estado</span><a href="/manga/?status=ongoing">Ongoing</a></li><li><span class="k">Tipo</span><a href="/manga/?type=manhwa">Manhwa</a></li></ul>
        <a href="/leer/5be8t9bobk/nano-maquina/2/"><span class="n">Capitulo 2</span></a>
        <a href="/leer/5be8t9bobk/nano-maquina/1/"><span class="n">Capitulo 1</span></a>
      `);
    }
    if (u.includes("leercapitulo.co/leer/5be8t9bobk/nano-maquina/1/")) {
      return htmlRes(`
        <h1>Nano máquina - Capítulo 1</h1>
        <select id="chapterSelect">
          <option value="/leer/5be8t9bobk/nano-maquina/2/">Capitulo 2</option>
          <option value="/leer/5be8t9bobk/nano-maquina/1/" selected>Capitulo 1</option>
        </select>
        <img src="/images/loading.gif" data-src="https://es2s12-2127.t34798ndc.com/p1.webp" class="is-pending">
        <img data-src="https://es2s12-2127.t34798ndc.com/p2.webp" class="is-pending">
      `);
    }
    throw new Error("Mock fetch inesperado: " + u);
  };
  globalThis.kino = { ...kino, fetch: mockFetch };
}

test("Crawlee orchestrator incluye ZonaTMO.org, Olympus y LeerCapitulo", () => {
  assert.equal(isZonaTmoOrgUrl("https://zonatmo.org/biblioteca"), true);
  assert.equal(isCrawleeManagedUrl("https://olympusxyz.com/api/series"), true);
  assert.equal(isCrawleeManagedUrl("https://media.imagesolymp.xyz/comics/11/1/01.webp"), true);
  assert.equal(isCrawleeManagedUrl("https://www.leercapitulo.co/manga/5be8t9bobk/nano-maquina/"), true);
  assert.equal(isCrawleeManagedUrl("https://es2s12-2127.t34798ndc.com/p1.webp"), true);
  assert.equal(isCrawleeManagedUrl("https://example.com/"), false);
});

test("env y catálogo exponen Olympus (ol) y LeerCapitulo (lc) con categorías y búsqueda", async () => {
  assert.ok(SOURCES.ol && SOURCES.lc);
  assert.ok(HOME_TABS.includes("ol") && HOME_TABS.includes("lc"));
  const dir = mkdtempSync(join(tmpdir(), "kino-b1-"));
  try {
    setupBatch1Mock(dir);
    const { browse, SOURCE_CATALOG, categories } = await import("../src/catalog.js");
    const ol = await import("../src/olympus.js");
    const lc = await import("../src/leercapitulo.js");

    assert.ok(SOURCE_CATALOG.ol.cats.length >= 4 && SOURCE_CATALOG.ol.genres.length >= 10);
    assert.ok(SOURCE_CATALOG.lc.cats.length >= 4 && SOURCE_CATALOG.lc.genres.length >= 10);
    const cats = await categories();
    assert.ok(cats.some((c) => c.ref === "ol:new"));
    assert.ok(cats.some((c) => c.ref === "lc:latest"));

    // Olympus búsqueda + browse + comic + novela
    const olSearch = await ol.search("ol", "academia");
    assert.equal(olSearch.items.length, 1);
    assert.equal(olSearch.items[0].ref, "ol|m|c.academia-de-la-ascension");

    const olP1 = await browse("ol:new", null);
    assert.equal(olP1.items[0].title, "Olympus Comic P1");
    assert.equal(olP1.next, "2");
    const olP2 = await browse("ol:new", olP1.next);
    assert.equal(olP2.items[0].title, "Olympus Comic P2");

    const novCh = await ol.chapter("ol", "n.asesino-luna", "1");
    assert.ok(novCh.text.includes("Abrió los ojos.") && novCh.text.includes("Todo era oscuridad."));
    assert.equal(novCh.text.some((l) => l.includes("no cobra")), false);
    assert.equal(novCh.next, "2");

    const comicCh = await ol.chapter("ol", "c.academia-de-la-ascension", "0");
    assert.equal(comicCh.pages.length, 2);
    assert.equal(comicCh.next, "1");

    // LeerCapitulo búsqueda (con recorte <= 120 chars) + browse + detail + chapter + select prev/next
    const lcSearch = await lc.search("lc", "nano");
    assert.equal(lcSearch.items.length, 2);
    assert.equal(lcSearch.items[0].title, "Nano máquina");
    assert.ok(lcSearch.items[1].id.length <= 120);

    const lcP1 = await browse("lc:ongoing", null);
    assert.equal(lcP1.items[0].title, "LC Obra P1");
    assert.equal(lcP1.next, "2");

    const lcDet = await lc.detail("lc", "5be8t9bobk.nano-maquina");
    assert.equal(lcDet.title, "Nano máquina");
    assert.equal(lcDet.totalChapters, 2);

    const lcCh = await lc.chapter("lc", "5be8t9bobk.nano-maquina", "1");
    assert.equal(lcCh.pages.length, 2);
    assert.equal(lcCh.pages[0], "https://es2s12-2127.t34798ndc.com/p1.webp");
    assert.equal(lcCh.next, "2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("screen rendering de Olympus (comic y novela) y LeerCapitulo pasa checkScreenTree sin drops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-b1-scr-"));
  try {
    setupBatch1Mock(dir);
    const { screen, screenEvent } = await import("../src/screen.js");

    for (const src of ["ol", "lc"]) {
      const tabAns = await screenEvent({ name: "tabSrc", arg: src, route: { name: "main" }, state: {}, lang: "es", device: "phone" });
      assert.ok(tabAns.state.hrows.length >= 2, `${src} debe devolver estantes en tabSrc`);
      const tree = await screen({ route: { name: "main" }, state: { ...tabAns.state, done: true }, lang: "es", device: "phone", size: { widthClass: "compact" } });
      const checked = checkScreenTree(tree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 });
      assert.deepEqual(checked.dropped, [], `drops en main (${src}): ${checked.dropped.join("; ")}`);
    }

    // Lector mixto de Olympus: novela en modo texto y cómic en páginas/tira
    const novOpen = await screenEvent({ name: "cap", arg: "ol|c|n.asesino-luna|1", route: { name: "detalle" }, state: { detail: { title: "Asesino", poster: "https://media.imagesolymp.xyz/n15.webp" } }, lang: "es", device: "phone" });
    assert.equal(novOpen.route.push, "leer");
    assert.equal(novOpen.state.chapter.mode, "texto");
    const novTree = await screen({ route: { name: "leer" }, state: novOpen.state, lang: "es", device: "phone", size: { widthClass: "compact" } });
    assert.deepEqual(checkScreenTree(novTree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 }).dropped, []);

    const lcOpen = await screenEvent({ name: "cap", arg: "lc|c|5be8t9bobk.nano-maquina|1", route: { name: "detalle" }, state: { detail: { title: "Nano máquina", poster: "https://www.leercapitulo.co/covers/4f/nano.jpg" } }, lang: "es", device: "phone" });
    assert.equal(lcOpen.route.push, "leer");
    assert.equal(lcOpen.state.chapter.pages.length, 2);
    const lcTree = await screen({ route: { name: "leer" }, state: lcOpen.state, lang: "es", device: "phone", size: { widthClass: "compact" } });
    assert.deepEqual(checkScreenTree(lcTree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 }).dropped, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
