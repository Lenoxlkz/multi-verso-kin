import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino } from "./sdk/kino-shim.mjs";
import { validateManifest } from "./sdk/contract.mjs";
import { kitScreenCall } from "./sdk/kit-call.mjs";
import { normalizeNode } from "./sdk/screen.mjs";
import { UA, SOURCES, HOME_TABS, NOVEL_SOURCES } from "./src/env.js";
import { createZoCrawleeOrchestrator, isCrawleeManagedUrl } from "./lib/zo-crawlee.mjs";
import * as plugin from "./plugin.js";

const zoCrawlee = createZoCrawleeOrchestrator();

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

const RUNTIME_DIR = join(tmpdir(), "multi-verso-kin-runtime");
mkdirSync(RUNTIME_DIR, { recursive: true });
const STORAGE_FILE = join(RUNTIME_DIR, "storage.json");
const COOKIES_FILE = join(RUNTIME_DIR, "cookies.json");
const CONFIG_FILE = join(RUNTIME_DIR, "config.json");

const manifestRaw = readFileSync(join(ROOT, "kino-plugin.json"), "utf8");
const checkedManifest = validateManifest(manifestRaw);
if (!checkedManifest.ok) {
  throw new Error(`Invalid kino-plugin.json: ${checkedManifest.field}: ${checkedManifest.message}`);
}
const baseManifest = checkedManifest.manifest;
// Enable enhancements.22 progress capability in the local host runtime
const runtimeManifest = {
  ...baseManifest,
  capabilities: Array.from(new Set([...(baseManifest.capabilities || []), ...((baseManifest.enhancements?.["22"]?.capabilities) || [])])),
};

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) || {};
  } catch { /* ignore */ }
  return {};
}

function saveConfig(cfg) {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch { /* ignore */ }
}

let configValues = loadConfig();
let baseRuntime = null;
const kinoByLang = new Map();
const kinoStore = new AsyncLocalStorage();

function ensureBaseRuntime() {
  if (!baseRuntime) {
    baseRuntime = createKino(runtimeManifest, {
      storageFile: STORAGE_FILE,
      cookiesFile: COOKIES_FILE,
      config: { ...configValues },
      device: "phone",
      callFunction: "screen",
    });
    const rawFetch = baseRuntime.kino.fetch;
    const zoAwareFetch = async (url, opts) => {
      if (isCrawleeManagedUrl(url)) {
        return await zoCrawlee.fetch(String(url), opts);
      }
      return await rawFetch(url, opts);
    };
    kinoByLang.set("es", Object.freeze({ ...baseRuntime.kino, fetch: zoAwareFetch, lang: "es" }));
    kinoByLang.set("en", Object.freeze({ ...baseRuntime.kino, fetch: zoAwareFetch, lang: "en" }));
  }
  return baseRuntime;
}

function getKinoForLang(lang = "es") {
  ensureBaseRuntime();
  return kinoByLang.get(lang === "en" ? "en" : "es");
}

function resetRuntimes() {
  baseRuntime = null;
  kinoByLang.clear();
  ensureBaseRuntime();
}

// Per-request AsyncLocalStorage-backed globalThis.kino so concurrent calls never block fast UI interactions
ensureBaseRuntime();
globalThis.kino = new Proxy({}, {
  get(_, prop) {
    const k = kinoStore.getStore() || getKinoForLang("es");
    const val = Reflect.get(k, prop);
    return typeof val === "function" ? val.bind(k) : val;
  },
  has(_, prop) {
    const k = kinoStore.getStore() || getKinoForLang("es");
    return prop in k;
  },
  ownKeys() {
    const k = kinoStore.getStore() || getKinoForLang("es");
    return Reflect.ownKeys(k);
  },
  getOwnPropertyDescriptor(_, prop) {
    const k = kinoStore.getStore() || getKinoForLang("es");
    return Object.getOwnPropertyDescriptor(k, prop);
  },
});

function withRuntime(lang, fn) {
  const rt = ensureBaseRuntime();
  const normLang = lang === "en" ? "en" : "es";
  const reqKino = getKinoForLang(normLang);
  rt.resetBudget();
  return kinoStore.run(reqKino, () => fn(rt));
}

