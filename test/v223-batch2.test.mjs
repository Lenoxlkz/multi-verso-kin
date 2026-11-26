// Tests Batch 2: Integración de Ikigai (ik: cómics + novelas) y LectorFenix (lf) con Crawlee.
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
import { isCrawleeManagedUrl } from "../lib/zo-crawlee.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8")).manifest;

function jsonRes(obj, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { "content-type": "application/json" }, text: () => JSON.stringify(obj) };
}
function htmlRes(html, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { "content-type": "text/html" }, text: () => html };
}

function setupBatch2Mock(dir) {
  const { kino } = createKino(manifest, { storageFile: join(dir, "storage.json") });
  const mockFetch = async (url) => {
    const u = String(url);

    // VisualIkigai mocks
    if (u.includes("visualikigai.cmpunjabrashancard.pk/series/?")) {
      const pg = Number((/pagina=(\d+)/.exec(u) || [])[1] || "1");
      const isNov = u.includes("tipos[]=novel");
      const isSearch = u.includes("buscar=lector");
      const slug = isSearch
        ? "punto-de-vista-del-lector-omnisciente"
        : isNov
          ? "la-matriarca-novela"
          : `ik-comic-${pg}`;
      const title = isSearch
        ? "Punto de Vista del Lector Omnisciente"
        : isNov
          ? "La Matriarca - Novela"
          : `Ikigai Cómic P${pg}`;
      return htmlRes(`
        <main>
          <a href="/series/${slug}/" class="card bg-base-100">
            <figure><img src="https://image2.ikigaimangas.cloud/covers/${slug}.webp" alt="${title}"><div class="badge">${isNov ? "Novela" : "Cómic"}</div></figure>
            <h3>${title}</h3>
          </a>
          <a href="/series/?pagina=1">1</a>
          <a href="/series/?pagina=2">2</a>
        </main>
      `);
    }
    if (u.includes("visualikigai.cmpunjabrashancard.pk/series/punto-de-vista-del-lector-omnisciente/")) {
      return htmlRes(`
        <meta name="description" content="Historia de un lector que conoce el fin del mundo.">
        <main>
          <img src="https://image2.ikigaimangas.cloud/x/rs:fill:350:500:t/cover.webp" alt="Lector">
          <h1>Punto de Vista del Lector Omnisciente</h1>
          <a href="/series/?generos[]=906397904327999491">Acción</a>
          <span>En Curso</span>
          <a href="/capitulo/914360726757965827/">Primer Capítulo</a>
          <a href="/capitulo/914360726757965829/">Capítulo 2</a>
          <a href="/capitulo/914360726757965827/">Capítulo 1</a>
        </main>
      `);
    }
    if (u.includes("visualikigai.cmpunjabrashancard.pk/series/la-matriarca-novela/")) {
      return htmlRes(`
        <meta name="description" content="Novela de regresión noble.">
        <main>
          <img src="https://image2.ikigaimangas.cloud/y/rs:fill:350:500:t/nov.webp" alt="Matriarca">
          <h1>La Matriarca - Novela</h1>
          <span>En Curso</span>
          <a href="/capitulo/1223625927357464579/">Capítulo 1</a>
        </main>
      `);
    }
    if (u.includes("visualikigai.cmpunjabrashancard.pk/capitulo/914360726757965827/")) {
      return htmlRes(`
        <title>Capítulo 1 - Lector | Ikigai</title>
        <h1>Lector Capítulo 1</h1>
        <a href="/capitulo/914360726757965829/">Siguiente</a>
        <img src="https://image3.ikigaimangas.cloud/series/1000/BannerConcursoTiktok.jpg">
        <img src="https://image3.ikigaimangas.cloud/series/9118/914360726757965827/01.webp">
        <img src="https://image3.ikigaimangas.cloud/series/9118/914360726757965827/02.webp">
      `);
    }
    if (u.includes("visualikigai.cmpunjabrashancard.pk/capitulo/1223625927357464579/")) {
      return htmlRes(`
        <title>Capítulo 1 - La Matriarca | Ikigai</title>
        <h1>La Matriarca Capítulo 1</h1>
        <a href="/capitulo/1223625983257313283/">Siguiente</a>
        <div class="prose px-2">
          <div><p><span>—No te confundas con tu lugar en la casa.</span></p></div>
          <div><p><span>Florencia respiró hondo y miró la carta.</span></p></div>
          <div><p><span>Si ves este mensaje, significa que el sitio web ha sido actualizado y tu navegador necesita ser refrescado.</span></p></div>
        </div></div>
      `);
    }

    // LectorFenix SvelteKit __data.json mocks
    if (u === "https://lectorfenix.com/__data.json") {
      return jsonRes({
        type: "data",
        nodes: [
          { type: "data", data: [{}] },
          {
            type: "data",
            data: [
              { homeData: 1 },
              { comics_popular: 2, comics_popular_today: 2, comics_recent: 2 },
              [3],
              { comic_slug: 4, comic_title: 5, comic_cover: 6 },
              "un-rey-nace-en-el-camino",
              "Un Rey Nace En El Camino",
              "https://image2.ikigaimangas.cloud/lf-cover.webp",
            ],
          },
        ],
      });
    }
    if (u.includes("lectorfenix.com/comics/__data.json")) {
      const pg = Number((/page=(\d+)/.exec(u) || [])[1] || "1");
      return jsonRes({
        type: "data",
        nodes: [
          { type: "data", data: [{}] },
          {
            type: "data",
            data: [
              { results: 1 },
              { comics: 2, page: 7, totalPages: 8 },
              [3],
              { slug: 4, title: 5, coverImage: 6 },
              `rey-congelado-p${pg}`,
              `Rey Congelado P${pg}`,
              "https://image2.ikigaimangas.cloud/lf2.webp",
              pg,
              3,
            ],
          },
        ],
      });
    }
    if (u === "https://lectorfenix.com/comics/un-rey-nace-en-el-camino/__data.json") {
      return jsonRes({
        type: "data",
        nodes: [
          { type: "data", data: [{}] },
          {
            type: "data",
            data: [
              { comic: 1 },
              { title: 2, description: 3, coverImage: 4, status: 5, type: 6, genres: 7, comicScans: 8, isNsfw: false },
              "Un Rey Nace En El Camino",
              "Un guerrero se alza. Haz click aqui para ir a la novela [../../series/x]",
              "https://image2.ikigaimangas.cloud/lf-cover.webp",
              "ongoing",
              "manhwa",
              [9],
              [10],
              "Acción",
              { chapters: 11 },
              [12, 16],
              { id: 21, chapterNumber: 22, title: 13, urlPages: 14 },
              "Capítulo 2",
              [15],
              "https://image3.ikigaimangas.cloud/series/1/2/01.webp",
              { id: 23, chapterNumber: 24, title: 17, urlPages: 18 },
              "Capítulo 1",
              [19, 20],
              "https://image3.ikigaimangas.cloud/series/1/1/01.webp",
              "https://image3.ikigaimangas.cloud/series/1/1/02.webp",
              728951,
              2,
              728950,
              1,
            ],
          },
        ],
      });
    }
    if (u === "https://lectorfenix.com/comics/un-rey-nace-en-el-camino/chapters/728950/__data.json") {
      return jsonRes({
        type: "data",
        nodes: [
          { type: "data", data: [{}] },
          {
            type: "data",
            data: [
              { chapter: 1 },
              { id: 2, chapter_number: 3, title: 4, url_pages: 5, prev_chapter_id: -6, next_chapter_id: 8 },
              728950,
              1,
              "Capítulo 1",
              [6, 7],
              "https://image3.ikigaimangas.cloud/series/1/1/01.webp",
              "https://image3.ikigaimangas.cloud/series/1/1/02.webp",
              728951,
            ],
          },
        ],
      });
    }

    throw new Error("Mock fetch inesperado: " + u);
  };
  globalThis.kino = { ...kino, fetch: mockFetch };
}

