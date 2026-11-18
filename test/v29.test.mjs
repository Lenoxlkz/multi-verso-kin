// Tests v2.9: pre-clearance de Cloudflare (Turnstile → cf_clearance) con verificación honesta,
// clasificación challenge/blocked, marca persistente y el bug del import faltante de fetchText.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, "src", "env.js"), "utf8");
const scr = readFileSync(join(root, "src", "screen.js"), "utf8");
const built = readFileSync(join(root, "plugin.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

test("fetchText se importa en screen.js: la sonda CF ya no muere en ReferenceError", () => {
  // BUG v2.8 y anteriores: probeCf llamaba fetchText sin importarlo; el error era capturado
  // y el panel «Resolver desafío» casi nunca aparecía en el teléfono.
  const imp = scr.slice(scr.indexOf('from "./env.js"') - 400, scr.indexOf('from "./env.js"'));
  assert.ok(/import\s*{[^}]*fetchText[^}]*}\s*from\s*"\.\/env\.js"/.test(scr), "fetchText no está importado de env.js");
  assert.ok(imp.includes("cfClassify") && imp.includes("cfStateFor") && imp.includes("cfStatus"), "faltan los nuevos imports de CF");
});

test("cfClassify separa desafío soluble de bloqueo de firewall y marca persistente", () => {
  assert.ok(env.includes('return "blocked"') && env.includes('return "challenge"'), "faltan las dos categorías");
  assert.ok(env.includes("export function cfMarkChallenge") && env.includes("export function cfStateFor"), "falta la marca persistente");
  assert.ok(env.includes("export function cfForget") && env.includes("export function cfStatus"), "falta el estado/borrado para Ajustes");
  assert.ok(env.includes('const CFSEEN_KEY = "cfseen"'), "la marca persistente no tiene clave de storage");
  // noteHttp marca según lo que respondió y borra cuando el host responde 200 limpio
  assert.ok(env.includes("cfMarkChallenge(host, kind)"), "noteHttp no marca");
  assert.ok(env.includes("cfClearChallenge(host)"), "noteHttp no borra el estado al responder bien");
});

test("cfAbrir ejecuta el pre-clearance: ventana → cookie → VERIFICACIÓN real → recarga", () => {
  const cf = scr.slice(scr.indexOf('case "cfAbrir"'), scr.indexOf('case "cfBorrar"'));
  assert.ok(cf.includes("doneWhen: { cookies: [\"cf_clearance\"] }"), "no espera cf_clearance (Turnstile)");
  assert.ok(cf.includes("cfSaveCookies(host, r.cookies)"), "no guarda la cookie en la jarra del host");
  assert.ok(cf.includes("fetchText(base + \"/\", { timeoutMs: 12000 })"), "no verifica con una petición real");
  assert.ok(cf.includes("Pre-clearance activa"), "no anuncia el éxito solo tras verificar");
  assert.ok(cf.includes("El sitio sigue bloqueando las peticiones"), "no dice la verdad cuando el bloqueo persiste");
  assert.ok(cf.includes("no entregó la cookie de sesión"), "no explica la ventana sin cookie");
  assert.ok(cf.includes("vb.available !== false"), "la disponibilidad sigue estricta de más");
});

test("Ajustes: tarjeta de pre-clearance siempre a mano, con estado y borrado", () => {
  assert.ok(scr.includes("Pre-clearance de Cloudflare"), "falta la tarjeta");
  assert.ok(scr.includes("function cfCard") && scr.includes("cfStatus(base)"), "la tarjeta no muestra el estado real");
  assert.ok(scr.includes('case "cfBorrar"') && scr.includes("cfForget(base)"), "no se puede borrar la sesión");
  assert.ok(scr.includes('for (const k of ["zo", "dv", "sk"])'), "la tarjeta no cubre las fuentes con muro");
});

test("la versión avanza a 2.9.0 y el build lleva el pre-clearance", () => {
  assert.equal(manifest.version, "2.9.0");
  assert.ok(built.includes("Pre-clearance activa") && built.includes("cfClassify"), "el build no lleva el pre-clearance");
});
