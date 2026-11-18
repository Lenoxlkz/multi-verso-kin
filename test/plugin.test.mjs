// Offline test: the answers come from test/fixtures.json (recorded once against the real sites with
//   node sdk/run.mjs --record test/fixtures.json . search "solo leveling"   — and home / browse).
// With the fixtures present, every call runs without touching the network and the kit judges the answers
// exactly as Kino would: problems (what Kino would refuse) and drops (what Kino would not draw).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures.json");

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});

test("search answers offline, with items and nothing dropped", { skip: !existsSync(fixtures) && "record test/fixtures.json first" }, async () => {
  const r = await validate(root, { run: "search", args: ["solo leveling"], replay: fixtures });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  assert.ok(r.output.items.length > 0);
  for (const it of r.output.items) {
    assert.match(it.id, /^(zt|zo|ms|mh)-/);
    assert.ok(it.title && it.ref);
    assert.equal(it.kind, "movie"); // catalogOnly: los ítems son "movie" (regla de la guía)
  }
});

test("home answers offline with rows from both primary sources", { skip: !existsSync(fixtures) && "record test/fixtures.json first" }, async () => {
  const r = await validate(root, { run: "home", replay: fixtures });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  const ids = r.output.map((row) => row.id);
  assert.ok(ids.includes("zt-new"), "falta la fila de ZonaTMO");
  assert.ok(ids.includes("ms-new"), "falta la fila de ManhwaSS");
  for (const row of r.output) {
    assert.ok(row.items.length > 0, "fila sin items: " + row.id);
    assert.ok(row.items.length <= 500);
  }
});

test("browse serves Ver más for both families offline", { skip: !existsSync(fixtures) && "record test/fixtures.json first" }, async () => {
  const zt = await validate(root, { run: "browse", args: ["zt:new"], replay: fixtures });
  assert.deepEqual(zt.problems, []);
  assert.deepEqual(zt.drops, []);
  assert.ok(zt.output.items.length > 0);
  assert.ok(zt.output.next, "zt:new debe paginar");

  const ms = await validate(root, { run: "browse", args: ["ms:all"], replay: fixtures });
  assert.deepEqual(ms.problems, []);
  assert.deepEqual(ms.drops, []);
  assert.ok(ms.output.items.length > 0);
});