test("Crawlee orchestrator cubre VisualIkigai, LectorFenix e ikigaimangas.cloud CDN", () => {
  assert.equal(isCrawleeManagedUrl("https://visualikigai.cmpunjabrashancard.pk/series/"), true);
  assert.equal(isCrawleeManagedUrl("https://image2.ikigaimangas.cloud/x.webp"), true);
  assert.equal(isCrawleeManagedUrl("https://image3.ikigaimangas.cloud/series/1/2/01.webp"), true);
  assert.equal(isCrawleeManagedUrl("https://lectorfenix.com/comics/__data.json"), true);
});

test("Ikigai (ik) y LectorFenix (lf): búsqueda, catálogo, detalle y lectores cómic/novela", async () => {
  assert.ok(SOURCES.ik && SOURCES.lf);
  assert.ok(HOME_TABS.includes("ik") && HOME_TABS.includes("lf"));
  const dir = mkdtempSync(join(tmpdir(), "kino-b2-"));
  try {
    setupBatch2Mock(dir);
    const { browse, SOURCE_CATALOG, categories } = await import("../src/catalog.js");
    const ik = await import("../src/ikigai.js");
    const lf = await import("../src/lectorfenix.js");

    assert.ok(SOURCE_CATALOG.ik.cats.length >= 4 && SOURCE_CATALOG.ik.genres.length >= 6);
    assert.ok(SOURCE_CATALOG.lf.cats.length >= 4 && SOURCE_CATALOG.lf.genres.length >= 6);
    const cats = await categories();
    assert.ok(cats.some((c) => c.ref === "ik:new"));
    assert.ok(cats.some((c) => c.ref === "lf:latest"));

    // Ikigai
    const ikSearch = await ik.search("ik", "lector");
    assert.equal(ikSearch.items[0].ref, "ik|m|punto-de-vista-del-lector-omnisciente");
    const ikBrowse = await browse("ik:new", null);
    assert.equal(ikBrowse.items[0].title, "Ikigai Cómic P1");
    assert.equal(ikBrowse.next, "2");
    const ikDet = await ik.detail("ik", "punto-de-vista-del-lector-omnisciente");
    assert.equal(ikDet.title, "Punto de Vista del Lector Omnisciente");
    assert.equal(ikDet.totalChapters, 2);
    const ikCh = await ik.chapter("ik", "punto-de-vista-del-lector-omnisciente", "914360726757965827");
    assert.equal(ikCh.pages.length, 2);
    assert.equal(ikCh.pages.some((p) => p.includes("BannerConcursoTiktok")), false);
    assert.equal(ikCh.next, "914360726757965829");
    const ikNov = await ik.chapter("ik", "la-matriarca-novela", "1223625927357464579");
    assert.ok(ikNov.text.includes("—No te confundas con tu lugar en la casa."));
    assert.equal(ikNov.text.some((p) => p.includes("actualizado")), false);

    // LectorFenix
    const lfHs = await lf.homeSections("lf");
    assert.equal(lfHs.recent[0].ref, "lf|m|un-rey-nace-en-el-camino");
    const lfP1 = await browse("lf:pop", null);
    assert.equal(lfP1.items[0].title, "Rey Congelado P1");
    assert.equal(lfP1.next, "2");
    const lfDet = await lf.detail("lf", "un-rey-nace-en-el-camino");
    assert.equal(lfDet.overview, "Un guerrero se alza.");
    assert.equal(lfDet.totalChapters, 2);
    const lfCaps = await lf.chapters("lf", "un-rey-nace-en-el-camino", { page: 1, order: "asc" });
    assert.equal(lfCaps.items[0].number, "1");
    const lfCh = await lf.chapter("lf", "un-rey-nace-en-el-camino", "728950");
    assert.equal(lfCh.pages.length, 2);
    assert.equal(lfCh.next, "728951");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("screen rendering de Ikigai (ik) y LectorFenix (lf) pasa checkScreenTree sin drops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-b2-scr-"));
  try {
    setupBatch2Mock(dir);
    const { screen, screenEvent } = await import("../src/screen.js");

    for (const src of ["ik", "lf"]) {
      const tabAns = await screenEvent({ name: "tabSrc", arg: src, route: { name: "main" }, state: {}, lang: "es", device: "phone" });
      assert.ok(tabAns.state.hrows.length >= 2, `${src} debe devolver estantes en tabSrc`);
      const tree = await screen({ route: { name: "main" }, state: { ...tabAns.state, done: true }, lang: "es", device: "phone", size: { widthClass: "compact" } });
      assert.deepEqual(checkScreenTree(tree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 }).dropped, []);
    }

    const ikNov = await screenEvent({ name: "cap", arg: "ik|c|la-matriarca-novela|1223625927357464579", route: { name: "detalle" }, state: { detail: { title: "La Matriarca", poster: "https://image2.ikigaimangas.cloud/y/nov.webp" } }, lang: "es", device: "phone" });
    assert.equal(ikNov.state.chapter.mode, "texto");
    const novTree = await screen({ route: { name: "leer" }, state: ikNov.state, lang: "es", device: "phone", size: { widthClass: "compact" } });
    assert.deepEqual(checkScreenTree(novTree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 }).dropped, []);

    const lfOpen = await screenEvent({ name: "cap", arg: "lf|c|un-rey-nace-en-el-camino|728950", route: { name: "detalle" }, state: { detail: { title: "Un Rey", poster: "https://image2.ikigaimangas.cloud/lf-cover.webp" } }, lang: "es", device: "phone" });
    assert.equal(lfOpen.state.chapter.pages.length, 2);
    const lfTree = await screen({ route: { name: "leer" }, state: lfOpen.state, lang: "es", device: "phone", size: { widthClass: "compact" } });
    assert.deepEqual(checkScreenTree(lfTree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 }).dropped, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
