// Test de adaptadores con fixtures reales: el parsing de Skynovels y MatchaNovels
// se verifica contra respuestas grabadas del sitio (el kit de Node está tras Cloudflare).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const F = (n) => readFileSync(join(root, "test", "fixtures", n), "utf8");

// Stub de `kino` igual al contrato mínimo que novels.js usa (fetch y storage).
const store = new Map();
globalThis.kino = {
  fetch: async (url) => {
    const map = {
      "api.skynovels.net/v1/novels?q=": "sk-search.json",
      "api.skynovels.net/v1/novels/61/chapters": "sk-chapters.json",
      "api.skynovels.net/v1/novels/61": "sk-detail.json",
      "api.skynovels.net/v1/home": "sk-home.json",
      "api.skynovels.net/v1/chapters/": "sk-chapter.json",
      "matchanovels.com/api/v1/public/novels?search=": "mk-search.json",
      "matchanovels.com/api/v1/public/novels/86-eighty-six/chapters/": "mk-chapter.json",
      "matchanovels.com/api/v1/public/novels/86-eighty-six/chapters": "mk-chapters.json",
      "matchanovels.com/api/v1/public/novels/86-eighty-six": "mk-detail.json",
    };
    for (const [k, f] of Object.entries(map)) {
      if (url.includes(k)) return { status: 200, ok: true, text: () => F(f) };
    }
    throw new Error("fixture no previsto: " + url.slice(0, 120));
  },
  storage: {
    get: (k) => store.get(k) || null,
    set: (k, v) => store.set(k, String(v)),
    remove: (k) => store.delete(k),
    keys: () => [...store.keys()],
  },
  error: (code, msg) => Object.assign(new Error(msg), { code }),
  config: { get: () => null },
};

const { novelSearch, novelHome, novelDetail, novelChapter } = await import("../src/novels.js");

test("skynovels: búsqueda y detalle desde fixtures reales", async () => {
  const s = await novelSearch("sk", "solo");
  assert.ok(s.items.length >= 1, "la búsqueda de Skynovels no devuelve nada");
  assert.ok(s.items[0].title.length > 2);
  assert.ok(/sk\|m\|\d+/.test(s.items[0].ref), "el ref de novela no usa el id numérico");
  const d = await novelDetail("sk", "61");
  assert.ok(d.title.includes("Solo") || d.title.length > 3, "título vacío");
  assert.ok(d.chapters.length > 50, "los capítulos de Skynovels no llegan: " + d.chapters.length);
  assert.ok(d.chapters[0].slug.length >= 1 && d.overview);
});

test("skynovels: el capítulo es texto (párrafos) con vecinos", async () => {
  const c = await novelChapter("sk", "61", "18396");
  assert.ok(Array.isArray(c.text) && c.text.length >= 3, "párrafos: " + (c.text || []).length);
  assert.ok(!c.pages || !c.pages.length, "un capítulo de novela no debe tener páginas de imagen");
  assert.ok(c.number !== undefined && c.title);
});

test("skynovels: home con secciones nativas", async () => {
  const h = await novelHome("sk");
  assert.ok(h.length >= 2, "secciones de Skynovels: " + h.length);
  for (const sh of h) assert.ok(sh.title && sh.items.length && sh.items[0].ref.startsWith("sk|"));
});

test("matchanovels: búsqueda, detalle y capítulos", async () => {
  const s = await novelSearch("mk", "solo");
  assert.ok(s.items.length >= 1);
  const d = await novelDetail("mk", "86-eighty-six");
  assert.ok(d.title.toLowerCase().includes("86") || d.title.length > 3);
  assert.ok(d.chapters.length > 400, "capítulos: " + d.chapters.length);
  assert.ok(d.poster && String(d.poster).startsWith("https://matchanovels.com/static"), "portada absoluta");
});

test("matchanovels: el capítulo saca párrafos del HTML", async () => {
  const c = await novelChapter("mk", "86-eighty-six", "100");
  assert.ok(c.text.length >= 10, "párrafos: " + c.text.length);
  assert.ok(c.prev === null || typeof c.prev === "string");
  assert.ok(c.next === null || typeof c.next === "string");
  // el relleno de bloqueo VIP no se cuela
  assert.ok(!c.text.some((t) => /membresía lo lees/.test(t)), "el texto de bloqueo se coló");
});