// Idle background pre-warming of primary home tabs so top-panel source switching hits warm cache
let prewarmStarted = false;
function schedulePrewarm() {
  if (prewarmStarted) return;
  prewarmStarted = true;
  const targets = ["ms", "sk", "mk", "dv", "an"];
  setTimeout(async () => {
    for (const src of targets) {
      try {
        await withRuntime("es", () =>
          kitScreenCall.run({ press: false, tick: false }, () =>
            plugin.screenEvent({
              name: "tabSrc",
              arg: src,
              route: { name: "main" },
              state: {},
              lang: "es",
              device: "phone",
              size: { widthClass: "medium", widthDp: 720, heightDp: 900 },
              installed: {},
            })
          )
        );
      } catch { /* ignore background warm errors */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 400);
}

// Host-side tree normalizer: converts Flutter-style aliases (Column -> col, TextField -> textInput, etc.),
// resolves localized strings for `lang`, and preserves reader/scroll/timer props (`pages`, `every`, `onScroll`, `layout`).
function normalizeAction(raw) {
  if (!raw || typeof raw !== "object") {
    if (typeof raw === "string") return { event: { name: raw, arg: null }, ui: [], go: null };
    return null;
  }
  if (raw.event || raw.go || raw.ui) {
    return {
      ui: Array.isArray(raw.ui) ? raw.ui : [],
      event: raw.event ? { name: raw.event, arg: raw.arg ?? null } : null,
      go: raw.go || null,
    };
  }
  const goKeys = ["screen", "url", "useTheme", "close", "search", "browse", "title", "play", "copy", "section", "categories"];
  for (const k of goKeys) {
    if (raw[k] !== undefined) return { ui: [], event: null, go: { [k]: raw[k] } };
  }
  return null;
}

function localizeText(o, key, lang) {
  if (!o || typeof o !== "object") return "";
  if (lang === "en" && typeof o[key + "En"] === "string" && o[key + "En"]) return o[key + "En"];
  return typeof o[key] === "string" ? o[key] : "";
}

function normalizeForHost(node, lang) {
  if (!node || typeof node !== "object") return null;
  const n = normalizeNode({ ...node }, () => {});
  const type = n.type;

  const out = { type };
  if (n.key !== undefined) out.key = n.key;
  if (n.hidden) out.hidden = true;
  if (n.enabled === false) out.enabled = false;
  if (n.selected !== undefined) out.selected = Boolean(n.selected);
  if (n.autofocus) out.autofocus = true;
  if (n.layout) out.layout = n.layout;
  if (n.every) out.every = n.every;

  const style = {};
  const styleKeys = [
    "padding", "margin", "gap", "radius", "borderRadius", "w", "h", "width", "height", "minH",
    "fill", "flex", "weight", "align", "justify", "color", "span", "offset",
    "crossAxisAlignment", "mainAxisAlignment", "background", "opacity", "positioned", "elevation",
  ];
  for (const k of styleKeys) {
    if (n[k] !== undefined && n[k] !== null) style[k] = n[k];
  }
  if (Object.keys(style).length) out.style = style;

  if (n.onTap !== undefined) out.onTap = normalizeAction(n.onTap);
  if (n.onLongPress !== undefined) out.onLongPress = normalizeAction(n.onLongPress);

  switch (type) {
    case "scaffold":
      out.appBar = n.appBar ? normalizeForHost(n.appBar, lang) : null;
      out.body = n.body ? normalizeForHost(n.body, lang) : null;
      out.fab = n.floatingActionButton ? normalizeForHost(n.floatingActionButton, lang) : null;
      out.bottomBar = n.bottomNavigationBar ? normalizeForHost(n.bottomNavigationBar, lang) : null;
      break;
    case "appBar":
      out.title = localizeText(n, "title", lang);
      out.leading = n.leading ? normalizeForHost(n.leading, lang) : null;
      out.actions = Array.isArray(n.actions) ? n.actions.map((a) => normalizeForHost(a, lang)).filter(Boolean) : [];
      out.dense = Boolean(n.dense);
      break;
    case "navigationBar":
      out.value = n.value;
      out.items = (n.items || []).map((it) => ({
        key: it.key,
        icon: it.icon,
        label: lang === "en" && it.labelEn ? it.labelEn : it.label,
      }));
      out.onChange = normalizeAction(n.onChange ?? n.onChanged);
      break;
    case "fab":
      out.icon = n.icon;
      out.label = localizeText(n, "label", lang);
      out.position = n.fabPosition || "end";
      break;
    case "col":
    case "box":
    case "card":
      out.variant = n.variant || "plain";
      out.children = (n.children || []).map((c) => normalizeForHost(c, lang)).filter(Boolean);
      break;
    case "row":
      out.wrap = Boolean(n.wrap);
      out.children = (n.children || []).map((c) => normalizeForHost(c, lang)).filter(Boolean);
      break;
    case "scroll":
      out.horizontal = n.direction === "horizontal";
      out.zoom = Boolean(n.zoom);
      out.onScroll = normalizeAction(n.onScroll);
      out.children = (n.children || []).map((c) => normalizeForHost(c, lang)).filter(Boolean);
      break;
    case "list":
      out.items = (n.items || []).map((c) => normalizeForHost(c, lang)).filter(Boolean);
      break;
    case "pages":
      out.reverse = Boolean(n.reverse);
      out.progress = n.progress || "bar";
      out.initialPage = Number(n.initialPage) || 0;
      out.onPageChanged = normalizeAction(n.onPageChanged);
      out.pages = (n.children || []).map((c) => normalizeForHost(c, lang)).filter(Boolean);
      break;
    case "text":
      out.text = localizeText(n, "text", lang);
      out.variant = n.style || "p";
      out.bold = Boolean(n.bold);
      break;
    case "button":
      out.variant = n.variant || "primary";
      out.icon = n.icon || null;
      out.label = localizeText(n, "label", lang);
      out.confirm = localizeText(n, "confirm", lang) || null;
      if (n.loading) out.loading = true;
      break;
    case "image":
      out.url = n.url || "";
      out.aspect = n.aspect || null;
      out.fit = n.fit || "cover";
      out.alt = localizeText(n, "alt", lang);
      out.headers = n.headers || {};
      out.fallback = n.fallback ? normalizeForHost(n.fallback, lang) : null;
      break;
    case "textInput":
      out.label = localizeText(n, "label", lang);
      out.hint = localizeText(n, "hint", lang);
      out.kind = n.kind || "text";
      out.value = typeof n.value === "string" ? n.value : "";
      out.onChange = normalizeAction(n.onChange ?? n.onChanged);
      out.onSubmit = normalizeAction(n.onSubmit ?? n.onSubmitted);
      if (n.trailingIcon) {
        out.trailing = {
          icon: n.trailingIcon,
          label: localizeText(n, "trailingLabel", lang),
          onTap: normalizeAction(n.onTrailingTap),
        };
      }
      break;
    case "chips":
      out.value = n.value;
      out.multiple = Boolean(n.multiple);
      out.options = (n.options || []).map((o) => ({
        value: o.value,
        label: lang === "en" && o.labelEn ? o.labelEn : o.label,
      }));
      out.onChange = normalizeAction(n.onChange ?? n.onChanged);
      break;
    case "titleRail":
    case "titleGrid":
      out.title = localizeText(n, "title", lang);
      out.columns = n.columns || 3;
      out.size = n.size || "small";
      out.headers = n.headers || {};
      out.items = (n.items || []).filter(Boolean);
      if (typeof n.ref === "string" && n.ref) out.ref = n.ref;
      if (n.onEndReached) out.onEndReached = normalizeAction(n.onEndReached);
      if (n.loadingMore) out.loadingMore = true;
      if (n.done) out.done = true;
      break;
    case "errorState":
    case "emptyState":
      out.icon = n.icon || (type === "errorState" ? "error" : "magic");
      out.title = localizeText(n, "title", lang);
      out.text = localizeText(n, "text", lang);
      break;
    case "skeleton":
      out.shape = n.shape || "line";
      out.lines = n.lines || 1;
      break;
    case "settings":
      out.keys = Array.isArray(n.keys) ? n.keys : null;
      out.onSaved = normalizeAction(n.onSaved);
      break;
    case "badge":
      out.text = localizeText(n, "text", lang);
      break;
    case "avatar":
      out.icon = n.icon || null;
      out.text = localizeText(n, "text", lang);
      break;
    case "icon":
      out.name = n.name || n.icon || null;
      break;
    case "spacer":
    case "divider":
      break;
    default:
      if (Array.isArray(n.children)) {
        out.children = n.children.map((c) => normalizeForHost(c, lang)).filter(Boolean);
      }
      break;
  }
  return out;
}

function isBlockedImageHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".localhost")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  return false;
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolveBody(text ? JSON.parse(text) : {});
      } catch (e) {
        rejectBody(e);
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const IMG_REFERER = {
  "astralnovelstranslations.wordpress.com": true,
  "devilnovels.com": true,
  "www.devilnovels.com": true,
  "img1mw.xyz": "https://manhwaweb.com/",
  "img2mw.xyz": "https://manhwaweb.com/",
  "img3mw.xyz": "https://manhwaweb.com/",
  "img4mw.xyz": "https://manhwaweb.com/",
  "uploads.manhwaweb.com": "https://manhwaweb.com/",
};

// In-memory LRU image cache + in-flight request deduplication so switching sources or re-rendering is instant
const IMG_CACHE_MAX = 160;
const IMG_CACHE_TTL_MS = 10 * 60 * 1000;
const IMG_CACHE_ENTRY_MAX = 1024 * 1024;
const imgCache = new Map();
const imgInflight = new Map();

function getCachedImage(key) {
  const entry = imgCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > IMG_CACHE_TTL_MS) {
    imgCache.delete(key);
    return null;
  }
  imgCache.delete(key);
  imgCache.set(key, entry);
  return entry;
}

function setCachedImage(key, entry) {
  if (entry.buf.length > IMG_CACHE_ENTRY_MAX) return;
  if (imgCache.has(key)) imgCache.delete(key);
  imgCache.set(key, entry);
  while (imgCache.size > IMG_CACHE_MAX) {
    const oldest = imgCache.keys().next().value;
    imgCache.delete(oldest);
  }
}

async function handleImageProxy(reqUrl, res) {
  const target = reqUrl.searchParams.get("url");
  const refParam = reqUrl.searchParams.get("ref");
  if (!target) {
    res.writeHead(400);
    return res.end("Missing url");
  }
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400);
    return res.end("Invalid url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    res.writeHead(400);
    return res.end("Unsupported protocol");
  }
  if (isBlockedImageHost(parsed.hostname)) {
    res.writeHead(403);
    return res.end("Blocked host");
  }

  const cacheKey = `${target}|${refParam || ""}`;
  const cached = getCachedImage(cacheKey);
  if (cached) {
    res.writeHead(200, {
      "Content-Type": cached.contentType,
      "Cache-Control": "public, max-age=3600",
    });
    return res.end(cached.buf);
  }

  const headers = {
    "User-Agent": UA,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  const bareHost = parsed.hostname.replace(/^www\./, "");
  const refRule = IMG_REFERER[parsed.hostname] || IMG_REFERER[bareHost];
  if (refParam && /^https:\/\/[^\s/?#]+/.test(refParam)) {
    headers["Referer"] = refParam;
  } else if (refRule) {
    headers["Referer"] = typeof refRule === "string" ? refRule : `${parsed.protocol}//${parsed.host}/`;
  }

  let promise = imgInflight.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        let status, ok, contentType, buf;
        if (isCrawleeManagedUrl(target)) {
          const zRes = await zoCrawlee.fetchBinary(target, headers, 12000);
          status = zRes.status;
          ok = zRes.ok;
          contentType = zRes.contentType;
          buf = zRes.buf;
        } else {
          const upstream = await fetch(target, { headers, redirect: "follow", signal: controller.signal });
          status = upstream.status;
          ok = upstream.ok;
          contentType = upstream.headers.get("content-type") || "image/jpeg";
          buf = ok ? Buffer.from(await upstream.arrayBuffer()) : Buffer.alloc(0);
        }
        if (!ok) return { status, error: "Upstream error" };
        if (buf.length > 10 * 1024 * 1024) return { status: 413, error: "Image too large" };
        const entry = { contentType, buf, ts: Date.now() };
        setCachedImage(cacheKey, entry);
        return { status: 200, entry };
      } catch {
        return { status: 502, error: "Image fetch failed" };
      } finally {
        clearTimeout(timer);
        imgInflight.delete(cacheKey);
      }
    })();
    imgInflight.set(cacheKey, promise);
  }

  const result = await promise;
  if (result.status !== 200) {
    res.writeHead(result.status);
    return res.end(result.error);
  }
  res.writeHead(200, {
    "Content-Type": result.entry.contentType,
    "Cache-Control": "public, max-age=3600",
  });
  res.end(result.entry.buf);
}

