import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

describe("canonicalPersonRoutes — proteção do endpoint resolve", () => {
  it("registra /api/people/resolve com auth e permissão de busca", () => {
    const src = readFileSync(join(here, "canonicalPersonRoutes.ts"), "utf8");
    assert.ok(src.includes('"/api/people/resolve"'));
    assert.ok(src.includes("requireAppAuth"));
    assert.ok(src.includes("requireAnyPermission([...SEARCH_PERMS])"));
    assert.ok(src.includes("people.search"));
    assert.ok(src.includes("resolvePeopleSearch"));
    // resolve deve aparecer antes de :id para não ser capturado como id
    const resolveIdx = src.indexOf('"/api/people/resolve"');
    const linksIdx = src.indexOf('"/api/people/:id/links"');
    assert.ok(resolveIdx > 0 && linksIdx > resolveIdx);
  });
});
