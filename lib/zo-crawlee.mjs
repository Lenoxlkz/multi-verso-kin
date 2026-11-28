import { CheerioCrawler, Configuration, MemoryStorage, ProxyConfiguration, gotScraping, log } from "crawlee";
import { buildImageHostAllowlist, validateAndBuildImageUrl } from "./image-ssrf-guard.mjs";

// Suppress verbose Crawlee startup banners in server logs
log.setLevel(log.LEVELS.WARNING);

const ZO_CACHE_TTL_MS = 60 * 1000;
const ZO_CACHE_MAX = 220;

const CRAWLEE_HOSTS = [
  "zonatmo.org",
  "olympusxyz.com",
  "media.imagesolymp.xyz",
  "leercapitulo.co",
  "t34798ndc.com",
  "visualikigai.cmpunjabrashancard.pk",
  "image2.ikigaimangas.cloud",
  "image3.ikigaimangas.cloud",
  "lectorfenix.com",
  "mhscans.com",
  "manhwaweb.com",
  "api.manhwaweb.com",
  "uploads.manhwaweb.com",
  "img1mw.xyz",
  "img2mw.xyz",
  "img3mw.xyz",
  "img4mw.xyz",
];

export function parseProxyUrls(env = process.env) {
  const raw = [
    env.ZONATMO_PROXY_URLS,
    env.OLYMPUS_PROXY_URLS,
    env.LEERCAPITULO_PROXY_URLS,
    env.IKIGAI_PROXY_URLS,
    env.LECTORFENIX_PROXY_URLS,
    env.MHSCANS_PROXY_URLS,
    env.MANHWAWEB_PROXY_URLS,
    env.CRAWLEE_PROXY_URLS,
    env.HTTPS_PROXY,
    env.HTTP_PROXY,
  ].filter(Boolean).join(",");

  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!/^(https?|socks4|socks5):\/\/\S+$/i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function isZonaTmoOrgUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    const h = u.hostname.toLowerCase();
    return h === "zonatmo.org" || h.endsWith(".zonatmo.org");
  } catch {
    return false;
  }
}

export function isCrawleeManagedUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    const h = u.hostname.toLowerCase();
    return CRAWLEE_HOSTS.some((base) => h === base || h.endsWith("." + base));
  } catch {
    return false;
  }
}

export function extractBibliotecaCards($, baseUrl = "https://zonatmo.org") {
  if (!$) return [];
  const items = [];
  const seen = new Set();
  $('a[href*="/library/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = /(?:https?:\/\/zonatmo\.org)?\/library\/([a-z_-]+)\/(\d+)\/([a-z0-9-]+)\/?/i.exec(href);
    if (!m) return;
    const [, type, id, name] = m;
    if (seen.has(id) || type === "page" || type === "novel" || type === "novela") return;
    seen.add(id);
    const card = $(el).closest(".element, .thumbnail, .book, div");
    const h4 = card.find("h4").first();
    const title = (h4.attr("title") || h4.text() || name.replace(/-/g, " ")).replace(/\s+/g, " ").trim();
    const img = card.find("img").first();
    const posterRaw = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src") || "";
    const poster = posterRaw.startsWith("//")
      ? `https:${posterRaw}`
      : posterRaw.startsWith("/")
        ? `${baseUrl}${posterRaw}`
        : posterRaw;
    items.push({ slug: `${type}.${id}.${name}`, title, poster });
  });
  return items;
}