function settingsPayload() {
  const safeValues = {};
  for (const s of baseManifest.settings || []) {
    if (s.type === "password") {
      safeValues[s.key] = { hasValue: Boolean(configValues[s.key]) };
    } else if (s.type === "text" || s.type === "toggle") {
      safeValues[s.key] = configValues[s.key] ?? (s.type === "toggle" ? false : "");
    }
  }
  return safeValues;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathName = reqUrl.pathname;

  try {
    if (req.method === "GET" && pathName === "/") {
      const html = readFileSync(join(ROOT, "public", "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }

    if (req.method === "GET" && (pathName === "/icon.png" || pathName === "/screen-icon.png")) {
      const imgPath = join(ROOT, pathName.slice(1));
      if (existsSync(imgPath)) {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
        return res.end(readFileSync(imgPath));
      }
    }

    if (req.method === "GET" && pathName === "/api/health") {
      return sendJson(res, 200, { ok: true, id: baseManifest.id, name: baseManifest.name, version: baseManifest.version });
    }

    if (req.method === "GET" && pathName === "/api/manifest") {
      const sources = HOME_TABS.filter((k) => SOURCES[k]).map((k) => ({
        k,
        name: SOURCES[k].name,
        novel: NOVEL_SOURCES.includes(k),
        mixed: SOURCES[k].kind === "olympus" || SOURCES[k].kind === "ikigai" || SOURCES[k].kind === "mhscans",
      }));
      return sendJson(res, 200, {
        id: baseManifest.id,
        name: baseManifest.name,
        version: baseManifest.version,
        description: baseManifest.description,
        color: baseManifest.color,
        appThemes: baseManifest.appThemes || [],
        settings: baseManifest.settings || [],
        categories: baseManifest.categories || [],
        sources,
      });
    }

    if (req.method === "GET" && pathName === "/api/image") {
      return await handleImageProxy(reqUrl, res);
    }

    if (req.method === "POST" && pathName === "/api/screen") {
      const body = await readJsonBody(req);
      const lang = body.lang === "en" ? "en" : "es";
      const device = body.device === "tv" ? "tv" : "phone";
      const ctx = {
        route: body.route || { name: "main" },
        state: body.state || {},
        lang,
        device,
        size: body.size || { widthClass: "medium", widthDp: 720, heightDp: 900 },
        installed: {},
      };
      const rawTree = await withRuntime(lang, () => plugin.screen(ctx));
      const tree = normalizeForHost(rawTree, lang);
      return sendJson(res, 200, { tree });
    }

    if (req.method === "POST" && pathName === "/api/event") {
      const body = await readJsonBody(req);
      const lang = body.lang === "en" ? "en" : "es";
      const device = body.device === "tv" ? "tv" : "phone";
      const trigger = body.trigger || "tap";
      const ctx = {
        name: String(body.name || ""),
        arg: body.arg ?? null,
        value: body.value ?? null,
        values: body.values || {},
        route: body.route || { name: "main" },
        state: body.state || {},
        lang,
        device,
        size: body.size || { widthClass: "medium", widthDp: 720, heightDp: 900 },
        installed: {},
      };
      const payload = await withRuntime(lang, async () => {
        const answer = await kitScreenCall.run(
          { press: ctx.name !== "open" && trigger !== "change", tick: ctx.name === "capsTick" },
          () => plugin.screenEvent(ctx)
        );
        const out = { answer: answer ?? null };
        if (body.includeTree && answer && !answer.close && !(answer.route && answer.route.pop) && !answer.go) {
          let nextRoute = ctx.route;
          let nextState = ctx.state;
          if (answer.route && answer.route.push) {
            nextRoute = { name: answer.route.push, params: answer.route.params || {} };
            nextState = answer.state ? { ...answer.state } : {};
          } else if (answer.state && typeof answer.state === "object") {
            nextState = { ...ctx.state, ...answer.state };
          }
          if (answer.route?.push || answer.state) {
            const rawTree = await plugin.screen({ ...ctx, route: nextRoute, state: nextState });
            out.tree = normalizeForHost(rawTree, lang);
            out.route = nextRoute;
            out.state = nextState;
          }
        }
        return out;
      });
      if (ctx.name === "open" && (!ctx.route || ctx.route.name === "main")) {
        schedulePrewarm();
      }
      return sendJson(res, 200, payload);
    }

    if (req.method === "GET" && pathName === "/api/settings") {
      const lang = reqUrl.searchParams.get("lang") === "en" ? "en" : "es";
      const status = await withRuntime(lang, () => plugin.settingsStatus());
      return sendJson(res, 200, { status: status || {}, values: settingsPayload() });
    }

    if (req.method === "POST" && pathName === "/api/settings") {
      const body = await readJsonBody(req);
      const lang = body.lang === "en" ? "en" : "es";
      const incoming = body.values || {};
      const merged = { ...configValues };
      for (const s of baseManifest.settings || []) {
        if (!Object.prototype.hasOwnProperty.call(incoming, s.key)) continue;
        const val = incoming[s.key];
        if (s.type === "password") {
          if (typeof val === "string" && val.length > 0) merged[s.key] = val;
        } else if (s.type === "toggle") {
          merged[s.key] = Boolean(val);
        } else if (s.type === "text") {
          merged[s.key] = String(val ?? "");
        }
      }
      const err = await withRuntime(lang, () => plugin.validateSettings(merged));
      if (err) return sendJson(res, 400, { ok: false, error: err });
      configValues = merged;
      saveConfig(configValues);
      resetRuntimes();
      const status = await withRuntime(lang, () => plugin.settingsStatus());
      return sendJson(res, 200, { ok: true, status: status || {}, values: settingsPayload() });
    }

    if (req.method === "POST" && pathName === "/api/settings/action") {
      const body = await readJsonBody(req);
      const lang = body.lang === "en" ? "en" : "es";
      const key = String(body.key || "");
      const def = (baseManifest.settings || []).find((s) => s.key === key && s.type === "action");
      if (!def) return sendJson(res, 404, { error: "Unknown action" });
      if (Array.isArray(def.clearSettings)) {
        for (const k of def.clearSettings) delete configValues[k];
        saveConfig(configValues);
        resetRuntimes();
      }
      const result = await withRuntime(lang, () => plugin.action(key));
      if (result && result.setSettings && typeof result.setSettings === "object") {
        Object.assign(configValues, result.setSettings);
        saveConfig(configValues);
        resetRuntimes();
      }
      const status = await withRuntime(lang, () => plugin.settingsStatus());
      return sendJson(res, 200, { result: result || {}, status: status || {}, values: settingsPayload() });
    }

    if (req.method === "GET" && pathName === "/api/search") {
      const q = reqUrl.searchParams.get("q") || "";
      const lang = reqUrl.searchParams.get("lang") === "en" ? "en" : "es";
      const out = await withRuntime(lang, () => plugin.search({ q }));
      return sendJson(res, 200, out);
    }

    if (req.method === "GET" && pathName === "/api/home") {
      const lang = reqUrl.searchParams.get("lang") === "en" ? "en" : "es";
      const out = await withRuntime(lang, () => plugin.home());
      return sendJson(res, 200, out);
    }

    if (req.method === "GET" && pathName === "/api/browse") {
      const ref = reqUrl.searchParams.get("ref") || "";
      const cursor = reqUrl.searchParams.get("cursor") || undefined;
      const lang = reqUrl.searchParams.get("lang") === "en" ? "en" : "es";
      const out = await withRuntime(lang, () => plugin.browse(ref, cursor));
      return sendJson(res, 200, out);
    }

    if (req.method === "GET" && pathName === "/api/section") {
      const tab = reqUrl.searchParams.get("tab") || undefined;
      const lang = reqUrl.searchParams.get("lang") === "en" ? "en" : "es";
      const out = await withRuntime(lang, () => plugin.section(tab ? { tab } : undefined));
      return sendJson(res, 200, out);
    }

    if (req.method === "GET" && pathName === "/api/categories") {
      const lang = reqUrl.searchParams.get("lang") === "en" ? "en" : "es";
      const out = await withRuntime(lang, () => plugin.categories());
      return sendJson(res, 200, out);
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    sendJson(res, 500, {
      error: err?.userMessage || err?.message || "Internal server error",
      code: err?.code || "unavailable",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Multi-verso Kin web host listening on http://${HOST}:${PORT}`);
});
