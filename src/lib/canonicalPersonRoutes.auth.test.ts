import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

describe("canonicalPersonRoutes — proteção do endpoint resolve", () => {
  it("registra /api/people/resolve com requireResource admin.employees view", () => {
    const src = readFileSync(join(here, "canonicalPersonRoutes.ts"), "utf8");
    assert.ok(src.includes('"/api/people/resolve"'));
    assert.ok(src.includes("requireAppAuth"));
    assert.ok(src.includes("moduleViewGuard"));
    assert.ok(src.includes("EMPLOYEES_RESOURCE_KEYS"));
    assert.ok(src.includes("resolvePeopleSearch"));
    const resolveIdx = src.indexOf('"/api/people/resolve"');
    const linksIdx = src.indexOf('"/api/people/:id/links"');
    assert.ok(resolveIdx > 0 && linksIdx > resolveIdx);
  });

  it("registra /api/employees/:id/system-links com links.view", () => {
    const src = readFileSync(join(here, "canonicalPersonRoutes.ts"), "utf8");
    assert.ok(src.includes('"/api/employees/:id/system-links"'));
    assert.ok(src.includes("linksViewGuard"));
    assert.ok(src.includes("getEmployeeSystemLinks"));
    assert.ok(src.includes("buildSystemLinksViewerCaps"));
  });
});
