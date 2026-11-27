import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKino } from "../sdk/kino-shim.mjs";
import { checkScreenTree, WIDGETS } from "../sdk/screen.mjs";
import { validateManifest } from "../sdk/contract.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = validateManifest(readFileSync(path.join(ROOT, "kino-plugin.json"), "utf8")).manifest;

function installMockKino(handler) {
  const dir = mkdtempSync(path.join(tmpdir(), "kino-b3-"));
  const { kino } = createKino(manifest, { storageFile: path.join(dir, "storage.json") });
  globalThis.kino = {
    ...kino,
    fetch: async (url, opts) => {
      const res = await handler(String(url), opts);
      const st = res?.status ?? 404;
      const body = res?.text ?? "";
      return {
        status: st,
        ok: st >= 200 && st < 300,
        headers: res?.headers || {},
        text: () => body,
      };
    },
  };
  return () => rmSync(dir, { recursive: true, force: true });
}

test("v2.24 · Crawlee reconoce MHScans, ManhwaWeb y sus CDNs", async () => {
  const { isCrawleeManagedUrl, parseProxyUrls } = await import("../lib/zo-crawlee.mjs");
  assert.equal(isCrawleeManagedUrl("https://mhscans.com/library"), true);
  assert.equal(isCrawleeManagedUrl("https://manhwaweb.com/"), true);
  assert.equal(isCrawleeManagedUrl("https://api.manhwaweb.com/manhwa/nuevos"), true);
  assert.equal(isCrawleeManagedUrl("https://img2mw.xyz/manhwas/x.webp"), true);
  assert.equal(isCrawleeManagedUrl("https://uploads.manhwaweb.com/x.webp"), true);
  const proxies = parseProxyUrls({
    MHSCANS_PROXY_URLS: "http://p1:8080",
    MANHWAWEB_PROXY_URLS: "socks5://p2:1080",
  });
  assert.deepEqual(proxies, ["http://p1:8080", "socks5://p2:1080"]);
});

test("v2.24 · imgHeads envía Referer https://manhwaweb.com/ para img*mw.xyz", async () => {
  const env = await import("../src/env.js");
  const h1 = env.imgHeads("https://img2mw.xyz/manhwas/a/1.webp");
  assert.equal(h1.Referer, "https://manhwaweb.com/");
  const h2 = env.imgHeads("https://mhscans.com/uploads/pages/a/1.webp");
  assert.equal(h2.Referer, undefined);
});

