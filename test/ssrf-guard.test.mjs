import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildImageHostAllowlist,
  isAllowedImageContentType,
  isPrivateOrReservedIp,
  validateAndBuildImageUrl,
  validateSafeReferer,
} from "../lib/image-ssrf-guard.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "kino-plugin.json"), "utf8"));
const allowlist = buildImageHostAllowlist(manifest.hosts || []);
const publicLookup = async () => [{ address: "104.21.10.20", family: 4 }];

test("ssrf-guard · bloquea IPs privadas, loopback, link-local, metadatos y túneles IPv6", () => {
  const blocked = [
    "127.0.0.1",
    "127.255.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "fe80::1",
    "fe80::1%eth0",
    "fc00::1",
    "fd12:3456::1",
    "2002:7f00:1::",
    "2001:db8::1",
    "ff02::1",
  ];
  for (const ip of blocked) {
    assert.equal(isPrivateOrReservedIp(ip), true, "debía bloquear " + ip);
  }
  assert.equal(isPrivateOrReservedIp("104.21.10.20"), false);
  assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
  assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
});

test("ssrf-guard · rechaza metadatos, loopback, dominios arbitrarios, credenciales y puertos no estándar", async () => {
  const badTargets = [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3000/api/health",
    "http://localhost/admin",
    "http://[::1]:3000/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://2130706433/",
    "http://0x7f000001/",
    "https://evil.com/payload.png",
    "https://user:pass@zonatmo.net/cover.webp",
    "https://zonatmo.net:8443/cover.webp",
    "file:///etc/passwd",
    "ftp://cdn.zonatmo.to/a.jpg",
  ];
  for (const url of badTargets) {
    const res = await validateAndBuildImageUrl(url, allowlist, publicLookup);
    assert.equal(res.ok, false, "debía rechazar " + url);
  }
});

test("ssrf-guard · detecta DNS rebinding si un dominio permitido resuelve a IP interna", async () => {
  const rebindLookup = async () => [{ address: "169.254.169.254", family: 4 }];
  const res = await validateAndBuildImageUrl("https://cdn.zonatmo.to/manga/1/1.webp", allowlist, rebindLookup);
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
});

test("ssrf-guard · reconstruye URL canónica para CDNs autorizados de las 15 fuentes", async () => {
  const validTargets = [
    "https://cdn.zonatmo.to/manga/abc/01.webp",
    "https://257-2.mhscans.com/wp-content/uploads/WP-manga/data/x/001.webp",
    "https://img2mw.xyz/manhwas/a/1.webp?v=2",
    "https://lectortaurus.com/uploads/covers/c.webp",
    "https://media.imagesolymp.xyz/covers/1.webp",
    "https://image2.ikigaimangas.cloud/series/1/2/01.webp",
  ];
  for (const url of validTargets) {
    const res = await validateAndBuildImageUrl(url, allowlist, publicLookup);
    assert.equal(res.ok, true, "debía permitir " + url + " (" + res.reason + ")");
    assert.equal(res.safeUrl.href, url);
  }
});

test("ssrf-guard · valida Referer seguro y bloquea respuestas HTML/JSON", () => {
  assert.equal(validateSafeReferer("https://manhwaweb.com/leer/1", allowlist), "https://manhwaweb.com/");
  assert.equal(validateSafeReferer("http://169.254.169.254/", allowlist), null);
  assert.equal(validateSafeReferer("https://evil.com/", allowlist), null);
  assert.equal(isAllowedImageContentType("image/webp"), true);
  assert.equal(isAllowedImageContentType("application/octet-stream"), true);
  assert.equal(isAllowedImageContentType("text/html; charset=utf-8"), false);
  assert.equal(isAllowedImageContentType("application/json"), false);
});