export function createZoCrawleeOrchestrator({ proxyUrls = parseProxyUrls(), cacheTtlMs = ZO_CACHE_TTL_MS } = {}) {
  const validProxies = Array.isArray(proxyUrls) ? proxyUrls.filter(Boolean) : [];
  const proxyConfiguration = validProxies.length ? new ProxyConfiguration({ proxyUrls: validProxies }) : undefined;
  const cache = new Map();
  const inflight = new Map();
  let reqSeq = 0;

  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > cacheTtlMs) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  function cacheSet(key, value) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, { ts: Date.now(), value });
    while (cache.size > ZO_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function runCrawleeOnce(url, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const reqHeaders = { ...(opts.headers || {}) };
    const timeoutMs = Math.max(3000, Math.min(60000, Number(opts.timeoutMs) || 25000));
    const maxRetries = validProxies.length > 1 ? 1 : 0;

    let captured = null;
    let crawlErr = null;
    const config = new Configuration({
      persistStorage: false,
      storageClient: new MemoryStorage({ persistStorage: false }),
    });

    const crawler = new CheerioCrawler({
      proxyConfiguration,
      useSessionPool: true,
      persistCookiesPerSession: true,
      sessionPoolOptions: {
        // Let requestHandler inspect 401/403/429/503 bodies (needed for Cloudflare classification)
        // instead of throwing "Request blocked" before reading the response body.
        blockedStatusCodes: [],
      },
      retryOnBlocked: false,
      maxConcurrency: 4,
      maxRequestRetries: maxRetries,
      requestHandlerTimeoutSecs: Math.ceil(timeoutMs / 1000) + 5,
      additionalMimeTypes: ["application/json", "text/javascript", "text/plain"],
      ignoreHttpErrorStatusCodes: [400, 401, 403, 404, 429, 500, 502, 503, 504],
      preNavigationHooks: [
        async (_ctx, gotOptions) => {
          gotOptions.headers = {
            ...gotOptions.headers,
            ...reqHeaders,
          };
          gotOptions.timeout = { request: timeoutMs };
        },
      ],
      async requestHandler({ request, response, session, body, json, $ }) {
        const status = Number(response?.statusCode) || 200;
        const headers = response?.headers || {};
        const rawText = Buffer.isBuffer(body)
          ? body.toString("utf8")
          : typeof body === "string"
            ? body
            : json != null
              ? JSON.stringify(json)
              : "";
        if (validProxies.length > 1 && request.retryCount < maxRetries && (status === 403 || status === 429 || status === 503)) {
          session?.retire();
          throw new Error(`HTTP ${status} through proxy (rotating)`);
        }
        const extractedCards = $ && /zonatmo\.org\/biblioteca/i.test(url) ? extractBibliotecaCards($) : null;
        captured = {
          status,
          ok: status >= 200 && status < 300,
          headers,
          rawText,
          extractedCards,
          via: proxyConfiguration ? "crawlee+proxy" : "crawlee",
        };
      },
      failedRequestHandler({ response }, error) {
        crawlErr = error;
        if (response && !captured) {
          captured = {
            status: Number(response.statusCode) || 502,
            ok: false,
            headers: response.headers || {},
            rawText: Buffer.isBuffer(response.body)
              ? response.body.toString("utf8")
              : typeof response.body === "string"
                ? response.body
                : "",
            via: proxyConfiguration ? "crawlee+proxy" : "crawlee",
          };
        }
      },
    }, config);

    await crawler.run([{
      url,
      method,
      payload: opts.body ? String(opts.body) : undefined,
      uniqueKey: `${++reqSeq}:${url}`,
    }]);

    if (!captured) {
      throw crawlErr || new Error("Crawlee request returned no response");
    }
    return {
      status: captured.status,
      ok: captured.ok,
      headers: captured.headers,
      via: captured.via,
      extractedCards: captured.extractedCards,
      text: () => captured.rawText,
    };
  }

  async function fetch(url, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const cookieKey = opts.headers?.Cookie || opts.headers?.cookie || "";
    const cacheKey = `${method}:${url}:${cookieKey}`;

    if (method === "GET") {
      const hit = cacheGet(cacheKey);
      if (hit) {
        return {
          status: hit.status,
          ok: hit.ok,
          headers: hit.headers,
          via: hit.via,
          text: () => hit.rawText,
        };
      }
      const existing = inflight.get(cacheKey);
      if (existing) {
        const res = await existing;
        return {
          status: res.status,
          ok: res.ok,
          headers: res.headers,
          via: res.via,
          text: () => res.rawText,
        };
      }
    }

    const p = runCrawleeOnce(url, opts).then((res) => {
      const rawText = res.text();
      if (method === "GET" && res.ok && rawText) {
        cacheSet(cacheKey, {
          status: res.status,
          ok: res.ok,
          headers: res.headers,
          via: res.via,
          rawText,
        });
      }
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        via: res.via,
        rawText,
      };
    }).finally(() => {
      inflight.delete(cacheKey);
    });

    if (method === "GET") inflight.set(cacheKey, p);
    const out = await p;
    return {
      status: out.status,
      ok: out.ok,
      headers: out.headers,
      via: out.via,
      text: () => out.rawText,
    };
  }

  const binaryAllowlist = buildImageHostAllowlist(CRAWLEE_HOSTS);

  async function fetchBinary(url, headers = {}, timeoutMs = 12000, { allowlist = binaryAllowlist, validateUrl = validateAndBuildImageUrl } = {}) {
    let response;
    let currentTarget = String(url || "");
    const maxRedirects = 3;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const check = await validateUrl(currentTarget, allowlist);
      if (!check.ok) {
        return {
          status: check.status || 403,
          ok: false,
          contentType: "text/plain",
          buf: Buffer.alloc(0),
        };
      }
      const safeHref = check.safeUrl.href;

      for (let attempt = 0; attempt < 2; attempt++) {
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
        response = await gotScraping({
          url: safeHref,
          headers,
          proxyUrl,
          followRedirect: false,
          responseType: "buffer",
          timeout: { request: timeoutMs },
          throwHttpErrors: false,
        });
        const st = Number(response.statusCode) || 502;
        if ((st >= 200 && st < 300) || (st >= 300 && st < 400)) break;
        if (attempt === 0 && (st === 403 || st === 429 || st === 503)) {
          await new Promise((r) => setTimeout(r, 180));
          continue;
        }
        break;
      }

      const st = Number(response.statusCode) || 502;
      if (st >= 300 && st < 400 && response.headers?.location) {
        if (hop === maxRedirects) {
          return { status: 502, ok: false, contentType: "text/plain", buf: Buffer.alloc(0) };
        }
        try {
          currentTarget = new URL(String(response.headers.location), safeHref).href;
        } catch {
          return { status: 400, ok: false, contentType: "text/plain", buf: Buffer.alloc(0) };
        }
        continue;
      }
      break;
    }

    return {
      status: Number(response.statusCode) || 502,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      contentType: response.headers?.["content-type"] || "image/jpeg",
      buf: Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || ""),
    };
  }

  return {
    hasProxy: validProxies.length > 0,
    proxyCount: validProxies.length,
    fetch,
    fetchBinary,
  };
}