test("v2.24 · MHScans (mc) list, detail, chapters API, comic pages y novel prose", async () => {
  installMockKino((url) => {
    if (url.startsWith("https://mhscans.com/library")) {
      return {
        status: 200,
        text: `<main>
          <a href="/comics/emperador-demoniaco"><h3>Emperador Demoniaco</h3><img src="/uploads/covers/ed/c.webp" /></a>
          <a href="/comics/novela-retirada"><h3>Novela Retirada</h3><img src="/uploads/covers/nr/c.webp" /></a>
          <a href="/library?page=2">2</a>
        </main>`,
      };
    }
    if (url === "https://mhscans.com/comics/emperador-demoniaco") {
      return {
        status: 200,
        text: `<html><head><title>Emperador Demoniaco | MHScans</title></head><body>
          <h1>Emperador Demoniaco</h1>
          <img src="/uploads/covers/ed/c.webp" />
          <p>Zhuo Fan renace tras la traicion de su discipulo para recuperar la cima.</p>
          <a href="/library?genre=Acci%C3%B3n">Acción</a>
          <span>En emisión</span>
          <div id="chapter-list" data-cl-count="2"></div>
        </body></html>`,
      };
    }
    if (url.startsWith("https://mhscans.com/comics/emperador-demoniaco/chapters")) {
      return {
        status: 200,
        headers: { "x-total": "2", "x-page": "1", "x-pages": "1" },
        text: `<div>
          <a href="/leer/chA">Capítulo 1 Hace 2 días GRATIS</a>
          <a href="/leer/chB">Capítulo 2: Despertar Hace 1 día GRATIS</a>
        </div>`,
      };
    }
    if (url === "https://mhscans.com/leer/chA") {
      return {
        status: 200,
        text: `<title>Emperador Demoniaco Cap.1</title>
          <a href="/leer/chB">Siguiente</a>
          <img src="https://mhscans.com/uploads/pages/ed/1/01.webp" />
          <img src="/uploads/pages/ed/1/02.webp" />
          <img data-src="https://257-2.mhscans.com/wp-content/uploads/WP-manga/data/ed/003.webp" class="page-img page-img-lazy" />
          <img src="/uploads/site/logos/logo.png" />`,
      };
    }
    if (url === "https://mhscans.com/leer/chNov1") {
      return {
        status: 200,
        text: `<title>Novela Retirada Cap.1</title>
          <select><option value="/leer/chNov1" selected>Capítulo 1</option></select>
          <select><option value="/leer/chNov1" selected>Capítulo 1</option></select>
          <div class="novel-reader"><div class="novel-content"><p>Primer parrafo limpio.</p><p>Segundo parrafo de la novela.</p></div></div>`,
      };
    }
    return { status: 404, text: "" };
  });

  const mc = await import("../src/mhscans.js");
  const cat = await mc.latest("mc", 1);
  assert.equal(cat.items.length, 2);
  assert.equal(cat.next, "2");
  assert.equal(cat.items[0].poster, "https://mhscans.com/uploads/covers/ed/c.webp");

  const det = await mc.detail("mc", "emperador-demoniaco");
  assert.equal(det.title, "Emperador Demoniaco");
  assert.equal(det.statusName, "En curso");
  assert.equal(det.totalChapters, 2);

  const caps = await mc.chapters("mc", "emperador-demoniaco", { page: 1, order: "asc" });
  assert.equal(caps.items.length, 2);
  assert.equal(caps.items[0].slug, "chA");

  const chComic = await mc.chapter("mc", "emperador-demoniaco", "chA");
  assert.deepEqual(chComic.pages, [
    "https://mhscans.com/uploads/pages/ed/1/01.webp",
    "https://mhscans.com/uploads/pages/ed/1/02.webp",
    "https://257-2.mhscans.com/wp-content/uploads/WP-manga/data/ed/003.webp",
  ]);
  assert.equal(chComic.next, "chB");

  const chNovel = await mc.chapter("mc", "novela-retirada", "chNov1");
  assert.equal(chNovel.pages.length, 0);
  assert.equal(Array.isArray(chNovel.text), true);
  assert.ok(chNovel.text.includes("Primer parrafo limpio."));
  assert.ok(chNovel.text.includes("Segundo parrafo de la novela."));
  assert.equal(chNovel.next, null);
});

test("v2.24 · ManhwaWeb (mw) homeSections, library, search, detail, chapters y chapter", async () => {
  installMockKino((url) => {
    if (url === "https://api.manhwaweb.com/latest/new-manhwa") {
      return {
        status: 200,
        text: JSON.stringify({
          manhwas: { _manhwas: [{ id_rel: "obra-a_123", name_manhwa: "Obra Reciente", img: "https://img1mw.xyz/a/c.webp" }] },
        }),
      };
    }
    if (url === "https://api.manhwaweb.com/manhwa/nuevos") {
      return {
        status: 200,
        text: JSON.stringify({
          utimos_mangas_creados: [{ _id: "obra-c_789", name_esp: "Obra Nueva", _imagen: "https://img2mw.xyz/c/c.webp" }],
        }),
      };
    }
    if (url.startsWith("https://api.manhwaweb.com/manhwa/library")) {
      return {
        status: 200,
        text: JSON.stringify({
          data: [{ _id: "obra-b_456", real_id: "obra-b_456", name_esp: "Rey Demonio", _imagen: "https://img2mw.xyz/b/c.webp" }],
          next: true,
        }),
      };
    }
    if (url === "https://api.manhwaweb.com/manhwa/see/obra-b_456") {
      return {
        status: 200,
        text: JSON.stringify({
          _id: "obra-b_456",
          name_esp: "Rey Demonio",
          _imagen: "https://img2mw.xyz/b/c.webp",
          _status: "publicandose",
          _sinopsis: "Historia de prueba en ManhwaWeb.",
          _categoris: [{ "3": "Acción" }, { "23": "Fantasía" }],
          _tipo: "manhwa",
          chapters: [
            { chapter: 2, link: "https://manhwaweb.com/leer/obra-b_456-2_01", img: ["https://img2mw.xyz/b/2/1.webp"] },
            { chapter: 1, link: "https://manhwaweb.com/leer/obra-b_456-1_01", img: ["https://img2mw.xyz/b/1/1.webp", "https://img2mw.xyz/b/1/2.webp"] },
          ],
        }),
      };
    }
    return { status: 404, text: "" };
  });

  const mw = await import("../src/manhwaweb.js");
  const hs = await mw.homeSections("mw");
  assert.equal(hs.recent[0].title, "Obra Reciente");
  assert.equal(hs.popular[0].title, "Rey Demonio");
  assert.equal(hs.fresh[0].title, "Obra Nueva");

  const sr = await mw.search("mw", "rey");
  assert.equal(sr.items.length, 1);
  assert.equal(sr.next, "2");

  const det = await mw.detail("mw", "obra-b_456");
  assert.equal(det.title, "Rey Demonio");
  assert.equal(det.statusName, "En curso");
  assert.deepEqual(det.genres, ["Acción", "Fantasía"]);

  const caps = await mw.chapters("mw", "obra-b_456", { page: 1, order: "asc" });
  assert.equal(caps.items[0].number, "1");
  assert.equal(caps.items[0].slug, "obra-b_456-1_01");

  const ch1 = await mw.chapter("mw", "obra-b_456", "obra-b_456-1_01");
  assert.equal(ch1.pages.length, 2);
  assert.equal(ch1.next, "obra-b_456-2_01");
});

