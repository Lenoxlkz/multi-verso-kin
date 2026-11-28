import dns from "node:dns/promises";
import net from "node:net";

export const EXTRA_IMAGE_CDN_HOSTS = [
  "lectortaurus.com",
  "*.lectortaurus.com",
  "otakuteca.com",
  "*.otakuteca.com",
  "toptoon.com",
  "*.toptoon.com",
  "*.files.wordpress.com",
  "*.googleusercontent.com",
  "*.blogspot.com",
  "imageshack.com",
  "*.imageshack.com",
  "imgur.com",
  "*.imgur.com",
  "novelaschinas.org",
  "*.novelaschinas.org",
];

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function parseIpv4Parts(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

export function isBlockedIpv4Parts(parts) {
  if (!parts || parts.length !== 4) return true;
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8 ("this network")
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local & cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF protocol)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false;
}

function expandIpv6Hextets(rawIp) {
  let ip = String(rawIp || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!ip || ip.includes("%")) return null;

  // Handle embedded trailing IPv4 (e.g. ::ffff:127.0.0.1)
  const lastColon = ip.lastIndexOf(":");
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4Parts(ip.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const dbl = ip.split("::");
  if (dbl.length > 2) return null;

  const left = dbl[0] ? dbl[0].split(":") : [];
  const right = dbl.length === 2 && dbl[1] ? dbl[1].split(":") : [];
  const missing = 8 - (left.length + right.length);
  if (dbl.length === 1 && left.length !== 8) return null;
  if (dbl.length === 2 && missing < 1) return null;

  const full = dbl.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (full.length !== 8) return null;

  const hextets = new Uint16Array(8);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(full[i])) return null;
    hextets[i] = parseInt(full[i], 16);
  }
  return hextets;
}

export function isPrivateOrReservedIp(rawIp) {
  const ip = String(rawIp || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!ip) return true;
  if (ip.includes("%")) return true; // zone index -> link-local / interface-scoped

  const v4 = parseIpv4Parts(ip);
  if (v4) return isBlockedIpv4Parts(v4);

  const h = expandIpv6Hextets(ip);
  if (!h) return true; // malformed -> fail closed

  const allZero = h.every((x) => x === 0);
  if (allZero) return true; // :: unspecified

  const isLoopback = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1;
  if (isLoopback) return true; // ::1

  // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d)
  const isV4Mapped = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff;
  const isV4Compat = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0;
  const isV4Translated = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0;
  if (isV4Mapped || isV4Compat || isV4Translated) {
    return isBlockedIpv4Parts([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }

  // 6to4 (2002::/16) embedding an IPv4 in h[1..2]
  if (h[0] === 0x2002) {
    return isBlockedIpv4Parts([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff]);
  }

  // Teredo (2001:0000::/32)
  if (h[0] === 0x2001 && h[1] === 0x0000) return true;

  // Unique local fc00::/7
  if ((h[0] & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfe80) return true;
  // Multicast ff00::/8
  if ((h[0] & 0xff00) === 0xff00) return true;
  // Discard 100::/64
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;
  // Documentation 2001:db8::/32
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;

  return false;
}

export function buildImageHostAllowlist(manifestHosts = []) {
  const exact = new Set();
  const wildcardSuffixes = new Set();

  for (const rawRule of [...manifestHosts, ...EXTRA_IMAGE_CDN_HOSTS]) {
    const rule = String(rawRule || "").trim().toLowerCase();
    if (!rule) continue;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(2);
      if (DNS_LABEL_RE.test(suffix) && suffix.includes(".")) {
        wildcardSuffixes.add(suffix);
        exact.add(suffix);
      }
    } else if (DNS_LABEL_RE.test(rule) && rule.includes(".")) {
      exact.add(rule);
    }
  }
  return { exact, wildcardSuffixes };
}

function isNumericOrIpHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(h) !== 0) return true;
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(h)) return true; // integer / hex / octal IPv4 forms
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)(?:\.(?:0x[0-9a-f]+|0[0-7]+|\d+)){1,3}$/i.test(h)) return true;
  return false;
}

export function resolveAllowlistedHost(hostname, allowlist) {
  const h = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!h || !DNS_LABEL_RE.test(h) || isNumericOrIpHost(h)) return null;

  if (allowlist.exact.has(h)) {
    for (const candidate of allowlist.exact) {
      if (candidate === h) return candidate;
    }
  }
  for (const suffix of allowlist.wildcardSuffixes) {
    if (h.endsWith("." + suffix) && h.length > suffix.length + 1) {
      const sub = h.slice(0, h.length - suffix.length - 1);
      if (DNS_LABEL_RE.test(sub)) return `${sub}.${suffix}`;
    }
  }
  return null;
}

export async function validateAndBuildImageUrl(rawUrl, allowlist, lookupFn = (host) => dns.lookup(host, { all: true, verbatim: true })) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return { ok: false, status: 400, reason: "Invalid url" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, status: 400, reason: "Unsupported protocol" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, status: 400, reason: "Credentials not allowed in URL" };
  }
  if (parsed.port) {
    const allowedPort = parsed.protocol === "https:" ? "443" : "80";
    if (parsed.port !== allowedPort) {
      return { ok: false, status: 403, reason: "Blocked non-standard port" };
    }
  }

  const canonicalHost = resolveAllowlistedHost(parsed.hostname, allowlist);
  if (!canonicalHost) {
    return { ok: false, status: 403, reason: "Host not in image allowlist" };
  }

  let records;
  try {
    records = await lookupFn(canonicalHost);
  } catch {
    return { ok: false, status: 502, reason: "DNS resolution failed" };
  }

  const list = Array.isArray(records) ? records : records ? [records] : [];
  if (!list.length) {
    return { ok: false, status: 403, reason: "No DNS records for host" };
  }
  for (const rec of list) {
    const addr = typeof rec === "string" ? rec : rec?.address;
    if (isPrivateOrReservedIp(addr)) {
      return { ok: false, status: 403, reason: "Blocked private or internal IP" };
    }
  }

  const protocol = parsed.protocol === "http:" ? "http:" : "https:";
  const fixedOrigin = `${protocol}//${canonicalHost}`;
  const pathAndQuery = `${parsed.pathname || "/"}${parsed.search || ""}`;
  const safeUrl = new URL(pathAndQuery, fixedOrigin);
  return {
    ok: true,
    safeUrl,
    fixedOrigin,
    canonicalHost,
    resolvedAddresses: list.map((r) => (typeof r === "string" ? r : r.address)),
  };
}

export function validateSafeReferer(rawRef, allowlist) {
  if (!rawRef || typeof rawRef !== "string") return null;
  try {
    const parsed = new URL(rawRef.trim());
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    const host = resolveAllowlistedHost(parsed.hostname, allowlist);
    if (!host) return null;
    return `https://${host}/`;
  } catch {
    return null;
  }
}

export function isAllowedImageContentType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct) return true;
  if (/(?:text\/html|application\/json|text\/plain|text\/xml|application\/xml|application\/javascript|text\/javascript|application\/xhtml\+xml)/i.test(ct)) {
    return false;
  }
  return true;
}
