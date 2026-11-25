// Tests v2.19: sin botón Ajustes en la barra inferior (conservando temas/ajustes al instalar),
// URL real de ZonaTMO.org, deduplicación de ficha/capítulos y orquestador Crawlee + proxies.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createZoCrawleeOrchestrator, parseProxyUrls, isZonaTmoOrgUrl } from "../lib/zo-crawlee.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const F = (p) => readFileSync(join(root, "test", "fixtures", p), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
const screenSrc = readFileSync(join(root, "src", "screen.js"), "utf8");

globalThis.kino = {
  fetch: async () => ({ status: 200, ok: true, headers: {}, text: () => "" }),
  storage: { get: () => null, set: () => {}, remove: () => {}, keys: () => [] },
  error: (code, msg) => Object.assign(new Error(msg), { code }),
  config: { get: () => null },
};

test("v2.19: la barra inferior elimina Ajustes y deja Inicio + Biblioteca", async () => {
  const { screen } = await import("../src/screen.js");
  const tree = await screen({ route: { name: "main" }, lang: "es", device: "phone", state: { done: true, hrows: [] } });
  const nav = tree.bottomNavigationBar;
  assert.ok(nav && Array.isArray(nav.items), "falta bottomNavigationBar");
  assert.deepEqual(nav.items.map((it) => it.key), ["home", "biblioteca"]);
  assert.equal(nav.items.some((it) => it.key === "ajustes"), false, "el botón Ajustes debe quedar fuera de la barra");
});

test("v2.19: el manifiesto conserva appThemes, settings y screen para la instalación en Kino", () => {
  assert.equal(manifest.appThemes.length, 8, "se deben conservar los 8 temas propios del plugin");
  assert.ok(manifest.settings.some((s) => s.key === "ocultarPago"));
  assert.deepEqual(manifest.screen.opensFrom, ["menu", "settings"]);
  assert.equal(manifest.screen.settingsIn, "both");
});

test("v2.19: Abrir en el navegador construye la URL real de ZonaTMO.org (/library/...)", async () => {
  const { screen } = await import("../src/screen.js");
  const tree = await screen({
    route: { name: "detalle" },
    lang: "es",
    device: "phone",
    state: {
      detailRef: "zo|m|manga.12345.solo-leveling",
      detail: {
        src: "zo",
        slug: "manga.12345.solo-leveling",
        title: "Solo Leveling",
        chapters: [],
      },
    },
  });
  const json = JSON.stringify(tree);
  assert.ok(json.includes("https://zonatmo.org/library/manga/12345/solo-leveling/"), "la URL del navegador no usa /library/<tipo>/<id>/<slug>/");
  assert.ok(screenSrc.includes('kind === "zonatmoorg"'));
});

test("v2.19: zonatmoorg.js pasa order_dir=asc y deduplica fetch paralelo de ficha + capítulos", async () => {
  let libCalls = 0;
  let lastOrderDir = "";
  globalThis.kino = {
    fetch: async (url) => {
      if (url.includes("/biblioteca?")) {
        const m = /order_dir=(asc|desc)/.exec(url);
        lastOrderDir = m ? m[1] : "";
        return { status: 200, ok: true, headers: {}, text: () => JSON.stringify({ html: F("zo/fragmento-biblioteca.html") }) };
      }
      if (url.includes("/library/manga/12345/solo-leveling/")) {
        libCalls++;
        await new Promise((r) => setTimeout(r, 15));
        return { status: 200, ok: true, headers: {}, text: () => F("zo/obra.html") };
      }
      throw new Error("URL inesperada en test: " + url);
    },
    storage: { get: () => null, set: () => {}, remove: () => {}, keys: () => [] },
    error: (code, msg) => Object.assign(new Error(msg), { code }),
    config: { get: () => null },
  };
  const zo = await import("../src/zonatmoorg.js");
  await zo.list("zo", { order: "az" });
  assert.equal(lastOrderDir, "asc", "el orden alfabético debe enviar order_dir=asc");
  const [det, caps] = await Promise.all([
    zo.detail("zo", "manga.12345.solo-leveling"),
    zo.chapters("zo", "manga.12345.solo-leveling"),
  ]);
  assert.equal(det.title, "Solo Leveling");
  assert.equal(caps.items.length, 3);
  assert.equal(libCalls, 1, "detail() y chapters() en paralelo deben compartir una sola descarga");
});

test("v2.19: parseProxyUrls e isZonaTmoOrgUrl validan proxies y dominios de ZonaTMO.org", () => {
  const proxies = parseProxyUrls({
    ZONATMO_PROXY_URLS: "http://u:p@1.2.3.4:8080, socks5://5.6.7.8:1080 ; invalid-url",
  });
  assert.deepEqual(proxies, ["http://u:p@1.2.3.4:8080", "socks5://5.6.7.8:1080"]);
  assert.equal(isZonaTmoOrgUrl("https://zonatmo.org/biblioteca"), true);
  assert.equal(isZonaTmoOrgUrl("https://storage.zonatmo.org/chapters/1/1.webp"), true);
  assert.equal(isZonaTmoOrgUrl("https://zonatmo.net/wp-api/"), false);
});

test("v2.19: Crawlee CheerioCrawler orquesta peticiones JSON/HTML y caché sin tocar disco", async () => {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    if (req.url.startsWith("/biblioteca")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ html: F("zo/fragmento-biblioteca.html") }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(F("zo/obra.html"));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  try {
    const orch = createZoCrawleeOrchestrator({ proxyUrls: [] });
    const r1 = await orch.fetch(`http://127.0.0.1:${port}/biblioteca?page=1`);
    assert.equal(r1.status, 200);
    assert.equal(r1.ok, true);
    assert.ok(r1.text().includes("Solo Leveling"));
    // segunda llamada debe responder desde la caché de corto plazo sin golpear el servidor
    const r2 = await orch.fetch(`http://127.0.0.1:${port}/biblioteca?page=1`);
    assert.equal(r2.status, 200);
    assert.equal(hits, 1, "la caché debe evitar repetir la petición idéntica");

    const r3 = await orch.fetch(`http://127.0.0.1:${port}/library/manga/12345/solo-leveling/`);
    assert.equal(r3.status, 200);
    assert.ok(r3.text().includes("upload-link"));
    assert.equal(hits, 2);
  } finally {
    srv.close();
  }
});

test("v2.19: Crawlee devuelve HTTP 403 con el cuerpo HTML intacto sin lanzar 'Request blocked' ni warning deprecado", async () => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><title>Access denied | zonatmo.org used Cloudflare to restrict access</title><body>Error 1005</body></html>");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  const { log } = await import("crawlee");
  const capturedLogs = [];
  const origErr = log.error.bind(log);
  const origDep = log.deprecated.bind(log);
  log.error = (...args) => { capturedLogs.push(["error", args.map(String).join(" ")]); };
  log.deprecated = (...args) => { capturedLogs.push(["deprecated", args.map(String).join(" ")]); };

  try {
    const orch = createZoCrawleeOrchestrator({ proxyUrls: [] });
    const res = await orch.fetch(`http://127.0.0.1:${port}/biblioteca`);
    assert.equal(res.status, 403);
    assert.equal(res.ok, false);
    assert.ok(res.text().includes("Error 1005"), "debe preservar el cuerpo HTML del 403 para clasificar el bloqueo Cloudflare");
    assert.deepEqual(capturedLogs, [], "no debe emitir ERROR ni WARN deprecado de CheerioCrawler en respuestas 403");
  } finally {
    log.error = origErr;
    log.deprecated = origDep;
    srv.close();
  }
});