test("v2.24 · catalog + screen integran las 15 fuentes, categories <= 24 y árboles válidos", async () => {
  installMockKino((url) => {
    if (url.startsWith("https://mhscans.com/library")) {
      return { status: 200, text: `<main><a href="/comics/mc-1"><h3>MC Obra</h3><img src="/uploads/covers/mc/1.webp" /></a></main>` };
    }
    if (url === "https://api.manhwaweb.com/latest/new-manhwa") {
      return { status: 200, text: JSON.stringify({ manhwas: { _manhwas: [{ id_rel: "mw-1", name_manhwa: "MW Obra", img: "https://img1mw.xyz/mw/1.webp" }] } }) };
    }
    if (url === "https://api.manhwaweb.com/manhwa/nuevos") {
      return { status: 200, text: JSON.stringify({ utimos_mangas_creados: [{ _id: "mw-2", name_esp: "MW Nueva", _imagen: "https://img1mw.xyz/mw/2.webp" }] }) };
    }
    if (url.startsWith("https://api.manhwaweb.com/manhwa/library")) {
      return { status: 200, text: JSON.stringify({ data: [{ _id: "mw-3", name_esp: "MW Pop", _imagen: "https://img2mw.xyz/mw/3.webp" }], next: false }) };
    }
    return { status: 404, text: "" };
  });

  const env = await import("../src/env.js");
  assert.ok(env.SOURCES.mc && env.SOURCES.mw);
  assert.equal(env.HOME_TABS.length, 15);

  const cat = await import("../src/catalog.js");
  const tiles = await cat.categories();
  assert.ok(tiles.length <= 24);
  assert.ok(tiles.some((t) => t.id === "mc-todo" && t.ref === "mc:latest"));
  assert.ok(tiles.some((t) => t.id === "mw-todo" && t.ref === "mw:latest"));
  assert.ok(tiles.some((t) => t.id === "dv-todo"));

  const scr = await import("../src/screen.js");
  for (const s of ["mc", "mw"]) {
    const ev = await scr.screenEvent({ name: "tabSrc", arg: s, route: { name: "main" }, state: {}, lang: "es" });
    assert.ok(ev.state.hrows.length >= 1, "tabSrc debe cargar filas para " + s);
    const tree = await scr.screen({ route: { name: "main" }, state: { ...ev.state, done: true }, lang: "es", device: "phone", size: { widthClass: "compact", widthDp: 390, heightDp: 844 } });
    const chk = checkScreenTree(tree, "es", WIDGETS, { settings: manifest.settings, apiVersion: 22 });
    assert.deepEqual(chk.dropped, [], "tree inválido en " + s + ": " + JSON.stringify(chk.dropped));
  }

  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "kino-plugin.json"), "utf8"));
  assert.equal(mf.version, "2.19.0");
  assert.equal("signature" in mf, false);
  assert.ok(mf.hosts.includes("mhscans.com"));
  assert.ok(mf.hosts.includes("manhwaweb.com"));
  assert.ok(mf.hosts.includes("api.manhwaweb.com"));
  assert.ok(mf.hosts.includes("img2mw.xyz"));
});
